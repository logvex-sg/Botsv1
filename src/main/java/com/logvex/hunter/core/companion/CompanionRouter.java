package com.logvex.hunter.core.companion;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.stats.SessionRecord;
import com.logvex.hunter.core.target.TargetStore;
import com.logvex.hunter.core.util.Json;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Turns an HTTP request into a JSON response for the companion surface.
 *
 * <p>This class is Minecraft-free and has no sockets: the {@link CompanionServer} hands it the
 * parsed request and writes back whatever it returns. That split keeps every route unit-testable
 * without a running game or a bound port.
 *
 * <p>The route set matches the Logvex Fleet Manager's {@code HunterClient}: {@code /health} plus
 * the {@code /api/v1/*} read endpoints and the {@code command}/{@code notify}/{@code bot} actions.
 */
public final class CompanionRouter {
    /** A status code and a JSON body. */
    public record Response(int status, String json) {
        public static Response of(int status, String json) {
            return new Response(status, json);
        }
    }

    private final CompanionApi api;

    public CompanionRouter(CompanionApi api) {
        this.api = api;
    }

    public Response route(String method, String path, Map<String, String> query, String body, boolean authorized) {
        String verb = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
        String route = normalize(path);

        if (route.equals("/health")) {
            return Response.of(200, health());
        }
        if (route.equals("/") || route.equals("/index.html")) {
            return Response.of(200, Json.write(Map.of("name", "Logvex Hunter", "api", "/api/v1/snapshot")));
        }

        if (!authorized) {
            return Response.of(401, error("unauthorized"));
        }
        if (!route.startsWith("/api/v1")) {
            return Response.of(404, error("not found"));
        }

        return switch (route) {
            case "/api/v1/snapshot" -> Response.of(200, snapshot());
            case "/api/v1/players" -> Response.of(200, Json.write(Map.of("players", api.playerViews())));
            case "/api/v1/targets" -> Response.of(200, targets());
            case "/api/v1/modules" -> Response.of(200, Json.write(Map.of("modules", api.moduleViews())));
            case "/api/v1/stats" -> Response.of(200, stats());
            case "/api/v1/events", "/api/v1/chat" -> Response.of(200, events(query));
            case "/api/v1/tasks" -> Response.of(200, tasks());
            case "/api/v1/command" -> verb.equals("POST") ? command(body) : Response.of(405, error("method not allowed"));
            case "/api/v1/notify" -> verb.equals("POST") ? notify(body) : Response.of(405, error("method not allowed"));
            default -> route.startsWith("/api/v1/bot")
                ? bot(verb, route, body)
                : Response.of(404, error("not found"));
        };
    }

    // ---------------------------------------------------------------- routes

    private String health() {
        Map<String, Object> map = Json.object();
        map.put("ok", true);
        map.put("name", "Logvex Hunter");
        map.put("version", api.version());
        map.put("connected", api.connected());
        map.put("running", api.core().running());
        return Json.write(map);
    }

    private String snapshot() {
        HunterCore core = api.core();
        Map<String, Object> map = Json.object();
        map.put("bot", api.botView());
        map.put("players", api.playerViews());
        map.put("targets", targetList());
        map.put("modules", api.moduleViews());
        map.put("stats", statsMap());
        Map<String, Object> meta = Json.object();
        meta.put("version", api.version());
        meta.put("running", core.running());
        meta.put("emergencyStop", core.config().emergencyStop());
        meta.put("profile", core.config().activeProfileName());
        meta.put("visible", core.tracker().visibleCount());
        meta.put("targets", core.targets().size());
        map.put("meta", meta);
        return Json.write(map);
    }

    private String targets() {
        return Json.write(Map.of("targets", targetList()));
    }

    private List<Object> targetList() {
        List<Object> list = new ArrayList<>();
        for (TargetEntry entry : api.core().targets().all()) {
            list.add(TargetStore.entryToJson(entry));
        }
        return list;
    }

    private String stats() {
        return Json.write(statsMap());
    }

    private Map<String, Object> statsMap() {
        HunterCore core = api.core();
        var stats = core.statistics();
        Map<String, Object> map = Json.object();
        map.put("kills", stats.totalKills());
        map.put("deaths", stats.totalDeaths());
        map.put("kd", stats.kdRatio());
        map.put("sessions", stats.sessions());
        map.put("encounters", stats.playerEncounters());
        map.put("tracked", stats.targetsTracked());
        map.put("manualSwitches", stats.manualTargetSwitches());
        map.put("playtimeMillis", stats.totalPlaytimeMillis());
        map.put("equipment", stats.equipmentUses());
        map.put("moduleActivations", stats.moduleActivations());
        map.put("killsByTarget", stats.killsByTarget());
        SessionRecord session = core.sessions().current();
        if (session != null) {
            map.put("sessionId", session.id);
            map.put("sessionStartedAt", session.startedAt);
            map.put("sessionServer", session.server);
        }
        return map;
    }

    private String events(Map<String, String> query) {
        long since = parseLong(query.get("since"), 0);
        int limit = (int) Math.max(1, Math.min(200, parseLong(query.get("limit"), 50)));
        List<Object> list = new ArrayList<>();
        for (CombatEvent event : api.core().statistics().recentEvents(limit)) {
            if (event.timestamp < since) continue;
            list.add(event.toJson());
        }
        return Json.write(Map.of("events", list));
    }

    private String tasks() {
        List<Object> list = new ArrayList<>();
        SessionRecord session = api.core().sessions().current();
        if (session != null) {
            Map<String, Object> map = Json.object();
            map.put("id", session.id);
            map.put("kind", "session");
            map.put("server", session.server);
            map.put("startedAt", session.startedAt);
            map.put("state", session.isOpen() ? "running" : "stopped");
            list.add(map);
        }
        var target = api.core().currentTarget();
        if (target != null) {
            Map<String, Object> map = Json.object();
            map.put("id", "target:" + target.name());
            map.put("kind", "target");
            map.put("name", target.name());
            map.put("distance", target.distance);
            map.put("state", "tracking");
            list.add(map);
        }
        return Json.write(Map.of("tasks", list));
    }

    private Response command(String body) {
        String command = readString(body, "command");
        if (command == null || command.isBlank()) return Response.of(400, error("command is required"));
        String result = api.handleCommand(command.trim());
        Map<String, Object> map = Json.object();
        map.put("ok", true);
        map.put("command", command.trim());
        map.put("result", result == null ? "" : result);
        return Response.of(200, Json.write(map));
    }

    private Response notify(String body) {
        String message = readString(body, "message");
        if (message == null || message.isBlank()) return Response.of(400, error("message is required"));
        api.notify(message.trim());
        return Response.of(200, Json.write(Map.of("ok", true, "message", message.trim())));
    }

    private Response bot(String verb, String route, String body) {
        if (!verb.equals("POST")) return Response.of(405, error("method not allowed"));
        String action = route.length() > "/api/v1/bot".length()
            ? route.substring("/api/v1/bot/".length())
            : readString(body, "action");
        if (action == null || action.isBlank()) return Response.of(400, error("action is required"));
        String result = api.handleCommand("bot " + action.trim());
        Map<String, Object> map = Json.object();
        map.put("ok", true);
        map.put("action", action.trim());
        map.put("result", result == null ? "" : result);
        return Response.of(200, Json.write(map));
    }

    // -------------------------------------------------------------- helpers

    private static String normalize(String path) {
        if (path == null || path.isBlank()) return "/";
        String p = path.trim();
        if (p.length() > 1 && p.endsWith("/")) p = p.substring(0, p.length() - 1);
        return p;
    }

    private static String readString(String body, String key) {
        if (body == null || body.isBlank()) return null;
        try {
            return Json.getString(Json.parseObject(body), key, null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static long parseLong(String value, long fallback) {
        if (value == null) return fallback;
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String error(String message) {
        return Json.write(Map.of("error", message));
    }
}
