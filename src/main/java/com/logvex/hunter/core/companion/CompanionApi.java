package com.logvex.hunter.core.companion;

import com.logvex.hunter.core.HunterCore;

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
