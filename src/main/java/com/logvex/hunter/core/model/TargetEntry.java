package com.logvex.hunter.core.model;

import java.util.Locale;
import java.util.UUID;

/**
 * One entry of a target list.
 *
 * <p>An entry is identified by its UUID when one is known. Entries that only have a username (for
 * example imported from a plain list) are still useful, so {@link #identityKey()} falls back to the
 * lower-cased username. This is also how duplicate detection works: two entries with the same UUID,
 * or the same username when neither has a UUID, are duplicates.
 */
public final class TargetEntry {
    private String username;
    private UUID uuid;
    private String displayName;
    private String notes = "";
    private TargetCategory category;
    private int priority = 5;
    private long lastSeen;
    private Vec3 lastKnownPosition;
    private String lastDimension = "";
    private int encounterCount;
    private int killCount;
    private int deathCount;

    public TargetEntry() {
        this.category = TargetCategory.TEMPORARY;
    }

    public TargetEntry(TargetCategory category, String username) {
        this.category = category == null ? TargetCategory.TEMPORARY : category;
        this.username = username;
    }

    // -------------------------------------------------------------- identity

    /** Stable identity used for duplicate detection and lookups. */
    public String identityKey() {
        if (uuid != null) return "uuid:" + uuid.toString().toLowerCase(Locale.ROOT);
        if (username != null && !username.isBlank()) return "name:" + username.trim().toLowerCase(Locale.ROOT);
        if (displayName != null && !displayName.isBlank()) return "name:" + displayName.trim().toLowerCase(Locale.ROOT);
        return "unknown:" + System.identityHashCode(this);
    }

    /** Name shown in the dashboard: custom display name, else username, else short UUID. */
    public String effectiveName() {
        if (displayName != null && !displayName.isBlank()) return displayName;
        if (username != null && !username.isBlank()) return username;
        if (uuid != null) return uuid.toString().substring(0, 8);
        return "unknown";
    }

    public boolean isProtected() {
        return category != null && category.protectedCategory();
    }

    public boolean isSelectable() {
        return category != null && category.selectable();
    }

    /** Merges non-empty fields of another entry into this one (used by imports and renames). */
    public void mergeFrom(TargetEntry other) {
        if (other == null) return;
        if (other.username != null && !other.username.isBlank()) username = other.username;
        if (other.uuid != null) uuid = other.uuid;
        if (other.displayName != null && !other.displayName.isBlank()) displayName = other.displayName;
        if (other.notes != null && !other.notes.isBlank()) notes = other.notes;
        if (other.priority > 0) priority = other.priority;
        if (other.lastSeen > lastSeen) lastSeen = other.lastSeen;
        if (other.lastKnownPosition != null) lastKnownPosition = other.lastKnownPosition;
        if (other.lastDimension != null && !other.lastDimension.isBlank()) lastDimension = other.lastDimension;
        encounterCount += other.encounterCount;
        killCount += other.killCount;
        deathCount += other.deathCount;
    }

    // -------------------------------------------------------------- accessors

    public String username() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public UUID uuid() {
        return uuid;
    }

    public void setUuid(UUID uuid) {
        this.uuid = uuid;
    }

    public String displayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String notes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes == null ? "" : notes;
    }

    public TargetCategory category() {
        return category;
    }

    public void setCategory(TargetCategory category) {
        this.category = category == null ? TargetCategory.TEMPORARY : category;
    }

    public int priority() {
        return priority;
    }

    /** Priority from 1 (highest) to 10 (lowest). Values outside the range are clamped. */
    public void setPriority(int priority) {
        this.priority = Math.max(1, Math.min(10, priority));
    }

    public long lastSeen() {
        return lastSeen;
    }

    public void setLastSeen(long lastSeen) {
        this.lastSeen = lastSeen;
    }

    public void markSeen(long timestamp) {
        this.lastSeen = timestamp;
    }

    public Vec3 lastKnownPosition() {
        return lastKnownPosition;
    }

    public void setLastKnownPosition(Vec3 lastKnownPosition) {
        this.lastKnownPosition = lastKnownPosition;
    }

    public String lastDimension() {
        return lastDimension;
    }

    public void setLastDimension(String lastDimension) {
        this.lastDimension = lastDimension == null ? "" : lastDimension;
    }

    public int encounterCount() {
        return encounterCount;
    }

    public void setEncounterCount(int encounterCount) {
        this.encounterCount = Math.max(0, encounterCount);
    }

    public void addEncounter() {
        encounterCount++;
    }

    public int killCount() {
        return killCount;
    }

    public void setKillCount(int killCount) {
        this.killCount = Math.max(0, killCount);
    }

    public void addKill() {
        killCount++;
    }

    public int deathCount() {
        return deathCount;
    }

    public void setDeathCount(int deathCount) {
        this.deathCount = Math.max(0, deathCount);
    }

    public void addDeath() {
        deathCount++;
    }

    @Override
    public String toString() {
        return effectiveName() + " [" + (category == null ? "?" : category.displayName()) + "]";
    }
}
