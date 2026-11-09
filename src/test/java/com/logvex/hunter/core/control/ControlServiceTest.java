package com.logvex.hunter.core.control;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Tests the dispatch table that both the chat command and the HTTP command route share. */
class ControlServiceTest {

    /** Records every call so the tests can assert on the dispatch, without a game. */
    private static final class RecordingTarget implements ControlTarget {
        final List<String> calls = new ArrayList<>();
        String moduleResult = "ok";

        @Override public String lifecycle(ControlAction.Lifecycle.Kind kind) {
            calls.add("lifecycle:" + kind);
            return "lifecycle " + kind;
        }

        @Override public String setModule(String module, Boolean enable) {
            calls.add("module:" + module + ":" + enable);
            return "module " + module;
        }

        @Override public List<ModuleView> modules(String module) {
            calls.add("modules:" + module);
            List<SettingView> settings = List.of(new SettingView(
                "range", "Range", "", "double", "64.0", "64.0", false, 1, 256, List.of()));
            return List.of(new ModuleView("player-tracker", "Player Tracker", "", "Logvex Hunter",
                true, true, settings));
        }

        @Override public String setSetting(String module, String setting, String value) {
            calls.add("set:" + module + ":" + setting + ":" + value);
            return moduleResult;
        }

        @Override public String profile(ControlAction.Profile.Kind kind, String name) {
            calls.add("profile:" + kind + ":" + name);
            return "profile " + kind;
        }

        @Override public List<ProfileView> profiles() {
            return List.of();
        }

        @Override public String hud(String element, boolean list) {
            calls.add("hud:" + element + ":" + list);
            return "hud";
        }

        @Override public List<HudView> hudViews() {
            return List.of();
        }

        @Override public String focus(String player) {
            calls.add("focus:" + player);
            return "focus " + player;
        }

        @Override public String target(ControlAction.Target action) {
            calls.add("target:" + action.op() + ":" + action.name());
            return "target " + action.op();
        }

        @Override public String listTargets(String category) {
            calls.add("targets:" + category);
            return "priority: Griefer(prio 1)";
        }

        @Override public String data(ControlAction.Data.Kind kind) {
            calls.add("data:" + kind);
            return "data " + kind;
        }

        @Override public void notify(String message) {
            calls.add("notify:" + message);
        }
    }

    private final RecordingTarget target = new RecordingTarget();
    private final ControlService service = new ControlService(target);

    @Test
    void unknownLineIsReportedNotThrown() {
        String result = service.run("frobnicate");
        assertTrue(result.startsWith("unrecognised command"));
        assertTrue(target.calls.isEmpty());
    }

    @Test
    void lifecycleDispatches() {
        assertEquals("lifecycle START", service.run("start"));
        assertEquals(List.of("lifecycle:START"), target.calls);
    }

    @Test
    void moduleToggleDispatches() {
        service.run("module kill-aura off");
        assertEquals(List.of("module:kill-aura:false"), target.calls);
    }

    @Test
    void setDispatchesWithSpacesIntact() {
        service.run("set messages prefix hello there");
        assertEquals(List.of("set:messages:prefix:hello there"), target.calls);
    }

    @Test
    void getRendersModuleAndSettingNames() {
        String result = service.run("settings player-tracker");
        assertTrue(result.contains("player-tracker on"));
        assertTrue(result.contains("range=64.0"));
        assertEquals(List.of("modules:player-tracker"), target.calls);
    }

    @Test
    void profileHudFocusAndTargetDispatch() {
        service.run("profile use pvp");
        service.run("hud logvex-target");
        service.run("focus Steve");
        service.run("target add Griefer bot");
        service.run("reload");
        service.run("notify hello");
        assertEquals(List.of(
            "profile:USE:pvp",
            "hud:logvex-target:false",
            "focus:Steve",
            "target:ADD:Griefer",
            "data:RELOAD",
            "notify:hello"
        ), target.calls);
    }

    @Test
    void targetListDispatches() {
        assertEquals("priority: Griefer(prio 1)", service.run("target list"));
        assertEquals(List.of("targets:null"), target.calls);
    }

    @Test
    void legacyBotAliasDispatches() {
        assertEquals("lifecycle PAUSE", service.run("bot pause"));
        assertEquals(List.of("lifecycle:PAUSE"), target.calls);
    }

    @Test
    void notifyReturnsAConfirmation() {
        assertEquals("notified", service.run("notify hi"));
    }

    @Test
    void executeAcceptsAnAlreadyParsedAction() {
        ControlAction action = ControlParser.parse("stop");
        assertEquals("lifecycle STOP", service.execute(action));
    }
}
