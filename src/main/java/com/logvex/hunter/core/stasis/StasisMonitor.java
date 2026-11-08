package com.logvex.hunter.core.stasis;

import com.logvex.hunter.core.equipment.EquipmentAdvisor;
import com.logvex.hunter.core.equipment.EquipmentItem;
import com.logvex.hunter.core.equipment.EquipmentProfile;
import com.logvex.hunter.core.equipment.EquipmentSnapshot;
import com.logvex.hunter.core.equipment.InventoryStatus;

import java.util.ArrayList;
import java.util.List;

/**
 * Defensive stasis evaluation.
 *
 * <p>This class deliberately only *observes*: it reports a readiness level and the reasons for it.
 * It never attacks, never moves and never acts on another player. Recovery actions are left to the
 * player or to explicitly configured local reminders.
 */
public final class StasisMonitor {
    private StasisMonitor() {}

    /** The result of one evaluation. */
    public record Assessment(StasisLevel level, List<String> reasons) {
        public boolean needsAttention() {
            return level.atLeast(StasisLevel.DANGER);
        }
    }

    public static Assessment assess(EquipmentSnapshot equipment, InventoryStatus inventory,
                                    double health, boolean connected, StasisSettings settings) {
        if (settings == null) settings = StasisSettings.defaults();
        List<String> reasons = new ArrayList<>();
        StasisLevel level = StasisLevel.SAFE;

        if (!connected) {
            if (settings.treatDisconnectAsDanger) {
                reasons.add("Connection lost");
                level = StasisLevel.DANGER;
            }
            return new Assessment(level, reasons);
        }

        if (health <= settings.criticalHealth) {
            reasons.add("Health critical: " + fmt(health));
            level = StasisLevel.CRITICAL;
        } else if (health <= settings.dangerHealth) {
            reasons.add("Health low: " + fmt(health));
            level = max(level, StasisLevel.DANGER);
        } else if (health <= settings.dangerHealth + 4) {
            reasons.add("Health reduced: " + fmt(health));
            level = max(level, StasisLevel.CAUTION);
        }

        if (inventory != null && inventory.totems < settings.minTotems) {
            reasons.add("Totems: " + inventory.totems + "/" + settings.minTotems);
            level = max(level, inventory.totems == 0 ? StasisLevel.CRITICAL : StasisLevel.DANGER);
        }

        if (inventory != null && inventory.food < settings.minFood) {
            reasons.add("Food: " + inventory.food + "/" + settings.minFood);
            level = max(level, StasisLevel.CAUTION);
        }

        if (equipment != null) {
            int pieces = equipment.equippedArmorPieces();
            if (pieces < settings.minArmorPieces) {
                reasons.add("Armour: " + pieces + "/" + settings.minArmorPieces);
                level = max(level, pieces == 0 ? StasisLevel.DANGER : StasisLevel.CAUTION);
            }
            for (EquipmentItem item : equipment.all()) {
                if (!item.damageable()) continue;
                int percent = (int) Math.round(item.durabilityFraction() * 100);
                if (percent <= settings.lowDurabilityPercent) {
                    reasons.add(item.slot.displayName() + " durability: " + percent + "%");
                    level = max(level, StasisLevel.CAUTION);
                }
            }
        }

        if (settings.warnOnFullInventory && inventory != null && inventory.freeSlots == 0) {
            reasons.add("Inventory full");
            level = max(level, StasisLevel.CAUTION);
        }

        return new Assessment(level, reasons);
    }

    /**
     * Readiness summary built on top of {@link EquipmentAdvisor}: a score from 0 to 100 plus the
     * highest severity found. Used by the recovery dashboard.
     */
    public static int readinessScore(EquipmentSnapshot equipment, InventoryStatus inventory, EquipmentProfile profile) {
        if (profile == null) profile = EquipmentProfile.defaults("default");
        int score = 100;
        List<EquipmentAdvisor.Warning> warnings = EquipmentAdvisor.evaluate(equipment, inventory, profile);
        for (EquipmentAdvisor.Warning warning : warnings) {
            score -= switch (warning.severity()) {
                case CRITICAL -> 35;
                case WARNING -> 15;
                case INFO -> 5;
            };
        }
        return Math.max(0, Math.min(100, score));
    }

    private static StasisLevel max(StasisLevel a, StasisLevel b) {
        return a.ordinal() >= b.ordinal() ? a : b;
    }

    private static String fmt(double health) {
        return String.format(java.util.Locale.ROOT, "%.1f", health);
    }
}
