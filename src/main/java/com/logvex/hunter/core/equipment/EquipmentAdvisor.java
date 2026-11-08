package com.logvex.hunter.core.equipment;

import java.util.ArrayList;
import java.util.List;

/**
 * Produces the equipment warnings shown on the dashboard.
 *
 * <p>Pure logic: given the equipped items, the carried inventory and a profile, it reports what is
 * missing or running low. The game layer only has to build the snapshots.
 */
public final class EquipmentAdvisor {
    private EquipmentAdvisor() {}

    public enum Severity {
        INFO,
        WARNING,
        CRITICAL
    }

    public record Warning(Severity severity, String message) {}

    public static List<Warning> evaluate(EquipmentSnapshot equipment, InventoryStatus inventory, EquipmentProfile profile) {
        List<Warning> warnings = new ArrayList<>();
        if (equipment == null) equipment = new EquipmentSnapshot(0);
        if (inventory == null) inventory = InventoryStatus.empty();
        if (profile == null) profile = EquipmentProfile.defaults("default");

        int pieces = equipment.equippedArmorPieces();
        if (pieces < profile.minArmorPieces()) {
            Severity severity = pieces == 0 ? Severity.CRITICAL : Severity.WARNING;
            warnings.add(new Warning(severity, "Armour incomplete: " + pieces + "/" + profile.minArmorPieces() + " pieces"));
        }

        int threshold = profile.lowDurabilityPercent();
        for (EquipmentItem item : equipment.all()) {
            if (!item.damageable()) continue;
            int percent = (int) Math.round(item.durabilityFraction() * 100);
            if (percent <= threshold) {
                Severity severity = percent <= 5 ? Severity.CRITICAL : Severity.WARNING;
                warnings.add(new Warning(severity, item.slot.displayName() + " durability low: " + percent + "%"));
            }
        }

        if (inventory.totems < profile.minTotems()) {
            Severity severity = inventory.totems == 0 ? Severity.CRITICAL : Severity.WARNING;
            warnings.add(new Warning(severity, "Totems low: " + inventory.totems + "/" + profile.minTotems()));
        }

        if (inventory.food < profile.minFood()) {
            warnings.add(new Warning(Severity.WARNING, "Food low: " + inventory.food + "/" + profile.minFood()));
        }

        if (!inventory.hasWeapon() && equipment.mainHand().isEmpty()) {
            warnings.add(new Warning(Severity.CRITICAL, "No weapon available"));
        } else if (profile.chooseWeapon(inventory.weapons) == null && !inventory.weapons.isEmpty()) {
            warnings.add(new Warning(Severity.INFO, "No preferred weapon in inventory"));
        }

        if (inventory.freeSlots == 0) {
            warnings.add(new Warning(Severity.WARNING, "Inventory full"));
        }

        return warnings;
    }

    public static boolean hasCritical(List<Warning> warnings) {
        for (Warning warning : warnings) {
            if (warning.severity() == Severity.CRITICAL) return true;
        }
        return false;
    }

    /** The recommended weapon for the given inventory, or {@code null} when none matches. */
    public static String recommendWeapon(InventoryStatus inventory, EquipmentProfile profile) {
        if (inventory == null || profile == null) return null;
        return profile.chooseWeapon(inventory.weapons);
    }
}
