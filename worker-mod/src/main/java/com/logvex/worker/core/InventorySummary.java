package com.logvex.worker.core;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Aggregation over a flat list of {@link ItemEntry}.
 *
 * <p>Pure so the same maths runs on the worker (for a single client) and, in tests, without a game.
 * Every method tolerates nulls and empty input.
 */
public final class InventorySummary {
    private InventorySummary() {}

    /** Total count per item id, preserving first-seen order. */
    public static Map<String, Integer> totalsById(List<ItemEntry> items) {
        Map<String, Integer> totals = new LinkedHashMap<>();
        if (items == null) return totals;
        for (ItemEntry item : items) {
            if (item == null || item.id == null || item.id.isEmpty()) continue;
            totals.merge(item.id, item.count, Integer::sum);
        }
        return totals;
    }

    /** Total count of every item matching a query. */
    public static int countMatching(List<ItemEntry> items, String query) {
        if (items == null) return 0;
        int total = 0;
        for (ItemEntry item : items) {
            if (item != null && ItemQuery.matches(item.id, item.name, query)) total += item.count;
        }
        return total;
    }

    /** Every stack matching a query, in slot order. */
    public static List<ItemEntry> find(List<ItemEntry> items, String query) {
        List<ItemEntry> found = new ArrayList<>();
        if (items == null) return found;
        for (ItemEntry item : items) {
            if (item != null && ItemQuery.matches(item.id, item.name, query)) found.add(item);
        }
        return found;
    }

    /** Sum of all stack counts. */
    public static int totalItems(List<ItemEntry> items) {
        if (items == null) return 0;
        int total = 0;
        for (ItemEntry item : items) {
            if (item != null) total += item.count;
        }
        return total;
    }

    /** Count of distinct item ids. */
    public static int distinctItems(List<ItemEntry> items) {
        return totalsById(items).size();
    }
}
