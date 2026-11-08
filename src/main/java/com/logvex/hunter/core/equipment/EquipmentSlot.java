package com.logvex.hunter.core.equipment;

import java.util.Locale;

/** The equipment slots the manager watches. */
public enum EquipmentSlot {
    HELMET("Helmet"),
    CHESTPLATE("Chestplate"),
    LEGGINGS("Leggings"),
    BOOTS("Boots"),
    MAIN_HAND("Main hand"),
    OFF_HAND("Off hand");

    private final String displayName;

    EquipmentSlot(String displayName) {
        this.displayName = displayName;
    }

    public String displayName() {
        return displayName;
    }

    public boolean isArmor() {
        return this == HELMET || this == CHESTPLATE || this == LEGGINGS || this == BOOTS;
    }

    public String key() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static EquipmentSlot fromKey(String key) {
        if (key == null) return null;
        String normalized = key.trim().toUpperCase(Locale.ROOT).replace('-', '_').replace(' ', '_');
        for (EquipmentSlot slot : values()) {
            if (slot.name().equals(normalized)) return slot;
        }
        return null;
    }
}
