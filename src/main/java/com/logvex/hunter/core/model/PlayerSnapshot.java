package com.logvex.hunter.core.model;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * A Minecraft-free snapshot of a live player as seen by the client.
 *
 * <p>The tracking layer converts the game's entity objects into these snapshots so that target
 * selection, filtering and sorting can be unit-tested without a running game.
 */
public final class PlayerSnapshot {
    private final UUID uuid;
    private final String name;
    private final Vec3 position;
    private final double health;
    private final double maxHealth;
    private final int armorPoints;
    private final boolean holdingWeapon;
    private final boolean hasTotem;
    private final boolean invisible;
    private final boolean creative;
    private final boolean spectator;
    private final String dimension;
    private final long timestamp;
    private final List<String> equipment = new ArrayList<>();

    public PlayerSnapshot(UUID uuid, String name, Vec3 position, double health, double maxHealth,
                          int armorPoints, boolean holdingWeapon, boolean hasTotem, String dimension, long timestamp) {
        this(uuid, name, position, health, maxHealth, armorPoints, holdingWeapon, hasTotem,
            false, false, false, dimension, timestamp);
    }

    public PlayerSnapshot(UUID uuid, String name, Vec3 position, double health, double maxHealth,
                          int armorPoints, boolean holdingWeapon, boolean hasTotem,
                          boolean invisible, boolean creative, boolean spectator,
                          String dimension, long timestamp) {
        this.uuid = uuid;
        this.name = name;
        this.position = position == null ? Vec3.ZERO : position;
        this.health = health;
        this.maxHealth = maxHealth <= 0 ? 20.0 : maxHealth;
        this.armorPoints = armorPoints;
        this.holdingWeapon = holdingWeapon;
        this.hasTotem = hasTotem;
        this.invisible = invisible;
        this.creative = creative;
        this.spectator = spectator;
        this.dimension = dimension == null ? "" : dimension;
        this.timestamp = timestamp;
    }

    public UUID uuid() {
        return uuid;
    }

    public String name() {
        return name;
    }

    public Vec3 position() {
        return position;
    }

    public double health() {
        return health;
    }

    public double maxHealth() {
        return maxHealth;
    }

    public double healthFraction() {
        return maxHealth <= 0 ? 0 : Math.max(0, Math.min(1, health / maxHealth));
    }

    public int armorPoints() {
        return armorPoints;
    }

    public boolean isNaked() {
        return armorPoints <= 0;
    }

    public boolean holdingWeapon() {
        return holdingWeapon;
    }

    public boolean hasTotem() {
        return hasTotem;
    }

    public boolean invisible() {
        return invisible;
    }

    public boolean creative() {
        return creative;
    }

    public boolean spectator() {
        return spectator;
    }

    public String dimension() {
        return dimension;
    }

    public long timestamp() {
        return timestamp;
    }

    public List<String> equipment() {
        return equipment;
    }

    /** The identity key matching {@link TargetEntry#identityKey()} for the same player. */
    public String identityKey() {
        if (uuid != null) return "uuid:" + uuid.toString().toLowerCase(java.util.Locale.ROOT);
        if (name != null && !name.isBlank()) return "name:" + name.trim().toLowerCase(java.util.Locale.ROOT);
        return "unknown";
    }

    public TargetEntry toEntry(TargetCategory category) {
        TargetEntry entry = new TargetEntry(category, name);
        entry.setUuid(uuid);
        entry.setLastSeen(timestamp);
        entry.setLastKnownPosition(position);
        entry.setLastDimension(dimension);
        return entry;
    }
}
