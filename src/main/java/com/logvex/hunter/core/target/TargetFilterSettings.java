package com.logvex.hunter.core.target;

/**
 * A Minecraft-free view of the tracking module's filter settings, so that target selection can be
 * unit-tested without touching Meteor's setting objects.
 */
public final class TargetFilterSettings {
    /** Maximum distance at which a player is considered. */
    public double range = 64;
    /** Never consider a player wearing no armour. */
    public boolean ignoreNaked = false;
    /** Armour points at or below which a player counts as "naked". */
    public int nakedArmorThreshold = 0;
    /** Never target friends. */
    public boolean protectFriends = true;
    /** Never target ignored players. */
    public boolean protectIgnored = true;
    /** Only consider players that already exist in one of the target lists. */
    public boolean onlyTracked = false;
    /** Only consider players that are holding a weapon. */
    public boolean requireWeapon = false;
    /** Ignore players that are invisible. */
    public boolean ignoreInvisible = true;
    /** Ignore creative-mode or spectator players (as reported by the snapshot). */
    public boolean ignoreCreative = true;

    public TargetFilterSettings() {}

    public TargetFilterSettings(double range, boolean ignoreNaked, boolean protectFriends, boolean protectIgnored) {
        this.range = range;
        this.ignoreNaked = ignoreNaked;
        this.protectFriends = protectFriends;
        this.protectIgnored = protectIgnored;
    }
}
