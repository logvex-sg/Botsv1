package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.logvex.worker.core.ItemEntry;
import com.logvex.worker.core.Json;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The item metadata a worker reports must survive serialisation, because the host classifies items
 * from these fields and must never assume two items are interchangeable. These tests pin the wire
 * shape: the field names, and the fact that an entry with no metadata serialises without them.
 */
class ItemMetadataTest {
    @Test
    void serialisesMetadataWithTheFieldNamesTheHostReads() {
        ItemEntry entry = new ItemEntry("minecraft:diamond_pickaxe", "Diamond Pickaxe", 1, 0, 0, 1561, true);
        entry.tags = List.of("minecraft:pickaxes", "c:tools");
        entry.enchantments = List.of(new ItemEntry.Enchant("minecraft:efficiency", 5));
        entry.components = List.of("minecraft:damage", "minecraft:enchantments");
        entry.customName = "Miner";

        JsonObject json = Json.gson().toJsonTree(entry).getAsJsonObject();

        assertEquals(2, json.getAsJsonArray("tags").size());
        assertEquals("minecraft:pickaxes", json.getAsJsonArray("tags").get(0).getAsString());
        assertEquals("minecraft:efficiency", json.getAsJsonArray("enchantments").get(0).getAsJsonObject().get("id").getAsString());
        assertEquals(5, json.getAsJsonArray("enchantments").get(0).getAsJsonObject().get("level").getAsInt());
        assertEquals("Miner", json.get("customName").getAsString());
    }

    @Test
    void anEntryWithoutMetadataSerialisesWithoutThem() {
        ItemEntry entry = new ItemEntry("minecraft:stone", "Stone", 64, 1, 0, 0, false);
        JsonObject json = Json.gson().toJsonTree(entry).getAsJsonObject();
        // Gson omits null fields by default, so the host sees no tags and treats them as not reported.
        assertTrue(!json.has("tags"));
        assertTrue(!json.has("customName"));
    }

    @Test
    void copyWithSlotKeepsMetadata() {
        ItemEntry entry = new ItemEntry("minecraft:netherite_sword", "Netherite Sword", 1, 0, 0, 2031, true);
        entry.tags = List.of("c:swords");
        entry.customName = "Blade";

        ItemEntry copy = entry.copyWithSlot(9);

        assertEquals(9, copy.slot);
        assertEquals(List.of("c:swords"), copy.tags);
        assertEquals("Blade", copy.customName);
    }

    @Test
    void enchantDefaultsToLevelOne() {
        ItemEntry.Enchant enchant = new ItemEntry.Enchant("minecraft:mending", 0);
        assertEquals(1, new ItemEntry.Enchant().level);
        assertEquals(0, enchant.level);
        assertNull(new ItemEntry().customName);
    }
}
