package com.logvex.hunter.core;

import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.model.Vec3;
import com.logvex.hunter.core.target.SortMode;
import com.logvex.hunter.core.target.TargetFilterSettings;
import com.logvex.hunter.core.target.TargetStore;
import com.logvex.hunter.core.target.TargetTracker;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TargetTrackerTest {
    private static final Vec3 SELF = new Vec3(0, 64, 0);

    private static PlayerSnapshot player(String name, double x, double z) {
        return new PlayerSnapshot(UUID.nameUUIDFromBytes(name.getBytes()), name, new Vec3(x, 64, z),
            20, 20, 20, true, false, "minecraft:overworld", 1000L);
    }

    @Test
    void firstScanReportsAppearanceAndAutoSelects() {
        TargetTracker tracker = new TargetTracker();
        TargetStore store = new TargetStore();

        TargetTracker.ScanResult result = tracker.update(SELF, List.of(player("Steve", 5, 0)), store,
            new TargetFilterSettings(), SortMode.PRIORITY, 8, true, 0, 1000);

        assertEquals(1, result.appeared().size());
        assertFalse(result.appeared().get(0).reappeared());
        assertNotNull(result.current());
        assertTrue(result.switched());
        assertEquals(1, tracker.visibleCount());
    }

    @Test
    void secondScanReportsDisappearance() {
        TargetTracker tracker = new TargetTracker();
        TargetStore store = new TargetStore();

        tracker.update(SELF, List.of(player("Steve", 5, 0)), store, new TargetFilterSettings(),
            SortMode.PRIORITY, 8, true, 0, 1000);

        TargetTracker.ScanResult result = tracker.update(SELF, List.of(), store, new TargetFilterSettings(),
            SortMode.PRIORITY, 8, true, 0, 2000);

        assertEquals(1, result.disappeared().size());
        assertEquals("Steve", result.disappeared().get(0).snapshot().name());
        assertNull(result.current());
    }

    @Test
    void reappearanceIsFlagged() {
        TargetTracker tracker = new TargetTracker();
        TargetStore store = new TargetStore();
        TargetEntry entry = new TargetEntry(TargetCategory.PRIORITY, "Steve");
        entry.setLastSeen(1500);
        store.add(entry);

        tracker.update(SELF, List.of(player("Steve", 5, 0)), store, new TargetFilterSettings(),
            SortMode.PRIORITY, 8, true, 0, 1000);
        tracker.update(SELF, List.of(), store, new TargetFilterSettings(), SortMode.PRIORITY, 8, true, 0, 2000);

        TargetTracker.ScanResult result = tracker.update(SELF, List.of(player("Steve", 5, 0)), store,
            new TargetFilterSettings(), SortMode.PRIORITY, 8, true, 0, 3000);

        assertEquals(1, result.appeared().size());
        assertTrue(result.appeared().get(0).reappeared());
        assertEquals(1500, result.appeared().get(0).awayMillis());
    }

    @Test
    void enteredRangeFiresOnce() {
        TargetTracker tracker = new TargetTracker();
        TargetStore store = new TargetStore();
        tracker.setCloseRange(10);

        TargetTracker.ScanResult far = tracker.update(SELF, List.of(player("Steve", 30, 0)), store,
            new TargetFilterSettings(), SortMode.PRIORITY, 8, true, 0, 1000);
        assertTrue(far.enteredRange().isEmpty());

        TargetTracker.ScanResult near = tracker.update(SELF, List.of(player("Steve", 5, 0)), store,
            new TargetFilterSettings(), SortMode.PRIORITY, 8, true, 0, 2000);
        assertEquals(1, near.enteredRange().size());

        TargetTracker.ScanResult stillNear = tracker.update(SELF, List.of(player("Steve", 4, 0)), store,
            new TargetFilterSettings(), SortMode.PRIORITY, 8, true, 0, 3000);
        assertTrue(stillNear.enteredRange().isEmpty());
    }

    @Test
    void switchCooldownPreventsImmediateSwitch() {
        TargetTracker tracker = new TargetTracker();
        TargetStore store = new TargetStore();

        tracker.update(SELF, List.of(player("A", 5, 0)), store, new TargetFilterSettings(),
            SortMode.PRIORITY, 8, true, 5000, 1000);

        TargetTracker.ScanResult result = tracker.update(SELF,
            List.of(player("A", 5, 0), player("B", 1, 0)), store,
            new TargetFilterSettings(), SortMode.DISTANCE, 8, true, 5000, 1500);

        assertFalse(result.switched());
        assertEquals("A", result.current().name());
    }

    @Test
    void switchHappensAfterCooldown() {
        TargetTracker tracker = new TargetTracker();
        TargetStore store = new TargetStore();

        tracker.update(SELF, List.of(player("A", 5, 0)), store, new TargetFilterSettings(),
            SortMode.PRIORITY, 8, true, 1000, 1000);

        TargetTracker.ScanResult result = tracker.update(SELF,
            List.of(player("A", 5, 0), player("B", 1, 0)), store,
            new TargetFilterSettings(), SortMode.DISTANCE, 8, true, 1000, 3000);

        assertTrue(result.switched());
        assertEquals("B", result.current().name());
    }

    @Test
    void selectByNameKeyWorks() {
        TargetTracker tracker = new TargetTracker();
        TargetStore store = new TargetStore();

        TargetTracker.ScanResult result = tracker.update(SELF,
            List.of(player("A", 5, 0), player("B", 10, 0)), store,
            new TargetFilterSettings(), SortMode.DISTANCE, 8, true, 0, 1000);

        String key = player("B", 10, 0).identityKey();
        assertNotNull(tracker.select(key, result.candidates(), 2000));
        assertEquals(key, tracker.currentKey());
    }

    @Test
    void resetClearsVisibility() {
        TargetTracker tracker = new TargetTracker();
        TargetStore store = new TargetStore();

        tracker.update(SELF, List.of(player("A", 5, 0)), store, new TargetFilterSettings(),
            SortMode.PRIORITY, 8, true, 0, 1000);
        assertEquals(1, tracker.visibleCount());

        tracker.reset();
        assertEquals(0, tracker.visibleCount());
        assertNull(tracker.currentKey());
    }
}
