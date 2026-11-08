package com.logvex.hunter.core.instances;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

/**
 * The small read-only HTTP endpoint an instance exposes so that other instances can read its
 * statistics and ask it to stop.
 *
 * <p>Access is authenticated with a bearer token and, unless remote access is explicitly enabled,
 * the socket binds to the loopback address only. It answers exactly two routes and never exposes
 * world state beyond {@link InstanceStats}.
 */
public final class InstanceHttpServer {
    private final int port;
    private final String token;
    private final boolean allowRemote;
    private final Supplier<String> statusJson;
    private final Runnable onEmergencyStop;

    private HttpServer server;

    public InstanceHttpServer(int port, String token, boolean allowRemote,
                              Supplier<String> statusJson, Runnable onEmergencyStop) {
        this.port = port;
        this.token = token == null ? "" : token;
        this.allowRemote = allowRemote;
        this.statusJson = statusJson;
        this.onEmergencyStop = onEmergencyStop;
    }

    public void start() throws IOException {
        InetSocketAddress address = allowRemote
            ? new InetSocketAddress(port)
            : new InetSocketAddress(InetAddress.getLoopbackAddress(), port);
        server = HttpServer.create(address, 0);
        server.createContext(InstanceProbe.STATUS_PATH, this::handleStatus);
        server.createContext(InstanceProbe.STOP_PATH, this::handleStop);
        server.setExecutor(Executors.newSingleThreadExecutor(r -> {
            Thread thread = new Thread(r, "logvex-hunter-endpoint");
            thread.setDaemon(true);
            return thread;
        }));
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
    }

    public boolean running() {
        return server != null;
    }

    public int port() {
        return port;
    }

    private void handleStatus(HttpExchange exchange) throws IOException {
        if (!authorized(exchange)) {
            respond(exchange, 401, "{\"error\":\"unauthorized\"}");
            return;
        }
        respond(exchange, 200, statusJson.get());
    }

    private void handleStop(HttpExchange exchange) throws IOException {
        if (!authorized(exchange)) {
            respond(exchange, 401, "{\"error\":\"unauthorized\"}");
            return;
        }
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        if (onEmergencyStop != null) onEmergencyStop.run();
        respond(exchange, 200, "{\"status\":\"stopped\"}");
    }

    private boolean authorized(HttpExchange exchange) {
        if (token.isBlank()) return false;
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (header == null) return false;
        String prefix = "Bearer ";
        return header.startsWith(prefix) && constantTimeEquals(header.substring(prefix.length()), token);
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a.length() != b.length()) return false;
        int result = 0;
        for (int i = 0; i < a.length(); i++) result |= a.charAt(i) ^ b.charAt(i);
        return result == 0;
    }

    private static void respond(HttpExchange exchange, int code, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
