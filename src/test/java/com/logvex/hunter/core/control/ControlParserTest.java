package com.logvex.hunter.core.control;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Tests the text -> action grammar shared by the chat commands and the HTTP command route. */
class ControlParserTest {

    @Test
    void lifecycleVerbsMapToKinds() {
        assertEquals(ControlAction.Lifecycle.Kind.START, lifecycle("start"));
        assertEquals(ControlAction.Lifecycle.Kind.STOP, lifecycle("stop"));
        assertEquals(ControlAction.Lifecycle.Kind.EMERGENCY_STOP, lifecycle("emergency-stop"));
        assertEquals(ControlAction.Lifecycle.Kind.EMERGENCY_STOP, lifecycle("estop"));
        assertEquals(ControlAction.Lifecycle.Kind.EMERGENCY_STOP, lifecycle("panic"));
        assertEquals(ControlAction.Lifecycle.Kind.CLEAR_STOP, lifecycle("clear-stop"));
        assertEquals(ControlAction.Lifecycle.Kind.PAUSE, lifecycle("pause"));
        assertEquals(ControlAction.Lifecycle.Kind.RESUME, lifecycle("resume"));
        assertEquals(ControlAction.Lifecycle.Kind.SAVE, lifecycle("save"));
        assertEquals(ControlAction.Lifecycle.Kind.STATUS, lifecycle("status"));
    }

    private ControlAction.Lifecycle.Kind lifecycle(String line) {
        return ((ControlAction.Lifecycle) ControlParser.parse(line)).kind();
    }

    @Test
    void moduleToggleIsTriState() {
        ControlAction.ModuleToggle on = (ControlAction.ModuleToggle) ControlParser.parse("module kill-aura on");
        assertEquals("kill-aura", on.module());
        assertEquals(Boolean.TRUE, on.enable());

        ControlAction.ModuleToggle off = (ControlAction.ModuleToggle) ControlParser.parse("module kill-aura off");
        assertEquals(Boolean.FALSE, off.enable());

        // A bare "toggle" (or a missing action) must be null so the executor flips the current state.
        assertNull(((ControlAction.ModuleToggle) ControlParser.parse("module kill-aura")).enable());
        assertNull(((ControlAction.ModuleToggle) ControlParser.parse("toggle kill-aura")).enable());
    }

    @Test
    void setKeepsSpacesInTheValue() {
        ControlAction.SettingSet set = (ControlAction.SettingSet) ControlParser.parse(
            "set messages prefix hello there world");
        assertEquals("messages", set.module());
        assertEquals("prefix", set.setting());
        assertEquals("hello there world", set.value());
    }

    @Test
    void setRequiresAModuleSettingAndValue() {
        assertNull(ControlParser.parse("set"));
        assertNull(ControlParser.parse("set module"));
        assertNull(ControlParser.parse("set module setting"));
    }

    @Test
    void settingsReadsOneOrAll() {
        assertNull(((ControlAction.ModuleGet) ControlParser.parse("settings")).module());
        assertEquals("player-tracker", ((ControlAction.ModuleGet) ControlParser.parse("settings player-tracker")).module());
    }

    @Test
    void profileVerbsParse() {
        assertEquals(ControlAction.Profile.Kind.LIST, profile("profile").kind());
        assertEquals(ControlAction.Profile.Kind.LIST, profile("profile list").kind());
        ControlAction.Profile use = profile("profile use pvp");
        assertEquals(ControlAction.Profile.Kind.USE, use.kind());
        assertEquals("pvp", use.name());
        assertEquals(ControlAction.Profile.Kind.CREATE, profile("profile create mining").kind());
        assertEquals(ControlAction.Profile.Kind.DELETE, profile("profile delete mining").kind());
        assertNull(ControlParser.parse("profile use"));
    }

    private ControlAction.Profile profile(String line) {
        return (ControlAction.Profile) ControlParser.parse(line);
    }

    @Test
    void hudListsOrToggles() {
        assertTrue(((ControlAction.Hud) ControlParser.parse("hud")).list());
        assertTrue(((ControlAction.Hud) ControlParser.parse("hud list")).list());
        ControlAction.Hud toggle = (ControlAction.Hud) ControlParser.parse("hud logvex-target");
        assertFalse(toggle.list());
        assertEquals("logvex-target", toggle.element());
    }

    @Test
    void targetEditsParse() {
        ControlAction.Target add = (ControlAction.Target) ControlParser.parse("target add Griefer bot");
        assertEquals(ControlAction.Target.Op.ADD, add.op());
        assertEquals("Griefer", add.name());
        assertEquals("bot", add.category());

        ControlAction.Target remove = (ControlAction.Target) ControlParser.parse("target remove Griefer");
        assertEquals(ControlAction.Target.Op.REMOVE, remove.op());

        ControlAction.Target prio = (ControlAction.Target) ControlParser.parse("target priority Griefer 1");
        assertEquals(ControlAction.Target.Op.SET_PRIORITY, prio.op());
        assertEquals(1, prio.priority());

        ControlAction.Target notes = (ControlAction.Target) ControlParser.parse("target notes Griefer owns a bot farm");
        assertEquals(ControlAction.Target.Op.SET_NOTES, notes.op());
        assertEquals("owns a bot farm", notes.notes());

        ControlAction.Target category = (ControlAction.Target) ControlParser.parse("target category Griefer friend");
        assertEquals(ControlAction.Target.Op.SET_CATEGORY, category.op());
        assertEquals("friend", category.category());
    }

    @Test
    void targetPriorityRejectsNonNumeric() {
        assertNull(ControlParser.parse("target priority Griefer high"));
    }

    @Test
    void notifyKeepsTheWholeMessage() {
        ControlAction.Notify notify = (ControlAction.Notify) ControlParser.parse("notify target spotted at spawn");
        assertEquals("target spotted at spawn", notify.message());
        assertNull(ControlParser.parse("notify"));
    }

    @Test
    void focusAndClear() {
        assertEquals("Steve", ((ControlAction.Focus) ControlParser.parse("focus Steve")).player());
        assertNull(((ControlAction.Focus) ControlParser.parse("clear-target")).player());
    }

    @Test
    void dataVerbsParse() {
        assertEquals(ControlAction.Data.Kind.RELOAD, ((ControlAction.Data) ControlParser.parse("reload")).kind());
        assertEquals(ControlAction.Data.Kind.EXPORT, ((ControlAction.Data) ControlParser.parse("export")).kind());
    }

    @Test
    void unknownAndEmptyLinesReturnNull() {
        assertNull(ControlParser.parse(""));
        assertNull(ControlParser.parse("   "));
        assertNull(ControlParser.parse(null));
        assertNull(ControlParser.parse("frobnicate the widget"));
    }

    @Test
    void categoryValidation() {
        assertTrue(ControlParser.isValidCategory("priority"));
        assertTrue(ControlParser.isValidCategory("IGNORE"));
        assertTrue(ControlParser.isValidCategory("friend"));
        assertFalse(ControlParser.isValidCategory("nonsense"));
        assertFalse(ControlParser.isValidCategory(null));
    }

    @Test
    void parsingIsCaseInsensitive() {
        assertInstanceOf(ControlAction.Lifecycle.class, ControlParser.parse("START"));
        ControlAction.ModuleToggle toggle = (ControlAction.ModuleToggle) ControlParser.parse("MODULE Kill-Aura ON");
        assertEquals("kill-aura", toggle.module());
        assertEquals(Boolean.TRUE, toggle.enable());
    }
}
