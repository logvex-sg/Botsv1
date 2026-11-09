package com.logvex.worker.core;

/**
 * One stack as reported to the host.
 *
 * <p>Deliberately flat and primitive-only so it serialises identically on both sides and can be
 * aggregated by the host without knowing anything about Minecraft.
 */
public final class ItemEntry {
    public String id = "";
    public String name = "";
    public int count;
    public int slot = -1;
    public int damage;
    public int maxDamage;
    public boolean damageable;

    public ItemEntry() {}

    public ItemEntry(String id, String name, int count, int slot, int damage, int maxDamage, boolean damageable) {
        this.id = id == null ? "" : id;
        this.name = name == null ? "" : name;
        this.count = count;
        this.slot = slot;
        this.damage = damage;
        this.maxDamage = maxDamage;
        this.damageable = damageable;
    }

    /** Remaining durability as a percentage, or 100 when the item cannot take damage. */
    public int durabilityPercent() {
        if (!damageable || maxDamage <= 0) return 100;
        int remaining = Math.max(0, maxDamage - damage);
        return (int) Math.round(remaining * 100.0 / maxDamage);
    }

    public ItemEntry copyWithSlot(int newSlot) {
        return new ItemEntry(id, name, count, newSlot, damage, maxDamage, damageable);
    }
}
