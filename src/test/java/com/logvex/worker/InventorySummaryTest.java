package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.logvex.worker.core.InventorySummary;
import com.logvex.worker.core.ItemEntry;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class InventorySummaryTest {
    private static ItemEntry item(String id, String name, int count) {
        return new ItemEntry(id, name, count, 0, 0, 0, false);
    }

    private static List<ItemEntry> sample() {
        List<ItemEntry> items = new ArrayList<>();
        items.add(item("minecraft:diamond", "Diamond", 64));
        items.add(item("minecraft:diamond", "Diamond", 64));
        items.add(item("minecraft:iron_ingot", "Iron Ingot", 32));
        items.add(item("minecraft:totem_of_undying", "Totem of Undying", 1));
        return items;
    }

    @Test
    void totalsMergeStacksOfTheSameItem() {
        Map<String, Integer> totals = InventorySummary.totalsById(sample());
        assertEquals(128, totals.get("minecraft:diamond"));
        assertEquals(32, totals.get("minecraft:iron_ingot"));
    }

    @Test
    void countMatchingUsesAliases() {
        assertEquals(128, InventorySummary.countMatching(sample(), "diamond"));
        assertEquals(32, InventorySummary.countMatching(sample(), "iron"));
        assertEquals(1, InventorySummary.countMatching(sample(), "totem"));
        assertEquals(0, InventorySummary.countMatching(sample(), "netherite"));
    }

    @Test
    void findReturnsEveryMatchingStack() {
        assertEquals(2, InventorySummary.find(sample(), "diamond").size());
        assertTrue(InventorySummary.find(sample(), "nothing").isEmpty());
    }

    @Test
    void totalsOverAllItems() {
        assertEquals(161, InventorySummary.totalItems(sample()));
        assertEquals(3, InventorySummary.distinctItems(sample()));
    }

    @Test
    void nullAndEmptyInputAreSafe() {
        assertEquals(0, InventorySummary.totalItems(null));
        assertEquals(0, InventorySummary.countMatching(null, "diamond"));
        assertTrue(InventorySummary.totalsById(null).isEmpty());
        assertTrue(InventorySummary.find(null, "diamond").isEmpty());
    }
}
