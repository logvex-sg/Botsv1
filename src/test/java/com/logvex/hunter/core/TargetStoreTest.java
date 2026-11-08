package com.logvex.hunter.core;

import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.model.Vec3;
import com.logvex.hunter.core.target.TargetStore;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TargetStoreTest {
    @Test
    void addAndLookupByName() {
        TargetStore store = new TargetStore();
        store.add(new TargetEntry(TargetCategory.PRIORITY, "Steve"));

        assertNotNull(store.byName("Steve"));
        assertNotNull(store.byName("steve"));
        assertEquals(1, store.size());
    }

    @Test
    void putByUuidIsIdempotentAndKeepsProtectedCategory() {
        TargetStore store = new TargetStore();
        UUID uuid = UUID.randomUUID();

        store.putByUuid(uuid, TargetCategory.OPPONENT, "Alex");
        store.putByUuid(uuid, TargetCategory.FRIEND, "Alex");

        assertEquals(1, store.size());
        assertEquals(TargetCategory.FRIEND, store.byUuid(uuid).category());
    }

    @Test
    void removeByKey() {
        TargetStore store = new TargetStore();
        TargetEntry entry = store.add(new TargetEntry(TargetCategory.BOT, "Bot01"));

        assertTrue(store.remove(entry.identityKey()));
        assertEquals(0, store.size());
        assertFalse(store.remove("missing"));
    }

    @Test
    void protectedCategoriesAreNotSelectable() {
        TargetStore store = new TargetStore();
        store.add(new TargetEntry(TargetCategory.FRIEND, "Buddy"));
        store.add(new TargetEntry(TargetCategory.IGNORE, "Annoying"));

        assertTrue(store.isProtected(null, "Buddy"));
        assertTrue(store.isIgnored(null, "Annoying"));
        assertFalse(store.byName("Buddy").isSelectable());
        assertFalse(store.byName("Annoying").isSelectable());
        assertTrue(store.byName("Buddy").isProtected());
    }

    @Test
    void byCategoryFilters() {
        TargetStore store = new TargetStore();
        store.add(new TargetEntry(TargetCategory.PRIORITY, "A"));
        store.add(new TargetEntry(TargetCategory.PRIORITY, "B"));
        store.add(new TargetEntry(TargetCategory.BOT, "C"));

        assertEquals(2, store.byCategory(TargetCategory.PRIORITY).size());
        assertEquals(1, store.byCategory(TargetCategory.BOT).size());
        assertEquals(0, store.byCategory(TargetCategory.TEMPORARY).size());
    }

    @Test
    void searchMatchesPartialName() {
        TargetStore store = new TargetStore();
        store.add(new TargetEntry(TargetCategory.PRIORITY, "Notch"));
        store.add(new TargetEntry(TargetCategory.PRIORITY, "Jeb"));

        List<TargetEntry> result = store.search("not");
        assertEquals(1, result.size());
        assertEquals("Notch", result.get(0).effectiveName());
    }

    @Test
    void countsProtectedEntries() {
        TargetStore store = new TargetStore();
        store.add(new TargetEntry(TargetCategory.PRIORITY, "A"));
        store.add(new TargetEntry(TargetCategory.FRIEND, "B"));
        store.add(new TargetEntry(TargetCategory.IGNORE, "C"));

        assertEquals(2, store.countProtected());
    }

    @Test
    void jsonRoundTripPreservesData() {
        TargetStore store = new TargetStore();
        TargetEntry entry = new TargetEntry(TargetCategory.OPPONENT, "Rival");
        entry.setPriority(9);
        entry.setKillCount(3);
        entry.setDeathCount(1);
        entry.setEncounterCount(7);
        entry.setLastKnownPosition(new Vec3(10, 64, -20));
        entry.setLastDimension("minecraft:overworld");
        entry.setLastSeen(1_700_000_000_000L);
        store.add(entry);

        TargetStore restored = TargetStore.fromJsonText(store.toJsonText());

        assertEquals(1, restored.size());
        TargetEntry copy = restored.byName("Rival");
        assertNotNull(copy);
        assertEquals(TargetCategory.OPPONENT, copy.category());
        assertEquals(9, copy.priority());
        assertEquals(3, copy.killCount());
        assertEquals(1, copy.deathCount());
        assertEquals(7, copy.encounterCount());
        assertEquals("minecraft:overworld", copy.lastDimension());
        assertEquals(10, copy.lastKnownPosition().x, 1e-9);
    }

    @Test
    void csvRoundTripPreservesData() {
        TargetStore store = new TargetStore();
        TargetEntry entry = new TargetEntry(TargetCategory.BOT, "Bot99");
        entry.setPriority(2);
        store.add(entry);

        TargetStore restored = TargetStore.fromCsv(TargetStore.toCsv(store.all()));

        assertEquals(1, restored.size());
        TargetEntry copy = restored.byName("Bot99");
        assertNotNull(copy);
        assertEquals(TargetCategory.BOT, copy.category());
        assertEquals(2, copy.priority());
    }

    @Test
    void mergeAccumulatesCounters() {
        TargetEntry first = new TargetEntry(TargetCategory.PRIORITY, "X");
        first.setKillCount(2);
        first.setEncounterCount(5);

        TargetEntry second = new TargetEntry(TargetCategory.PRIORITY, "X");
        second.setKillCount(4);
        second.setEncounterCount(3);

        first.mergeFrom(second);
        assertEquals(6, first.killCount());
        assertEquals(8, first.encounterCount());
    }

    @Test
    void unknownUuidReturnsNull() {
        TargetStore store = new TargetStore();
        assertNull(store.byUuid(UUID.randomUUID()));
    }
}
