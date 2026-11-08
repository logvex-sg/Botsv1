package com.logvex.hunter.core;

import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.model.Vec3;
import com.logvex.hunter.core.target.SortMode;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.core.target.TargetFilterSettings;
import com.logvex.hunter.core.target.TargetSelector;
import com.logvex.hunter.core.target.TargetStore;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TargetSelectorTest {
    private static final Vec3 SELF = new Vec3(0, 64, 0);

    private static PlayerSnapshot player(String name, double x, double z, double health, int armor,
                                         boolean weapon, boolean invisible, boolean creative) {
        return new PlayerSnapshot(UUID.nameUUIDFromBytes(name.getBytes()), name, new Vec3(x, 64, z),
            health, 20, armor, weapon, false, invisible, creative, false, "minecraft:overworld", 1000L);
    }

    @Test
    void friendsAreExcludedWhenProtected() {
        TargetStore store = new TargetStore();
        store.add(new TargetEntry(TargetCategory.FRIEND, "Buddy"));
        TargetFilterSettings filters = new TargetFilterSettings();

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Buddy", 5, 0, 20, 20, true, false, false)), store, filters, SortMode.PRIORITY, 8);

        assertTrue(result.isEmpty());
    }

    @Test
    void ignoredPlayersAreExcludedWhenProtected() {
        TargetStore store = new TargetStore();
        store.add(new TargetEntry(TargetCategory.IGNORE, "Annoying"));
        TargetFilterSettings filters = new TargetFilterSettings();

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Annoying", 5, 0, 20, 20, true, false, false)), store, filters, SortMode.PRIORITY, 8);

        assertTrue(result.isEmpty());
    }

    @Test
    void rangeFilterDropsDistantPlayers() {
        TargetStore store = new TargetStore();
        TargetFilterSettings filters = new TargetFilterSettings();
        filters.range = 10;

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Far", 100, 0, 20, 20, true, false, false)), store, filters, SortMode.PRIORITY, 8);

        assertTrue(result.isEmpty());
    }

    @Test
    void prioritySortPrefersHigherPriorityList() {
        TargetStore store = new TargetStore();
        TargetEntry priority = new TargetEntry(TargetCategory.PRIORITY, "Important");
        priority.setPriority(1);
        store.add(priority);
        TargetEntry bot = new TargetEntry(TargetCategory.BOT, "Bot");
        bot.setPriority(50);
        store.add(bot);

        TargetFilterSettings filters = new TargetFilterSettings();
        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Bot", 2, 0, 20, 20, true, false, false),
                player("Important", 30, 0, 20, 20, true, false, false)),
            store, filters, SortMode.PRIORITY, 8);

        assertEquals(2, result.size());
        assertEquals("Important", result.get(0).name());
    }

    @Test
    void distanceSortPrefersCloserPlayer() {
        TargetStore store = new TargetStore();
        TargetFilterSettings filters = new TargetFilterSettings();

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Near", 3, 0, 20, 20, true, false, false),
                player("Far", 30, 0, 20, 20, true, false, false)),
            store, filters, SortMode.DISTANCE, 8);

        assertEquals("Near", result.get(0).name());
    }

    @Test
    void ignoreNakedUsesArmorThreshold() {
        TargetStore store = new TargetStore();
        TargetFilterSettings filters = new TargetFilterSettings();
        filters.ignoreNaked = true;
        filters.nakedArmorThreshold = 0;

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Naked", 5, 0, 20, 0, true, false, false),
                player("Armored", 6, 0, 20, 20, true, false, false)),
            store, filters, SortMode.PRIORITY, 8);

        assertEquals(1, result.size());
        assertEquals("Armored", result.get(0).name());
    }

    @Test
    void requireWeaponExcludesUnarmed() {
        TargetStore store = new TargetStore();
        TargetFilterSettings filters = new TargetFilterSettings();
        filters.requireWeapon = true;

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Unarmed", 5, 0, 20, 20, false, false, false),
                player("Armed", 6, 0, 20, 20, true, false, false)),
            store, filters, SortMode.PRIORITY, 8);

        assertEquals(1, result.size());
        assertEquals("Armed", result.get(0).name());
    }

    @Test
    void creativePlayersAreExcludedByDefault() {
        TargetStore store = new TargetStore();
        TargetFilterSettings filters = new TargetFilterSettings();

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Creative", 5, 0, 20, 20, true, false, true)),
            store, filters, SortMode.PRIORITY, 8);

        assertTrue(result.isEmpty());
    }

    @Test
    void onlyTrackedSkipsUnknownPlayers() {
        TargetStore store = new TargetStore();
        store.add(new TargetEntry(TargetCategory.PRIORITY, "Known"));
        TargetFilterSettings filters = new TargetFilterSettings();
        filters.onlyTracked = true;

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("Known", 5, 0, 20, 20, true, false, false),
                player("Stranger", 6, 0, 20, 20, true, false, false)),
            store, filters, SortMode.PRIORITY, 8);

        assertEquals(1, result.size());
        assertEquals("Known", result.get(0).name());
    }

    @Test
    void maxCandidatesLimitsResult() {
        TargetStore store = new TargetStore();
        TargetFilterSettings filters = new TargetFilterSettings();

        List<TargetCandidate> result = TargetSelector.select(SELF,
            List.of(player("A", 1, 0, 20, 20, true, false, false),
                player("B", 2, 0, 20, 20, true, false, false),
                player("C", 3, 0, 20, 20, true, false, false)),
            store, filters, SortMode.DISTANCE, 2);

        assertEquals(2, result.size());
    }

    @Test
    void passesRejectsNullPlayer() {
        assertFalse(TargetSelector.passes(null, null, new TargetFilterSettings()));
    }
}
