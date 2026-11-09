package com.logvex.hunter.core;

import com.logvex.hunter.core.swarm.SwarmMessage;
import com.logvex.hunter.core.swarm.SwarmProtocol;
import com.logvex.hunter.core.swarm.SwarmRoster;
import com.logvex.hunter.modules.swarm.SwarmHostServer;
import com.logvex.hunter.modules.swarm.SwarmWorkerClient;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.ServerSocket;
import java.util.concurrent.ConcurrentLinkedQueue;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises the real host and worker over a loopback socket.
 *
 * <p>This is the one test that proves the transport actually works, not just the pure logic: it
 * binds a host, connects a worker, verifies the token handshake, sends a command and checks that a
 * result comes back. It uses the production {@code SwarmHostServer}/{@code SwarmWorkerClient}
 * classes, so a regression in the socket code fails here.
 */
class SwarmLinkIntegrationTest {

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static long waitFor(java.util.function.BooleanSupplier condition, long timeoutMillis) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            if (condition.getAsBoolean()) return System.currentTimeMillis();
            try {
                Thread.sleep(20);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return -1;
            }
        }
        return -1;
    }

    private static String pollFor(SwarmWorkerClient worker, long timeoutMillis) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            String command = worker.pollCommand();
            if (command != null) return command;
            try {
                Thread.sleep(20);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        return null;
    }

    @Test
    void workerConnectsSendsStatusReceivesCommandAndReplies() throws IOException {
        int port = freePort();
        SwarmRoster roster = new SwarmRoster();
        ConcurrentLinkedQueue<String[]> hostMessages = new ConcurrentLinkedQueue<>();

        SwarmHostServer host = new SwarmHostServer(port, "s3cret", false, roster,
            (id, message) -> hostMessages.add(new String[]{id, message.type(),
                message.string(SwarmProtocol.FIELD_LINE), message.string(SwarmProtocol.FIELD_OUTPUT),
                message.string(SwarmProtocol.FIELD_STATUS)}),
            message -> { });
        host.start();

        SwarmWorkerClient worker = new SwarmWorkerClient("127.0.0.1", port, "s3cret", "test-worker",
            (state, up) -> { });
        worker.start();

        assertTrue(waitFor(() -> worker.connected(), 3000) > 0, "the worker should connect");
        assertTrue(waitFor(() -> roster.size() == 1, 3000) > 0, "the host should register the worker");

        // The worker reports its status; the host records it on the peer.
        worker.sendStatus("running", "test server");
        assertTrue(waitFor(() -> !hostMessages.isEmpty(), 3000) > 0, "the host should receive a status");

        // The host sends a command; the worker queues it.
        String sendError = roster.send(roster.peers().get(0).id(),
            SwarmMessage.of(SwarmProtocol.COMMAND).with(SwarmProtocol.FIELD_LINE, "status"));
        assertEquals(null, sendError);
        assertEquals("status", pollFor(worker, 3000), "the worker should receive the command");

        // The worker replies with a result; the host records it.
        worker.sendResult("status", true, "State: running");
        assertTrue(waitFor(() -> hostMessages.stream().anyMatch(m -> SwarmProtocol.RESULT.equals(m[1])), 3000) > 0,
            "the host should receive the result");

        worker.disconnect();
        host.stop();
    }

    @Test
    void aWorkerWithTheWrongTokenIsRejected() throws IOException {
        int port = freePort();
        SwarmRoster roster = new SwarmRoster();
        SwarmHostServer host = new SwarmHostServer(port, "right-token", false, roster,
            (id, message) -> { }, message -> { });
        host.start();

        SwarmWorkerClient worker = new SwarmWorkerClient("127.0.0.1", port, "wrong-token", "intruder",
            (state, up) -> { });
        worker.start();

        assertTrue(waitFor(() -> !worker.lastError().isBlank(), 3000) > 0, "the worker should be told why");
        assertEquals("bad token", worker.lastError());
        assertFalse(worker.connected());
        assertTrue(waitFor(() -> roster.size() == 0, 1000) > 0, "a rejected worker must not join the roster");

        worker.disconnect();
        host.stop();
    }

    @Test
    void aStatusLineFromTheHostReachesTheWorkerAsACommand() throws IOException {
        int port = freePort();
        SwarmRoster roster = new SwarmRoster();
        SwarmHostServer host = new SwarmHostServer(port, "", false, roster,
            (id, message) -> { }, message -> { });
        host.start();

        SwarmWorkerClient worker = new SwarmWorkerClient("127.0.0.1", port, "", "worker-2",
            (state, up) -> { });
        worker.start();
        assertTrue(waitFor(() -> worker.connected() && roster.size() == 1, 3000) > 0);

        roster.broadcast(SwarmMessage.of(SwarmProtocol.COMMAND).with(SwarmProtocol.FIELD_LINE, "hud list"));
        assertEquals("hud list", pollFor(worker, 3000));

        worker.disconnect();
        host.stop();
    }
}
