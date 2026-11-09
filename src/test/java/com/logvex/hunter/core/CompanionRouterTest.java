package com.logvex.hunter.core;

import com.logvex.hunter.core.companion.CompanionApi;
import com.logvex.hunter.core.companion.CompanionRouter;
import com.logvex.hunter.core.config.ConfigPaths;
import com.logvex.hunter.core.config.HunterConfig;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.util.Json;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Tests the Minecraft-free companion HTTP router without a game or a socket. */
class CompanionRouterTest {

    /** A stub API that reports fixed data and records the commands it received. */
    private static final class StubApi implements CompanionApi {
        final HunterCore core;
        final List<String> commands = new java.util.ArrayList<>();
        final List<String> notifications = new java.util.ArrayList<>();
        boolean connected = true;

        StubApi(HunterCore core) {
            this.core = core;
        }

        @Override public HunterCore core() { return core; }
        @Override public String version() { return "9.9.9-test"; }
        @Override public boolean connected() { return connected; }

        @Override public Map<String, Object> botView() {
            return Map.of("connected", connected, "health", 20.0, "server", "6b6t.org");
        }

        @Override public List<Map<String, Object>> playerViews() {
            return List.of(Map.of("name", "Steve", "distance", 12.5));
        }

        @Override public List<Map<String, Object>> moduleViews() {
            return List.of(Map.of("name", "player-tracker", "enabled", true));
        }

        @Override public List<com.logvex.hunter.core.control.ModuleView> modules(String name) {
            if (name != null && !name.equalsIgnoreCase("player-tracker")) return List.of();
            var settings = List.of(new com.logvex.hunter.core.control.SettingView(
                "range", "Range", "", "double", "64.0", "64.0", false, 1, 256, List.of()));
            return List.of(new com.logvex.hunter.core.control.ModuleView(
                "player-tracker", "Player Tracker", "", "Logvex Hunter", true, true, settings));
        }

        @Override public String setSetting(String module, String setting, String value) {
            commands.add("set " + module + " " + setting + " " + value);
            return module + "." + setting + " = " + value;
        }

        @Override public List<com.logvex.hunter.core.control.ProfileView> profiles() {
            return List.of(new com.logvex.hunter.core.control.ProfileView(
                "default", true, 64, 10, "priority", true, true, true));
        }

        @Override public String switchProfile(String name) {
            commands.add("profile " + name);
            return "active profile is now " + name;
        }

        @Override public List<com.logvex.hunter.core.control.HudView> hudViews() {
            return List.of(new com.logvex.hunter.core.control.HudView(
                "logvex-target", "Logvex Target", "Meteor", true, true));
        }

        @Override public String toggleHud(String element) {
            commands.add("hud " + element);
            return element + " is now off";
        }

        @Override public String handleCommand(String command) {
            commands.add(command);
            return "ok:" + command;
        }

        @Override public void notify(String message) {
            notifications.add(message);
        }
    }

    private StubApi api(Path dir) {
        HunterCore core = new HunterCore(new ConfigPaths(dir));
        core.load();
        return new StubApi(core);
    }

    @Test
    void healthIsPublicAndReportsVersion(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("GET", "/health", Map.of(), null, false);

        assertEquals(200, response.status());
        Map<String, Object> body = Json.parseObject(response.json());
        assertEquals("9.9.9-test", body.get("version"));
        assertEquals(Boolean.TRUE, body.get("ok"));
    }

    @Test
    void apiRoutesRequireAuthorization(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("GET", "/api/v1/snapshot", Map.of(), null, false);

        assertEquals(401, response.status());
        assertTrue(response.json().contains("unauthorized"));
    }

    @Test
    void snapshotCarriesBotTargetsModulesAndStats(@TempDir Path dir) {
        StubApi api = api(dir);
        api.core.targets().add(new TargetEntry(TargetCategory.PRIORITY, "Griefer"));
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response response = router.route("GET", "/api/v1/snapshot", Map.of(), null, true);

        assertEquals(200, response.status());
        Map<String, Object> body = Json.parseObject(response.json());
        assertTrue(body.containsKey("bot"));
        assertTrue(body.containsKey("targets"));
        assertTrue(body.containsKey("modules"));
        assertTrue(body.containsKey("stats"));

        @SuppressWarnings("unchecked")
        List<Object> targets = (List<Object>) body.get("targets");
        assertEquals(1, targets.size());
        @SuppressWarnings("unchecked")
        Map<String, Object> target = (Map<String, Object>) targets.get(0);
        assertEquals("Griefer", target.get("username"));
        assertEquals("priority", target.get("category"));
    }

    @Test
    void commandRouteInvokesTheApi(@TempDir Path dir) {
        StubApi api = api(dir);
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response response = router.route("POST", "/api/v1/command", Map.of(),
            "{\"command\":\"status\"}", true);

        assertEquals(200, response.status());
        assertEquals(List.of("status"), api.commands);
        Map<String, Object> body = Json.parseObject(response.json());
        assertEquals("ok:status", body.get("result"));
    }

    @Test
    void commandRouteRejectsMissingCommand(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("POST", "/api/v1/command", Map.of(), "{}", true);

        assertEquals(400, response.status());
    }

    @Test
    void notifyRouteDeliversMessage(@TempDir Path dir) {
        StubApi api = api(dir);
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response response = router.route("POST", "/api/v1/notify", Map.of(),
            "{\"message\":\"hello\"}", true);

        assertEquals(200, response.status());
        assertEquals(List.of("hello"), api.notifications);
    }

    @Test
    void botActionsMapToCommands(@TempDir Path dir) {
        StubApi api = api(dir);
        CompanionRouter router = new CompanionRouter(api);

        router.route("POST", "/api/v1/bot/pause", Map.of(), "{}", true);
        assertEquals(List.of("bot pause"), api.commands);
    }

    @Test
    void unknownRouteIsNotFound(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("GET", "/api/v1/nope", Map.of(), null, true);

        assertEquals(404, response.status());
    }

    @Test
    void wrongMethodIsRejected(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("GET", "/api/v1/command", Map.of(), null, true);

        assertEquals(405, response.status());
    }

    @Test
    void statsRouteExposesCounters(@TempDir Path dir) {
        StubApi api = api(dir);
        api.core.statistics().addKill("Bot01");
        api.core.statistics().addDeath();
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response response = router.route("GET", "/api/v1/stats", Map.of(), null, true);
        Map<String, Object> body = Json.parseObject(response.json());

        assertEquals(1, ((Number) body.get("kills")).intValue());
        assertEquals(1, ((Number) body.get("deaths")).intValue());
        assertFalse(body.containsKey("error"));
    }

    @Test
    void eventsRouteFiltersBySince(@TempDir Path dir) {
        StubApi api = api(dir);
        api.core.recordEvent(com.logvex.hunter.core.stats.CombatEvent.Kind.KILL, "one", "");
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response response = router.route("GET", "/api/v1/events",
            Map.of("since", String.valueOf(System.currentTimeMillis() + 10_000)), null, true);
        Map<String, Object> body = Json.parseObject(response.json());

        @SuppressWarnings("unchecked")
        List<Object> events = (List<Object>) body.get("events");
        assertTrue(events.isEmpty());
    }

    @Test
    void indexRouteDescribesTheApi(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("GET", "/", Map.of(), null, false);

        assertEquals(200, response.status());
        assertTrue(response.json().contains("Logvex Hunter"));
    }

    @Test
    void moduleDetailRouteReturnsSettings(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("GET", "/api/v1/modules/player-tracker",
            Map.of(), null, true);

        assertEquals(200, response.status());
        Map<String, Object> body = Json.parseObject(response.json());
        @SuppressWarnings("unchecked")
        Map<String, Object> module = (Map<String, Object>) body.get("module");
        assertEquals("player-tracker", module.get("name"));
        @SuppressWarnings("unchecked")
        List<Object> settings = (List<Object>) module.get("settings");
        assertEquals(1, settings.size());
    }

    @Test
    void unknownModuleDetailIsNotFound(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("GET", "/api/v1/modules/nope", Map.of(), null, true);
        assertEquals(404, response.status());
    }

    @Test
    void settingRouteAppliesTheChange(@TempDir Path dir) {
        StubApi api = api(dir);
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response response = router.route("POST", "/api/v1/settings", Map.of(),
            "{\"module\":\"player-tracker\",\"setting\":\"range\",\"value\":\"96\"}", true);

        assertEquals(200, response.status());
        assertEquals(List.of("set player-tracker range 96"), api.commands);
        assertTrue(response.json().contains("player-tracker.range = 96"));
    }

    @Test
    void settingRouteRequiresAllFields(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        CompanionRouter.Response response = router.route("POST", "/api/v1/settings", Map.of(),
            "{\"module\":\"player-tracker\"}", true);
        assertEquals(400, response.status());
    }

    @Test
    void profilesRouteListsAndSwitches(@TempDir Path dir) {
        StubApi api = api(dir);
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response list = router.route("GET", "/api/v1/profiles", Map.of(), null, true);
        assertEquals(200, list.status());
        assertTrue(list.json().contains("default"));

        CompanionRouter.Response use = router.route("POST", "/api/v1/profiles/pvp", Map.of(), "{}", true);
        assertEquals(200, use.status());
        assertEquals(List.of("profile pvp"), api.commands);
    }

    @Test
    void hudRouteListsAndToggles(@TempDir Path dir) {
        StubApi api = api(dir);
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response list = router.route("GET", "/api/v1/hud", Map.of(), null, true);
        assertEquals(200, list.status());
        assertTrue(list.json().contains("logvex-target"));

        CompanionRouter.Response toggle = router.route("POST", "/api/v1/hud/logvex-target", Map.of(), "{}", true);
        assertEquals(200, toggle.status());
        assertEquals(List.of("hud logvex-target"), api.commands);
    }

    @Test
    void hunterActionRouteRunsTheCommand(@TempDir Path dir) {
        StubApi api = api(dir);
        CompanionRouter router = new CompanionRouter(api);

        CompanionRouter.Response response = router.route("POST", "/api/v1/hunter/emergency-stop",
            Map.of(), "{}", true);

        assertEquals(200, response.status());
        assertEquals(List.of("emergency-stop"), api.commands);
    }

    @Test
    void controlRoutesRequirePostWhereTheyMutate(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        assertEquals(405, router.route("GET", "/api/v1/profiles/pvp", Map.of(), null, true).status());
        assertEquals(405, router.route("GET", "/api/v1/hud/logvex-target", Map.of(), null, true).status());
        assertEquals(405, router.route("GET", "/api/v1/hunter/start", Map.of(), null, true).status());
        assertEquals(405, router.route("GET", "/api/v1/settings", Map.of(), null, true).status());
    }

    @Test
    void controlRoutesRequireAuthorization(@TempDir Path dir) {
        CompanionRouter router = new CompanionRouter(api(dir));
        assertEquals(401, router.route("GET", "/api/v1/profiles", Map.of(), null, false).status());
        assertEquals(401, router.route("GET", "/api/v1/hud", Map.of(), null, false).status());
        assertEquals(401, router.route("GET", "/api/v1/modules/player-tracker", Map.of(), null, false).status());
    }
}
