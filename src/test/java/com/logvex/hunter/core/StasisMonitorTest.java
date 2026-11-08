package com.logvex.hunter.core;

import com.logvex.hunter.core.equipment.EquipmentItem;
import com.logvex.hunter.core.equipment.EquipmentProfile;
import com.logvex.hunter.core.equipment.EquipmentSlot;
import com.logvex.hunter.core.equipment.EquipmentSnapshot;
import com.logvex.hunter.core.equipment.InventoryStatus;
import com.logvex.hunter.core.stasis.StasisLevel;
import com.logvex.hunter.core.stasis.StasisMonitor;
import com.logvex.hunter.core.stasis.StasisSettings;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StasisMonitorTest {
    private static EquipmentSnapshot fullArmor() {
        EquipmentSnapshot snapshot = new EquipmentSnapshot(1000);
        snapshot.set(new EquipmentItem(EquipmentSlot.HELMET, "diamond_helmet", "Diamond Helmet", 1, 300, 363, 3, false, false));
        snapshot.set(new EquipmentItem(EquipmentSlot.CHESTPLATE, "diamond_chestplate", "Diamond Chestplate", 1, 500, 528, 8, false, false));
        snapshot.set(new EquipmentItem(EquipmentSlot.LEGGINGS, "diamond_leggings", "Diamond Leggings", 1, 450, 495, 6, false, false));
        snapshot.set(new EquipmentItem(EquipmentSlot.BOOTS, "diamond_boots", "Diamond Boots", 1, 400, 429, 3, false, false));
        return snapshot;
    }

    private static InventoryStatus healthyInventory() {
        return new InventoryStatus(8, 32, 5, 20, List.of("minecraft:netherite_sword"));
    }

    @Test
    void healthyPlayerIsSafe() {
        StasisMonitor.Assessment assessment = StasisMonitor.assess(fullArmor(), healthyInventory(),
            20, true, StasisSettings.defaults());

        assertEquals(StasisLevel.SAFE, assessment.level());
        assertFalse(assessment.needsAttention());
    }

    @Test
    void lowHealthIsDanger() {
        StasisSettings settings = StasisSettings.defaults();
        StasisMonitor.Assessment assessment = StasisMonitor.assess(fullArmor(), healthyInventory(),
            7, true, settings);

        assertEquals(StasisLevel.DANGER, assessment.level());
        assertTrue(assessment.needsAttention());
    }

    @Test
    void veryLowHealthIsCritical() {
        StasisMonitor.Assessment assessment = StasisMonitor.assess(fullArmor(), healthyInventory(),
            2, true, StasisSettings.defaults());

        assertEquals(StasisLevel.CRITICAL, assessment.level());
    }

    @Test
    void noTotemsIsCritical() {
        InventoryStatus inventory = new InventoryStatus(0, 32, 5, 20, List.of("minecraft:netherite_sword"));
        StasisMonitor.Assessment assessment = StasisMonitor.assess(fullArmor(), inventory,
            20, true, StasisSettings.defaults());

        assertEquals(StasisLevel.CRITICAL, assessment.level());
        assertTrue(assessment.reasons().stream().anyMatch(r -> r.toLowerCase().contains("totem")));
    }

    @Test
    void missingArmorIsDanger() {
        StasisMonitor.Assessment assessment = StasisMonitor.assess(new EquipmentSnapshot(0), healthyInventory(),
            20, true, StasisSettings.defaults());

        assertTrue(assessment.level().atLeast(StasisLevel.DANGER));
    }

    @Test
    void disconnectIsDangerWhenConfigured() {
        StasisSettings settings = StasisSettings.defaults();
        settings.treatDisconnectAsDanger = true;

        StasisMonitor.Assessment assessment = StasisMonitor.assess(fullArmor(), healthyInventory(),
            20, false, settings);

        assertEquals(StasisLevel.DANGER, assessment.level());
    }

    @Test
    void disconnectIgnoredWhenNotConfigured() {
        StasisSettings settings = StasisSettings.defaults();
        settings.treatDisconnectAsDanger = false;

        StasisMonitor.Assessment assessment = StasisMonitor.assess(fullArmor(), healthyInventory(),
            20, false, settings);

        assertEquals(StasisLevel.SAFE, assessment.level());
    }

    @Test
    void lowDurabilityLowersLevel() {
        EquipmentSnapshot snapshot = fullArmor();
        snapshot.set(new EquipmentItem(EquipmentSlot.HELMET, "diamond_helmet", "Diamond Helmet", 1, 5, 363, 3, false, false));

        StasisMonitor.Assessment assessment = StasisMonitor.assess(snapshot, healthyInventory(),
            20, true, StasisSettings.defaults());

        assertTrue(assessment.level().atLeast(StasisLevel.CAUTION));
    }

    @Test
    void readinessScoreIsFullWhenHealthy() {
        int score = StasisMonitor.readinessScore(fullArmor(), healthyInventory(),
            EquipmentProfile.defaults("default"));

        assertEquals(100, score);
    }

    @Test
    void readinessScoreDropsWhenMissingGear() {
        int score = StasisMonitor.readinessScore(new EquipmentSnapshot(0), InventoryStatus.empty(),
            EquipmentProfile.defaults("default"));

        assertTrue(score < 100);
    }

    @Test
    void levelOrdering() {
        assertTrue(StasisLevel.CRITICAL.atLeast(StasisLevel.DANGER));
        assertTrue(StasisLevel.DANGER.atLeast(StasisLevel.CAUTION));
        assertFalse(StasisLevel.SAFE.atLeast(StasisLevel.CAUTION));
    }
}
