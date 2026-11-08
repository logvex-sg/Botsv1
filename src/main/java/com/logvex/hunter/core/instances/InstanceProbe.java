package com.logvex.hunter.core.instances;

import com.logvex.hunter.core.util.Json;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * Fetches the read-only status of another instance.
 *
 * <p>Communication is explicit and authenticated: the probe performs one HTTP request against the
 * instance's own endpoint with the shared token and parses the JSON body into {@link InstanceStats}.
 * It never touches another client's world state.
 */
public final class InstanceProbe {
    public static final String STATUS_PATH = "/api/hunter/status";
    public static final String STOP_PATH = "/api/hunter/emergency-stop";

    private InstanceProbe() {}

    public record Result(InstanceStats stats, long latencyMillis, String error) {
        public boolean ok() {
            return stats != null && error == null;
        }
    }

    public static Result fetch(InstanceRecord record, int timeoutMillis) {
        return fetch(record.host(), record.port(), record.token(), timeoutMillis);
    }

    public static Result fetch(String host, int port, String token, int timeoutMillis) {
        long start = System.nanoTime();
        try {
            HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(Math.max(200, timeoutMillis)))
                .build();
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://" + host + ":" + port + STATUS_PATH))
                .timeout(Duration.ofMillis(Math.max(200, timeoutMillis)))
                .header("Authorization", "Bearer " + (token == null ? "" : token))
                .GET()
                .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            long latency = (System.nanoTime() - start) / 1_000_000;
            if (response.statusCode() != 200) {
                return new Result(null, latency, "HTTP " + response.statusCode());
            }
            return new Result(InstanceStats.parseResponse(response.body()), latency, null);
        } catch (Exception e) {
            long latency = (System.nanoTime() - start) / 1_000_000;
            return new Result(null, latency, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** Sends the per-instance emergency stop. Returns {@code null} on success, an error otherwise. */
    public static String emergencyStop(InstanceRecord record, int timeoutMillis) {
        return post(record.host(), record.port(), record.token(), STOP_PATH, timeoutMillis);
    }

    /** Sends a generic command with a JSON body. Returns {@code null} on success. */
    public static String post(String host, int port, String token, String path, int timeoutMillis) {
        try {
            HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(Math.max(200, timeoutMillis)))
                .build();
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://" + host + ":" + port + path))
                .timeout(Duration.ofMillis(Math.max(200, timeoutMillis)))
                .header("Authorization", "Bearer " + (token == null ? "" : token))
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) return "HTTP " + response.statusCode();
            return null;
        } catch (Exception e) {
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    /** Builds this instance's own status document, used by its control endpoint. */
    public static Map<String, Object> statusDocument(InstanceStats self) {
        return self == null ? Json.object() : self.toJson();
    }
}
