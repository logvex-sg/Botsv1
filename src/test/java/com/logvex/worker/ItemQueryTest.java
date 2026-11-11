package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.logvex.worker.core.ItemQuery;
import org.junit.jupiter.api.Test;

class ItemQueryTest {
    @Test
    void matchesExactNamespacedId() {
        assertTrue(ItemQuery.matches("minecraft:diamond", "Diamond", "minecraft:diamond"));
    }

    @Test
    void matchesShortPathId() {
        assertTrue(ItemQuery.matches("minecraft:diamond_sword", "Diamond Sword", "diamond_sword"));
    }

    @Test
    void matchesByDisplayNameSubstring() {
        assertTrue(ItemQuery.matches("minecraft:diamond", "Diamond", "dia"));
    }

    @Test
    void matchingIsCaseInsensitive() {
        assertTrue(ItemQuery.matches("minecraft:iron_ingot", "Iron Ingot", "IRON"));
    }

    @Test
    void resolvesCommonAliases() {
        assertTrue(ItemQuery.matches("minecraft:totem_of_undying", "Totem of Undying", "totem"));
        assertTrue(ItemQuery.matches("minecraft:golden_apple", "Golden Apple", "gapple"));
        assertTrue(ItemQuery.matches("minecraft:iron_ingot", "Iron Ingot", "iron"));
        assertTrue(ItemQuery.matches("minecraft:ender_pearl", "Ender Pearl", "pearl"));
    }

    @Test
    void doesNotMatchUnrelatedItems() {
        assertFalse(ItemQuery.matches("minecraft:diamond", "Diamond", "iron"));
        assertFalse(ItemQuery.matches("minecraft:cobblestone", "Cobblestone", "totem"));
    }

    @Test
    void emptyQueryNeverMatches() {
        assertFalse(ItemQuery.matches("minecraft:diamond", "Diamond", ""));
        assertFalse(ItemQuery.matches("minecraft:diamond", "Diamond", "   "));
        assertFalse(ItemQuery.matches("minecraft:diamond", "Diamond", null));
    }
}
