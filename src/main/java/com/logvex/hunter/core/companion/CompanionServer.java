package com.logvex.hunter.core.companion;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The addon's local HTTP endpoint, used by the Logvex Fleet Manager and the bundled companion page.
 *
 * <p>It binds to loopback unless remote access is explicitly enabled, and every {@code /api/v1/*}
 * route requires the shared bearer token. The socket handling lives on daemon threads so it never
 * blocks the game thread; {@link CompanionRouter} turns requests into responses.
 */
public final class CompanionServer {
    private static final int MAX_BODY = 64 * 1024;

    private final int port;
    private final String token;
    private final boolean allowRemote;
    private final CompanionRouter router;

    private HttpServer server;
    private ExecutorService executor;

    public CompanionServer(int port, String token, boolean allowRemote, CompanionRouter router) {
        this.port = port;
        this.token = token == null ? "" : token;
        this.allowRemote = allowRemote;
        this.router = router;
    }

    public void start() throws IOException {
        InetSocketAddress address = allowRemote
            ? new InetSocketAddress(port)
            : new InetSocketAddress(InetAddress.getLoopbackAddress(), port);
        server = HttpServer.create(address, 0);
        server.createContext("/", this::handle);
        executor = Executors.newFixedThreadPool(2, r -> {
            Thread thread = new Thread(r, "logvex-hunter-companion");
            thread.setDaemon(true);
            return thread;
        });
        server.setExecutor(executor);
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    public boolean running() {
        return server != null;
    }

    public int port() {
        return server != null ? server.getAddress().getPort() : port;
    }

    // ---------------------------------------------------------------- handling

    private void handle(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        URI uri = exchange.getRequestURI();
        Map<String, String> query = parseQuery(uri.getRawQuery());
        String body = readBody(exchange);
        boolean authorized = authorized(exchange, query);

        CompanionRouter.Response response;
        try {
            response = router.route(method, uri.getPath(), query, body, authorized);
        } catch (RuntimeException e) {
            response = new CompanionRouter.Response(500, "{\"error\":\"internal error\"}");
        }
        respond(exchange, response.status(), response.json());
    }

    private boolean authorized(HttpExchange exchange, Map<String, String> query) {
        if (token.isBlank()) return false;
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (header != null && header.startsWith("Bearer ")
            && constantTimeEquals(header.substring("Bearer ".length()), token)) {
            return true;
        }
        // EventSource cannot set headers, so the token may be supplied as a query parameter.
        String param = query.get("token");
        return param != null && constantTimeEquals(param, token);
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        byte[] bytes = exchange.getRequestBody().readNBytes(MAX_BODY);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static Map<String, String> parseQuery(String raw) {
        Map<String, String> map = new HashMap<>();
        if (raw == null || raw.isBlank()) return map;
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) {
                map.put(decode(pair), "");
            } else {
                map.put(decode(pair.substring(0, eq)), decode(pair.substring(eq + 1)));
            }
        }
        return map;
    }

    private static String decode(String value) {
        return java.net.URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a.length() != b.length()) return false;
        int result = 0;
        for (int i = 0; i < a.length(); i++) result |= a.charAt(i) ^ b.charAt(i);
        return result == 0;
    }

    private static void respond(HttpExchange exchange, int code, String body) throws IOException {
        byte[] bytes = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(code, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length > 0) {
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        } else {
            exchange.close();
        }
    }
}
