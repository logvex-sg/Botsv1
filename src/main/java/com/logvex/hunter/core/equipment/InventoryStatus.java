package com.logvex.hunter.core.equipment;

import java.util.ArrayList;
import java.util.List;

/** How much of a consumable or weapon the player is carrying, as reported by the game layer. */
public final class InventoryStatus {
    public final int totems;
    public final int food;
    public final int freeSlots;
    public final int usedSlots;
    /** Item ids of every weapon currently in the inventory. */
    public final List<String> weapons;

    public InventoryStatus(int totems, int food, int freeSlots, int usedSlots, List<String> weapons) {
        this.totems = Math.max(0, totems);
        this.food = Math.max(0, food);
        this.freeSlots = Math.max(0, freeSlots);
        this.usedSlots = Math.max(0, usedSlots);
        this.weapons = weapons == null ? new ArrayList<>() : new ArrayList<>(weapons);
    }

    public static InventoryStatus empty() {
        return new InventoryStatus(0, 0, 36, 0, new ArrayList<>());
    }

    public boolean hasWeapon() {
        return !weapons.isEmpty();
    }
}
