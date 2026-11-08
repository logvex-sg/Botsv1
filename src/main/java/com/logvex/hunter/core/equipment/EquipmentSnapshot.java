package com.logvex.hunter.core.equipment;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A full set of equipped items, indexed by slot. */
public final class EquipmentSnapshot {
    private final Map<EquipmentSlot, EquipmentItem> items = new LinkedHashMap<>();
    public final long timestamp;

    public EquipmentSnapshot(long timestamp) {
        this.timestamp = timestamp;
        for (EquipmentSlot slot : EquipmentSlot.values()) items.put(slot, EquipmentItem.empty(slot));
    }

    public EquipmentSnapshot set(EquipmentItem item) {
        if (item != null && item.slot != null) items.put(item.slot, item);
        return this;
    }

    public EquipmentItem get(EquipmentSlot slot) {
        return items.getOrDefault(slot, EquipmentItem.empty(slot));
    }

    public int armorPoints() {
        int total = 0;
        for (EquipmentSlot slot : EquipmentSlot.values()) {
            if (slot.isArmor()) total += get(slot).protection;
        }
        return total;
    }

    public int equippedArmorPieces() {
        int count = 0;
        for (EquipmentSlot slot : EquipmentSlot.values()) {
            if (slot.isArmor() && !get(slot).isEmpty()) count++;
        }
        return count;
    }

    /** Total remaining durability of all damageable equipped items. */
    public int totalRemainingDurability() {
        int total = 0;
        for (EquipmentItem item : items.values()) {
            if (item.damageable()) total += item.remainingDurability;
        }
        return total;
    }

    /** The most damaged equipped item, or {@code null} when nothing is damageable. */
    public EquipmentItem mostDamaged() {
        EquipmentItem worst = null;
        for (EquipmentItem item : items.values()) {
            if (!item.damageable()) continue;
            if (worst == null || item.durabilityFraction() < worst.durabilityFraction()) worst = item;
        }
        return worst;
    }

    public List<EquipmentItem> all() {
        return new ArrayList<>(items.values());
    }

    public EquipmentItem mainHand() {
        return get(EquipmentSlot.MAIN_HAND);
    }

    public EquipmentItem offHand() {
        return get(EquipmentSlot.OFF_HAND);
    }

    public boolean hasTotem() {
        return get(EquipmentSlot.OFF_HAND).totem || get(EquipmentSlot.MAIN_HAND).totem;
    }

    public boolean hasFood() {
        return get(EquipmentSlot.MAIN_HAND).food || get(EquipmentSlot.OFF_HAND).food;
    }
}
