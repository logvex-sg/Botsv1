package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.logvex.worker.core.Envelope;
import com.logvex.worker.core.Json;
import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.TaskDispatcher;
import com.logvex.worker.core.TaskResult;
import com.logvex.worker.core.WorkerConfig;
import com.logvex.worker.core.WorkerLink;
import com.logvex.worker.core.WorkerSnapshot;
import com.logvex.worker.core.WorkerState;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * End-to-end worker behaviour over a real socket.
 *
 * <p>These tests drive the whole worker link against a hand-written WebSocket server: the same
 * handshake, registration, heartbeat and task paths the host will use in production. Nothing here
 * mocks the transport.
 */
class WorkerLinkTest {
    /** A dispatcher that answers every task the same way and counts invocations. */
    private static final class FakeDispatcher implements TaskDispatcher {
        final AtomicInteger dispatched = new AtomicInteger();

        @Override
        public TaskResult dispatch(String taskId, String kind, JsonObject payload) {
            dispatched.incrementAndGet();
            return TaskResult.ok(taskId, kind, "handled " + kind);
        }

        @Override
        public WorkerSnapshot snapshot() {
            WorkerSnapshot snapshot = new WorkerSnapshot();
            snapshot.username = "TestBot";
            snapshot.inWorld = true;
            snapshot.dimension = "minecraft:overworld";
            snapshot.health = 20f;
            return snapshot;
        }
    }

    private static WorkerConfig configFor(int port) {
        WorkerConfig config = new WorkerConfig();
        config.host = "127.0.0.1";
        config.port = port;
        config.token = "test-token";
        config.heartbeatSeconds = 1;
        config.reconnectSeconds = 1;
        return config;
    }

    private static Envelope read(TestWebSocketServer server) throws InterruptedException {
        String frame = server.next(4000);
        assertNotNull(frame, "expected a frame from the worker");
        Envelope envelope = Envelope.decode(frame);
        assertNotNull(envelope, "frame should be a valid envelope: " + frame);
        return envelope;
    }

    /**
     * Reads frames until one of the wanted type arrives.
     *
     * <p>A worker forwards its own console lines to the host as `log` frames, which can interleave
     * with any other message. The host tolerates them the same way, so the test skips them rather
     * than pinning an exact ordering that the protocol does not promise.
     */
    private static Envelope readOfType(TestWebSocketServer server, String type) throws InterruptedException {
        for (int attempts = 0; attempts < 20; attempts++) {
            Envelope envelope = read(server);
            if (type.equals(envelope.type)) return envelope;
            assertEquals(Protocol.LOG, envelope.type, "unexpected frame while waiting for " + type + ": " + envelope.type);
        }
        throw new AssertionError("did not see a " + type + " frame");
    }

    @Test
    void registersAndReportsStatus() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            FakeDispatcher dispatcher = new FakeDispatcher();
            WorkerLink link = new WorkerLink(configFor(server.port()), dispatcher);
            try {
                link.start();

                Envelope hello = read(server);
                assertEquals(Protocol.HELLO, hello.type);
                assertEquals("test-token", hello.payload.get("token").getAsString());
                assertEquals(Protocol.VERSION, hello.payload.get("protocolVersion").getAsInt());

                JsonObject ack = new JsonObject();
                ack.addProperty("accepted", true);
                ack.addProperty("workerId", "worker-1");
                ack.addProperty("protocolVersion", Protocol.VERSION);
                server.send(new Envelope(Protocol.HELLO_ACK, null, ack).encode());

                Envelope register = readOfType(server, Protocol.REGISTER);
                assertEquals("TestBot", register.payload.get("username").getAsString());
                assertEquals("worker-1", register.payload.get("workerId").getAsString());

                // The heartbeat should follow within a second or so.
                Envelope status = readOfType(server, Protocol.STATUS);
                assertEquals("minecraft:overworld", status.payload.get("dimension").getAsString());
                assertTrue(link.isRegistered());
            } finally {
                link.close();
            }
        }
    }

    @Test
    void pairsWithTheHostAndStoresTheGrantedToken() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            FakeDispatcher dispatcher = new FakeDispatcher();
            WorkerConfig config = configFor(server.port());
            config.token = "";
            config.pairingCode = "ABCD2345";
            WorkerLink link = new WorkerLink(config, dispatcher);
            java.util.concurrent.atomic.AtomicInteger persisted = new java.util.concurrent.atomic.AtomicInteger();
            link.setPersistHook(persisted::incrementAndGet);
            try {
                link.start();

                Envelope hello = read(server);
                assertEquals(Protocol.HELLO, hello.type);
                assertEquals("ABCD2345", hello.payload.get("pairingCode").getAsString());

                JsonObject ack = new JsonObject();
                ack.addProperty("accepted", true);
                ack.addProperty("workerId", "worker-9");
                ack.addProperty("protocolVersion", Protocol.VERSION);
                ack.addProperty("token", "granted-token-xyz");
                server.send(new Envelope(Protocol.HELLO_ACK, null, ack).encode());

                readOfType(server, Protocol.REGISTER);

                // The granted token replaces the one-time code and the owner is asked to persist it.
                assertEquals("granted-token-xyz", config.token);
                assertEquals("", config.pairingCode);
                assertEquals(1, persisted.get());
            } finally {
                link.close();
            }
        }
    }

    @Test
    void runsATaskAndReturnsItsResult() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            FakeDispatcher dispatcher = new FakeDispatcher();
            WorkerLink link = new WorkerLink(configFor(server.port()), dispatcher);
            try {
                link.start();
                read(server); // hello
                accept(server, "worker-1");
                read(server); // register

                JsonObject payload = new JsonObject();
                payload.addProperty("kind", Protocol.TASK_COUNT);
                payload.addProperty("query", "diamond");
                server.send(new Envelope(Protocol.TASK, "task-42", payload).encode());

                Envelope result = awaitType(server, Protocol.RESULT);
                assertEquals("task-42", result.id);
                assertTrue(result.payload.get("ok").getAsBoolean());
                assertEquals(Protocol.TASK_COUNT, result.payload.get("kind").getAsString());
                assertEquals(1, dispatcher.dispatched.get());
            } finally {
                link.close();
            }
        }
    }

    @Test
    void refusesAnUnsupportedTaskKindWithoutDispatchingIt() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            FakeDispatcher dispatcher = new FakeDispatcher();
            WorkerLink link = new WorkerLink(configFor(server.port()), dispatcher);
            try {
                link.start();
                read(server);
                accept(server, "worker-1");
                read(server);

                JsonObject payload = new JsonObject();
                payload.addProperty("kind", "exec-shell");
                payload.addProperty("command", "rm -rf /");
                server.send(new Envelope(Protocol.TASK, "task-evil", payload).encode());

                Envelope result = awaitType(server, Protocol.RESULT);
                assertTrue(!result.payload.get("ok").getAsBoolean());
                assertTrue(result.payload.get("message").getAsString().contains("unsupported"));
                assertEquals(0, dispatcher.dispatched.get(), "the dispatcher must never see it");
            } finally {
                link.close();
            }
        }
    }

    @Test
    void answersARetriedTaskFromCacheWithoutReRunningIt() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            FakeDispatcher dispatcher = new FakeDispatcher();
            WorkerLink link = new WorkerLink(configFor(server.port()), dispatcher);
            try {
                link.start();
                read(server);
                accept(server, "worker-1");
                read(server);

                JsonObject payload = new JsonObject();
                payload.addProperty("kind", Protocol.TASK_INVENTORY);
                server.send(new Envelope(Protocol.TASK, "task-1", payload).encode());
                awaitType(server, Protocol.RESULT);

                // The host did not see the first reply and retries the same id.
                server.send(new Envelope(Protocol.TASK, "task-1", payload).encode());
                Envelope second = awaitType(server, Protocol.RESULT);

                assertEquals("task-1", second.id);
                assertEquals(1, dispatcher.dispatched.get(), "a retried task must not run twice");
            } finally {
                link.close();
            }
        }
    }

    @Test
    void refusesAHandshakeWithTheWrongProtocolVersion() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            WorkerLink link = new WorkerLink(configFor(server.port()), new FakeDispatcher());
            try {
                link.start();
                read(server);
                JsonObject ack = new JsonObject();
                ack.addProperty("accepted", true);
                ack.addProperty("protocolVersion", Protocol.VERSION + 99);
                server.send(new Envelope(Protocol.HELLO_ACK, null, ack).encode());

                // The worker must not register: it drops the connection instead.
                Thread.sleep(500);
                assertTrue(!link.isRegistered());
            } finally {
                link.close();
            }
        }
    }

    @Test
    void stopsWhenTheHostRefusesTheToken() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            WorkerLink link = new WorkerLink(configFor(server.port()), new FakeDispatcher());
            try {
                link.start();
                read(server);
                JsonObject ack = new JsonObject();
                ack.addProperty("accepted", false);
                ack.addProperty("reason", "bad token");
                server.send(new Envelope(Protocol.HELLO_ACK, null, ack).encode());

                long deadline = System.currentTimeMillis() + 3000;
                while (link.state() != WorkerState.DISCONNECTED && System.currentTimeMillis() < deadline) {
                    Thread.sleep(50);
                }
                assertEquals(WorkerState.DISCONNECTED, link.state());
            } finally {
                link.close();
            }
        }
    }

    @Test
    void forwardsItsOwnLogLinesToTheHostOnceRegistered() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            WorkerLink link = new WorkerLink(configFor(server.port()), new FakeDispatcher());
            try {
                link.start();
                readOfType(server, Protocol.HELLO);
                accept(server, "worker-1");

                // The link logs "registered as worker-1" as it comes up, so a log frame should
                // arrive carrying that text. Its position relative to the register frame is not
                // promised, so collect both instead of pinning an order.
                Envelope logFrame = null;
                Envelope register = null;
                for (int i = 0; i < 20 && (logFrame == null || register == null); i++) {
                    Envelope envelope = read(server);
                    if (Protocol.LOG.equals(envelope.type) && logFrame == null) logFrame = envelope;
                    if (Protocol.REGISTER.equals(envelope.type) && register == null) register = envelope;
                }
                assertNotNull(register, "the worker should have registered");
                assertNotNull(logFrame, "the worker should have forwarded its log line");
                assertTrue(logFrame.payload.get("message").getAsString().contains("registered as worker-1"));
                assertTrue(logFrame.payload.get("at").getAsLong() > 0);
            } finally {
                link.close();
            }
        }
    }

    private static void accept(TestWebSocketServer server, String workerId) throws Exception {
        JsonObject ack = new JsonObject();
        ack.addProperty("accepted", true);
        ack.addProperty("workerId", workerId);
        ack.addProperty("protocolVersion", Protocol.VERSION);
        server.send(new Envelope(Protocol.HELLO_ACK, null, ack).encode());
    }

    /** Reads frames until one of the wanted type arrives, ignoring heartbeats. */
    private static Envelope awaitType(TestWebSocketServer server, String type) throws InterruptedException {
        for (int i = 0; i < 12; i++) {
            Envelope envelope = read(server);
            if (envelope.type.equals(type)) return envelope;
        }
        throw new AssertionError("never saw a " + type + " frame");
    }
}
