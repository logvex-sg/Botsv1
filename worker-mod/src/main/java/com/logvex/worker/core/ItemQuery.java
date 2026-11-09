package com.logvex.worker.core;

import java.util.Locale;
import java.util.Map;

/**
 * Matches an inventory item against a host-supplied search term.
 *
 * <p>A host operator types "diamond", not "minecraft:diamond", so matching is forgiving: an exact
 * id, a namespaced short id, a path substring or a display-name substring all match. A small alias
 * table covers the handful of items that people name differently from their id.
 */
public final class ItemQuery {
    private static final Map<String, String> ALIASES = Map.ofEntries(
        Map.entry("totem", "totem_of_undying"),
        Map.entry("totems", "totem_of_undying"),
        Map.entry("gapple", "golden_apple"),
        Map.entry("gapples", "golden_apple"),
        Map.entry("pearl", "ender_pearl"),
        Map.entry("pearls", "ender_pearl"),
        Map.entry("iron", "iron_ingot"),
        Map.entry("gold", "gold_ingot"),
        Map.entry("xp", "experience_bottle"),
        Map.entry("xp bottle", "experience_bottle"),
        Map.entry("firework", "firework_rocket"),
        Map.entry("crystal", "end_crystal"),
        Map.entry("obsidian", "obsidian"),
        Map.entry("cobble", "cobblestone"),
        Map.entry("arrow", "arrow"),
        Map.entry("sword", "sword"),
        Map.entry("pickaxe", "pickaxe"),
        Map.entry("helmet", "helmet"),
        Map.entry("chestplate", "chestplate"),
        Map.entry("leggings", "leggings"),
        Map.entry("boots", "boots")
    );

    private ItemQuery() {}

    public static String normalize(String query) {
        return query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Whether an item matches a query.
     *
     * @param itemId    the namespaced id, e.g. {@code minecraft:diamond}
     * @param itemName  the display name, e.g. {@code Diamond}
     * @param query     the raw host term
     */
    public static boolean matches(String itemId, String itemName, String query) {
        String q = normalize(query);
        if (q.isEmpty()) return false;

        String id = normalize(itemId);
        String path = id.contains(":") ? id.substring(id.indexOf(':') + 1) : id;
        String name = normalize(itemName);

        if (id.equals(q) || path.equals(q)) return true;
        if (path.contains(q) || name.contains(q)) return true;

        String alias = ALIASES.get(q);
        if (alias != null) {
            return path.equals(alias) || path.endsWith("_" + alias) || path.contains(alias);
        }
        return false;
    }
}
