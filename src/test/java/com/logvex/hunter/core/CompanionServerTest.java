package com.logvex.hunter.core;

import com.logvex.hunter.core.companion.CompanionApi;
import com.logvex.hunter.core.companion.CompanionRouter;
import com.logvex.hunter.core.companion.CompanionServer;
import com.logvex.hunter.core.config.ConfigPaths;
import com.logvex.hunter.core.util.Json;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** End-to-end tests for the companion socket server: real HTTP over a loopback port. */
class CompanionServerTest {

    private static final class StubApi implements CompanionApi {
        final HunterCore core;
        final List<String> commands = new java.util.ArrayList<>();

        StubApi(HunterCore core) {
            this.core = core;
        }

        @Override public HunterCore core() { return core; }
        @Override public String version() { return "1.1.0"; }
        @Override public boolean connected() { return true; }
        @Override public Map<String, Object> botView() { return Map.of("health", 20.0); }
        @Override public List<Map<String, Object>> playerViews() { return List.of(); }
        @Override public List<Map<String, Object>> moduleViews() { return List.of(); }
        @Override public String handleCommand(String command) {
            commands.add(command);
            return "ok";
        }
        @Override public void notify(String message) {}
    }

    private static final HttpClient CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2)).build();

    private HttpResponse<String> get(String url, String token) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url)).GET()
            .timeout(Duration.ofSeconds(3));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        return CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String url, String token, String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .timeout(Duration.ofSeconds(3));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        return CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void servesHealthAndAuthenticatedRoutes(@TempDir Path dir) throws Exception {
        HunterCore core = new HunterCore(new ConfigPaths(dir));
        core.load();
        CompanionServer server = new CompanionServer(0, "secret-token", false,
            new CompanionRouter(new StubApi(core)));
        server.start();
        try {
            int port = server.port();
            String base = "http://127.0.0.1:" + port;

            HttpResponse<String> health = get(base + "/health", null);
            assertEquals(200, health.statusCode());
            assertTrue(health.body().contains("1.1.0"));

            HttpResponse<String> unauthorized = get(base + "/api/v1/snapshot", null);
            assertEquals(401, unauthorized.statusCode());

            HttpResponse<String> authorized = get(base + "/api/v1/snapshot", "secret-token");
            assertEquals(200, authorized.statusCode());
            Map<String, Object> body = Json.parseObject(authorized.body());
            assertTrue(body.containsKey("bot"));
            assertTrue(body.containsKey("stats"));
        } finally {
            server.stop();
        }
    }

    @Test
    void tokenMayBeSuppliedAsQueryParameter(@TempDir Path dir) throws Exception {
        HunterCore core = new HunterCore(new ConfigPaths(dir));
        core.load();
        CompanionServer server = new CompanionServer(0, "abc123", false,
            new CompanionRouter(new StubApi(core)));
        server.start();
        try {
            HttpResponse<String> response = get("http://127.0.0.1:" + server.port()
                + "/api/v1/players?token=abc123", null);
            assertEquals(200, response.statusCode());
        } finally {
            server.stop();
        }
    }

    @Test
    void commandOverHttpReachesTheApi(@TempDir Path dir) throws Exception {
        HunterCore core = new HunterCore(new ConfigPaths(dir));
        core.load();
        StubApi api = new StubApi(core);
        CompanionServer server = new CompanionServer(0, "t", false, new CompanionRouter(api));
        server.start();
        try {
            HttpResponse<String> response = post("http://127.0.0.1:" + server.port() + "/api/v1/command",
                "t", "{\"command\":\"status\"}");
            assertEquals(200, response.statusCode());
            assertEquals(List.of("status"), api.commands);
        } finally {
            server.stop();
        }
    }

    @Test
    void emptyTokenDeniesAllApiAccess(@TempDir Path dir) throws Exception {
        HunterCore core = new HunterCore(new ConfigPaths(dir));
        core.load();
        CompanionServer server = new CompanionServer(0, "", false, new CompanionRouter(new StubApi(core)));
        server.start();
        try {
            HttpResponse<String> response = get("http://127.0.0.1:" + server.port() + "/api/v1/snapshot", null);
            assertEquals(401, response.statusCode());
            assertFalse(response.body().isBlank());
        } finally {
            server.stop();
        }
    }

    @Test
    void stopReleasesThePort(@TempDir Path dir) throws Exception {
        HunterCore core = new HunterCore(new ConfigPaths(dir));
        core.load();
        CompanionServer server = new CompanionServer(0, "t", false, new CompanionRouter(new StubApi(core)));
        server.start();
        int port = server.port();
        server.stop();

        assertFalse(server.running());
        try {
            get("http://127.0.0.1:" + port + "/health", null);
        } catch (Exception expected) {
            return;
        }
        // A fresh server on the same explicit port must succeed.
        CompanionServer second = new CompanionServer(port, "t", false, new CompanionRouter(new StubApi(core)));
        second.start();
        second.stop();
    }
}
