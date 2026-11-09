package com.logvex.hunter.core;

import com.logvex.hunter.core.swarm.SwarmCommandGate;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Tests the broadcast gate that keeps one typo from arming combat on the whole fleet. */
class SwarmCommandGateTest {

    @Test
    void readOnlyCommandsAreBroadcastable() {
        assertTrue(SwarmCommandGate.inspect("status", false).allowed());
        assertTrue(SwarmCommandGate.inspect("save", false).allowed());
        assertTrue(SwarmCommandGate.inspect("hud list", false).allowed());
        assertTrue(SwarmCommandGate.inspect("settings", false).allowed());
        assertTrue(SwarmCommandGate.inspect("target list", false).allowed());
        assertTrue(SwarmCommandGate.inspect("profile list", false).allowed());
        assertTrue(SwarmCommandGate.inspect("notify regroup", false).allowed());
    }

    @Test
    void nonCombatSettingsMayBeBroadcastButCombatSettingsMayNot() {
        assertTrue(SwarmCommandGate.inspect("set equipment-manager min-durability 20", false).allowed());
        assertFalse(SwarmCommandGate.inspect("set auto-totem threshold 2", false).allowed());
        assertFalse(SwarmCommandGate.inspect("set combat-coordinator protect-friends true", false).allowed());
    }

    @Test
    void emergencyStopIsAlwaysBroadcastable() {
        assertTrue(SwarmCommandGate.inspect("emergency-stop", false).allowed());
        assertTrue(SwarmCommandGate.inspect("estop", false).allowed());
        assertTrue(SwarmCommandGate.inspect("panic", false).allowed());
    }

    @Test
    void combatTogglesAreRefusedByDefault() {
        var verdict = SwarmCommandGate.inspect("module kill-aura on", false);
        assertFalse(verdict.allowed());
        assertTrue(verdict.reason().contains("allow-combat-broadcast"));

        assertFalse(SwarmCommandGate.inspect("module auto-totem on", false).allowed());
        assertFalse(SwarmCommandGate.inspect("set auto-weapon range 4", false).allowed());
        assertFalse(SwarmCommandGate.inspect("toggle crystal-aura", false).allowed());
    }

    @Test
    void combatChangesAreAllowedWhenExplicitlyOptedIn() {
        assertTrue(SwarmCommandGate.inspect("module kill-aura on", true).allowed());
        assertTrue(SwarmCommandGate.inspect("set auto-weapon range 4", true).allowed());
    }

    @Test
    void lifecycleChangesMustTargetOneWorker() {
        assertFalse(SwarmCommandGate.inspect("start", false).allowed());
        assertFalse(SwarmCommandGate.inspect("stop", false).allowed());
        assertFalse(SwarmCommandGate.inspect("pause", false).allowed());
        assertFalse(SwarmCommandGate.inspect("reload", false).allowed());
        assertTrue(SwarmCommandGate.inspect("start", false).reason().contains("one worker at a time"));
    }

    @Test
    void unknownVerbsAreRefused() {
        assertFalse(SwarmCommandGate.inspect("frobnicate the thing", false).allowed());
        assertFalse(SwarmCommandGate.inspect("", false).allowed());
        assertFalse(SwarmCommandGate.inspect(null, false).allowed());
    }

    @Test
    void combatChangeDetectsModulesAndSettings() {
        assertTrue(SwarmCommandGate.isCombatChange("module", "module kill-aura on"));
        assertTrue(SwarmCommandGate.isCombatChange("set", "set combat-coordinator protect-friends true"));
        assertTrue(SwarmCommandGate.isCombatChange("set", "set kill-aura range 3"));
        assertFalse(SwarmCommandGate.isCombatChange("module", "module player-tracker on"));
        assertFalse(SwarmCommandGate.isCombatChange("set", "set equipment-manager min-durability 20"));
    }

    @Test
    void armsCombatMatchesTheGateForSingleSends() {
        assertTrue(SwarmCommandGate.armsCombat("module kill-aura on"));
        assertTrue(SwarmCommandGate.armsCombat("set auto-totem threshold 2"));
        assertFalse(SwarmCommandGate.armsCombat("module kill-aura off"));
        assertFalse(SwarmCommandGate.armsCombat("module player-tracker on"));
        assertFalse(SwarmCommandGate.armsCombat("status"));
    }
}
