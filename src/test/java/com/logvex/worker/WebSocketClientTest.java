package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.logvex.worker.core.WebSocketClient;
import com.logvex.worker.core.WebSocketListener;
import java.net.URI;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/** Exercises the hand-rolled WebSocket client against an independent server implementation. */
class WebSocketClientTest {
    @Test
    void completesHandshakeAndDeliversAMessage() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            CountDownLatch opened = new CountDownLatch(1);
            CountDownLatch received = new CountDownLatch(1);
            StringBuilder message = new StringBuilder();

            WebSocketClient client = new WebSocketClient(
                URI.create("ws://127.0.0.1:" + server.port() + "/worker"),
                new WebSocketListener() {
                    @Override public void onOpen() { opened.countDown(); }
                    @Override public void onMessage(String text) { message.append(text); received.countDown(); }
                });
            client.connect(2000);

            assertTrue(opened.await(2, TimeUnit.SECONDS), "handshake should complete");
            assertTrue(client.isOpen());

            server.send("{\"type\":\"hello-ack\",\"payload\":{\"accepted\":true}}");
            assertTrue(received.await(2, TimeUnit.SECONDS), "message should arrive");
            assertEquals("{\"type\":\"hello-ack\",\"payload\":{\"accepted\":true}}", message.toString());

            client.close();
        }
    }

    @Test
    void sendsTextFramesThatTheServerCanRead() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            WebSocketClient client = new WebSocketClient(
                URI.create("ws://127.0.0.1:" + server.port()), new WebSocketListener() {});
            client.connect(2000);
            client.sendText("{\"type\":\"register\"}");

            String received = server.next(2000);
            assertNotNull(received);
            assertEquals("{\"type\":\"register\"}", received);

            client.close();
        }
    }

    @Test
    void reportsCloseWhenTheServerGoesAway() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            CountDownLatch closed = new CountDownLatch(1);
            WebSocketClient client = new WebSocketClient(
                URI.create("ws://127.0.0.1:" + server.port()),
                new WebSocketListener() {
                    @Override public void onClose(int code, String reason) { closed.countDown(); }
                });
            client.connect(2000);
            server.sendClose();

            assertTrue(closed.await(2, TimeUnit.SECONDS), "close should be reported");
        }
    }

    @Test
    void connectToNothingFailsRatherThanHanging() {
        WebSocketClient client = new WebSocketClient(
            URI.create("ws://127.0.0.1:1"), new WebSocketListener() {});
        try {
            client.connect(500);
        } catch (Exception expected) {
            return;
        } finally {
            client.close();
        }
        // Reaching here means the connection unexpectedly succeeded; the port should be unusable.
        throw new AssertionError("connecting to a closed port should fail");
    }

    @Test
    void uriBuilderNormalizesThePath() {
        assertEquals("ws://host:1/worker", WebSocketClient.uri("host", 1, "worker").toString());
        assertEquals("ws://host:1/worker", WebSocketClient.uri("host", 1, "/worker").toString());
        assertEquals("ws://host:1/", WebSocketClient.uri("host", 1, "").toString());
    }

    @Test
    void sendAfterCloseIsANoOp() throws Exception {
        try (TestWebSocketServer server = new TestWebSocketServer()) {
            WebSocketClient client = new WebSocketClient(
                URI.create("ws://127.0.0.1:" + server.port()), new WebSocketListener() {});
            client.connect(2000);
            client.close();
            client.sendText("ignored");
            assertTrue(!client.isOpen());
            assertNull(server.next(200));
        }
    }
}
