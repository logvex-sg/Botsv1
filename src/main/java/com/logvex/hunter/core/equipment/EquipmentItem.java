package com.logvex.hunter.core.equipment;

/** An immutable snapshot of one equipped item. */
public final class EquipmentItem {
    public final EquipmentSlot slot;
    public final String itemId;
    public final String displayName;
    public final int count;
    /** Remaining durability, or {@code -1} when the item is not damageable. */
    public final int remainingDurability;
    public final int maxDurability;
    /** Protection points for armour pieces. */
    public final int protection;
    /** Whether the item is edible. */
    public final boolean food;
    /** Whether the item is a totem of undying. */
    public final boolean totem;

    public EquipmentItem(EquipmentSlot slot, String itemId, String displayName, int count,
                         int remainingDurability, int maxDurability, int protection) {
        this(slot, itemId, displayName, count, remainingDurability, maxDurability, protection, false, false);
    }

    public EquipmentItem(EquipmentSlot slot, String itemId, String displayName, int count,
                         int remainingDurability, int maxDurability, int protection,
                         boolean food, boolean totem) {
        this.slot = slot;
        this.itemId = itemId == null ? "minecraft:air" : itemId;
        this.displayName = displayName == null ? "" : displayName;
        this.count = count;
        this.remainingDurability = remainingDurability;
        this.maxDurability = maxDurability;
        this.protection = protection;
        this.food = food;
        this.totem = totem;
    }

    public static EquipmentItem empty(EquipmentSlot slot) {
        return new EquipmentItem(slot, "minecraft:air", "", 0, -1, 0, 0);
    }

    public boolean isEmpty() {
        return itemId.equals("minecraft:air") || count <= 0;
    }

    public boolean damageable() {
        return maxDurability > 0 && remainingDurability >= 0;
    }

    public double durabilityFraction() {
        if (!damageable() || maxDurability <= 0) return 1.0;
        return Math.max(0, Math.min(1, (double) remainingDurability / maxDurability));
    }

    public String nameOrId() {
        if (!displayName.isBlank()) return displayName;
        if (isEmpty()) return "empty";
        int colon = itemId.indexOf(':');
        return colon >= 0 ? itemId.substring(colon + 1) : itemId;
    }

    @Override
    public String toString() {
        return slot.displayName() + ": " + nameOrId();
    }
}
