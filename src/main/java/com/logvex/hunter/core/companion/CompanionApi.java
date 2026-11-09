package com.logvex.hunter.core.companion;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.control.HudView;
import com.logvex.hunter.core.control.ModuleView;
import com.logvex.hunter.core.control.ProfileView;

import java.util.List;
import java.util.Map;

/**
 * Everything the companion HTTP surface needs from a running client.
 *
 * <p>The interface is deliberately Minecraft-free so the router and server can be unit-tested
 * without a game. The game layer supplies an implementation that reads the client on the client
 * thread; the router never touches game state directly.
 */
public interface CompanionApi {
    /** The shared addon state (targets, statistics, configuration). */
    HunterCore core();

    /** The addon version string reported by {@code /health}. */
    String version();

    /** Whether the client is currently connected to a world. */
    boolean connected();

    /** Local player and session summary: position, dimension, health, armour, food, weapon. */
    Map<String, Object> botView();

    /** Visible players as plain maps. */
    List<Map<String, Object>> playerViews();

    /** This addon's modules and their enabled state. */
    List<Map<String, Object>> moduleViews();

    /** Full detail (including settings) for one module, or all modules when {@code name} is null. */
    default List<ModuleView> modules(String name) {
        return List.of();
    }

    /** Changes one setting of one module and returns a human-readable result. */
    default String setSetting(String module, String setting, String value) {
        return "settings are not available";
    }

    /** The available profiles. */
    default List<ProfileView> profiles() {
        return List.of();
    }

    /** Switches to a profile and returns a human-readable result. */
    default String switchProfile(String name) {
        return "profiles are not available";
    }

    /** The HUD elements. */
    default List<HudView> hudViews() {
        return List.of();
    }

    /** Toggles a HUD element and returns a human-readable result. */
    default String toggleHud(String element) {
        return "hud control is not available";
    }

    /**
     * Runs an administrative command and returns a human-readable result.
     *
     * <p>The implementation must hop onto the client thread; commands never touch game state from
     * the HTTP worker.
     */
    String handleCommand(String command);

    /** Shows a local notification in chat. */
    void notify(String message);
}
