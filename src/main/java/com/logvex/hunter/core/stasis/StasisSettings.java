package com.logvex.hunter.core.stasis;

/** Thresholds and toggles for the defensive stasis system. */
public final class StasisSettings {
    /** Health at or below which the system reports danger. */
    public double dangerHealth = 8;
    /** Health at or below which the system reports a critical state. */
    public double criticalHealth = 4;
    /** Totems that must be carried to consider the player safe. */
    public int minTotems = 1;
    /** Food items that must be carried to consider the player safe. */
    public int minFood = 4;
    /** Armour pieces that must be equipped to consider the player safe. */
    public int minArmorPieces = 4;
    /** Durability percentage below which an equipped item is called out. */
    public int lowDurabilityPercent = 15;
    /** Whether losing the connection raises the level to danger. */
    public boolean treatDisconnectAsDanger = true;
    /** Whether a full inventory raises a warning. */
    public boolean warnOnFullInventory = true;

    public StasisSettings() {}

    public static StasisSettings defaults() {
        return new StasisSettings();
    }
}
