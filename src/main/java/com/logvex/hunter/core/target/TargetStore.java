package com.logvex.hunter.core.target;

import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.Vec3;
import com.logvex.hunter.core.util.Json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The complete set of target lists, indexed by identity for fast lookup.
 *
 * <p>The store is Minecraft-free and fully unit-testable. It enforces the invariants the Target
 * Manager relies on: no duplicates (by UUID, or by username when no UUID is known), friends and
 * ignore entries always win over other categories, and protected entries are never selectable.
 */
public final class TargetStore {
    private final Map<String, TargetEntry> entries = new LinkedHashMap<>();
    /** Identity keys of entries that are protected (ignore + friend), kept for O(1) checks. */
    private final Map<String, TargetCategory> protectedKeys = new LinkedHashMap<>();

    public static final int SCHEMA_VERSION = 1;

    public TargetStore() {}

    // ------------------------------------------------------------- mutation

    /**
     * Adds an entry, merging it into an existing one with the same identity when present.
     *
     * @return the stored entry (either the newly added one or the merged existing one)
     */
    public TargetEntry add(TargetEntry entry) {
        if (entry == null) return null;
        String key = entry.identityKey();
        TargetEntry existing = entries.get(key);
        if (existing != null) {
            // Preserve the more protective category when merging (friend/ignore wins).
            if (entry.category().protectedCategory() && !existing.category().protectedCategory()) {
                existing.setCategory(entry.category());
            }
            existing.mergeFrom(entry);
            reindex();
            return existing;
        }
        entries.put(key, entry);
        reindex();
        return entry;
    }

    /** Adds or replaces an entry identified by UUID. */
    public TargetEntry putByUuid(UUID uuid, TargetCategory category, String username) {
        if (uuid == null) return null;
        String key = "uuid:" + uuid.toString().toLowerCase(java.util.Locale.ROOT);
        TargetEntry entry = entries.get(key);
        if (entry == null) {
            entry = new TargetEntry(category, username);
            entry.setUuid(uuid);
            entries.put(key, entry);
            reindex();
        } else {
            if (username != null && !username.isBlank()) entry.setUsername(username);
            if (category != null && category.protectedCategory()) entry.setCategory(category);
        }
        return entry;
    }

    public boolean remove(String identityKey) {
        boolean removed = entries.remove(identityKey) != null;
        if (removed) reindex();
        return removed;
    }

    public void clear() {
        entries.clear();
        protectedKeys.clear();
    }

    // -------------------------------------------------------------- lookups

    public TargetEntry get(String identityKey) {
        return entries.get(identityKey);
    }

    public TargetEntry byUuid(UUID uuid) {
        if (uuid == null) return null;
        return entries.get("uuid:" + uuid.toString().toLowerCase(java.util.Locale.ROOT));
    }

    public TargetEntry byName(String name) {
        if (name == null || name.isBlank()) return null;
        return entries.get("name:" + name.trim().toLowerCase(java.util.Locale.ROOT));
    }

    /** Finds an entry by UUID first, then by username. */
    public TargetEntry find(UUID uuid, String name) {
        TargetEntry byUuid = byUuid(uuid);
        if (byUuid != null) return byUuid;
        return byName(name);
    }

    public boolean isProtected(UUID uuid, String name) {
        TargetEntry entry = find(uuid, name);
        return entry != null && entry.isProtected();
    }

    public boolean isIgnored(UUID uuid, String name) {
        TargetEntry entry = find(uuid, name);
        return entry != null && entry.category() == TargetCategory.IGNORE;
    }

    public boolean isFriend(UUID uuid, String name) {
        TargetEntry entry = find(uuid, name);
        return entry != null && entry.category() == TargetCategory.FRIEND;
    }

    /** The recorded category of an entry, or {@code null} when it is not tracked. */
    public TargetCategory categoryOf(UUID uuid, String name) {
        TargetEntry entry = find(uuid, name);
        return entry == null ? null : entry.category();
    }

    public List<TargetEntry> all() {
        return new ArrayList<>(entries.values());
    }

    public List<TargetEntry> byCategory(TargetCategory category) {
        List<TargetEntry> result = new ArrayList<>();
        for (TargetEntry entry : entries.values()) {
            if (entry.category() == category) result.add(entry);
        }
        return result;
    }

    /** Free-text search over username, display name, notes and UUID. */
    public List<TargetEntry> search(String query) {
        if (query == null || query.isBlank()) return all();
        String needle = query.trim().toLowerCase(java.util.Locale.ROOT);
        List<TargetEntry> result = new ArrayList<>();
        for (TargetEntry entry : entries.values()) {
            if (matches(entry, needle)) result.add(entry);
        }
        return result;
    }

    private boolean matches(TargetEntry entry, String needle) {
        if (entry.username() != null && entry.username().toLowerCase(java.util.Locale.ROOT).contains(needle)) return true;
        if (entry.displayName() != null && entry.displayName().toLowerCase(java.util.Locale.ROOT).contains(needle)) return true;
        if (entry.notes() != null && entry.notes().toLowerCase(java.util.Locale.ROOT).contains(needle)) return true;
        return entry.uuid() != null && entry.uuid().toString().toLowerCase(java.util.Locale.ROOT).startsWith(needle);
    }

    /** Returns an existing duplicate for the given identity, or {@code null}. */
    public TargetEntry findDuplicate(UUID uuid, String name) {
        TargetEntry byUuid = byUuid(uuid);
        if (byUuid != null) return byUuid;
        return byName(name);
    }

    public int size() {
        return entries.size();
    }

    public boolean isEmpty() {
        return entries.isEmpty();
    }

    public int countProtected() {
        return protectedKeys.size();
    }

    private void reindex() {
        protectedKeys.clear();
        for (TargetEntry entry : entries.values()) {
            if (entry.isProtected()) protectedKeys.put(entry.identityKey(), entry.category());
        }
    }

    // --------------------------------------------------------- persistence

    public Map<String, Object> toJson() {
        Map<String, Object> root = Json.object();
        root.put("schema", SCHEMA_VERSION);
        List<Object> list = new ArrayList<>();
        for (TargetEntry entry : entries.values()) list.add(entryToJson(entry));
        root.put("targets", list);
        return root;
    }

    public static TargetStore fromJson(Map<String, Object> root) {
        TargetStore store = new TargetStore();
        for (Object raw : Json.getArray(root, "targets")) {
            if (!(raw instanceof Map)) continue;
            @SuppressWarnings("unchecked")
            Map<String, Object> map = (Map<String, Object>) raw;
            store.add(entryFromJson(map));
        }
        return store;
    }

    public static Map<String, Object> entryToJson(TargetEntry entry) {
        Map<String, Object> map = Json.object();
        if (entry.uuid() != null) map.put("uuid", entry.uuid().toString());
        if (entry.username() != null) map.put("username", entry.username());
        if (entry.displayName() != null && !entry.displayName().isBlank()) map.put("displayName", entry.displayName());
        if (entry.notes() != null && !entry.notes().isBlank()) map.put("notes", entry.notes());
        map.put("category", entry.category().key());
        map.put("priority", entry.priority());
        map.put("lastSeen", entry.lastSeen());
        if (entry.lastKnownPosition() != null) {
            Map<String, Object> pos = Json.object();
            pos.put("x", entry.lastKnownPosition().x);
            pos.put("y", entry.lastKnownPosition().y);
            pos.put("z", entry.lastKnownPosition().z);
            map.put("lastPosition", pos);
        }
        if (entry.lastDimension() != null && !entry.lastDimension().isBlank()) map.put("dimension", entry.lastDimension());
        map.put("encounters", entry.encounterCount());
        map.put("kills", entry.killCount());
        map.put("deaths", entry.deathCount());
        return map;
    }

    @SuppressWarnings("unchecked")
    public static TargetEntry entryFromJson(Map<String, Object> map) {
        TargetEntry entry = new TargetEntry();
        String uuid = Json.getString(map, "uuid", null);
        if (uuid != null && !uuid.isBlank()) {
            try {
                entry.setUuid(UUID.fromString(uuid));
            } catch (IllegalArgumentException ignored) {
                // leave uuid null; the username will be used as identity
            }
        }
        entry.setUsername(Json.getString(map, "username", null));
        entry.setDisplayName(Json.getString(map, "displayName", null));
        entry.setNotes(Json.getString(map, "notes", ""));
        entry.setCategory(TargetCategory.fromKey(Json.getString(map, "category", "temporary")));
        entry.setPriority(Json.getInt(map, "priority", 5));
        entry.setLastSeen(Json.getLong(map, "lastSeen", 0));
        entry.setLastDimension(Json.getString(map, "dimension", ""));
        entry.setEncounterCount(Json.getInt(map, "encounters", 0));
        entry.setKillCount(Json.getInt(map, "kills", 0));
        entry.setDeathCount(Json.getInt(map, "deaths", 0));
        Map<String, Object> pos = Json.getObject(map, "lastPosition");
        if (!pos.isEmpty()) {
            entry.setLastKnownPosition(new Vec3(
                Json.getDouble(pos, "x", 0),
                Json.getDouble(pos, "y", 0),
                Json.getDouble(pos, "z", 0)));
        }
        return entry;
    }

    // -------------------------------------------------------- import / export

    /** Parses a JSON export produced by {@link #toJson()} or a bare array of target objects. */
    public static TargetStore fromJsonText(String text) {
        Object parsed = Json.parse(text);
        if (parsed instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> obj = (Map<String, Object>) map;
            return fromJson(obj);
        }
        if (parsed instanceof List<?> list) {
            TargetStore store = new TargetStore();
            for (Object raw : list) {
                if (raw instanceof Map<?, ?> m) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> entryMap = (Map<String, Object>) m;
                    store.add(entryFromJson(entryMap));
                }
            }
            return store;
        }
        throw new Json.JsonException("target list must be a JSON object or array");
    }

    public String toJsonText() {
        return Json.writePretty(toJson());
    }

    /** Exports the given entries as CSV. */
    public static String toCsv(List<TargetEntry> entries) {
        StringBuilder sb = new StringBuilder();
        sb.append("username,uuid,displayName,category,priority,lastSeen,lastDimension,x,y,z,encounters,kills,deaths,notes\n");
        for (TargetEntry entry : entries) {
            Vec3 pos = entry.lastKnownPosition();
            sb.append(com.logvex.hunter.core.util.Text.csvRow(
                nz(entry.username()),
                entry.uuid() == null ? "" : entry.uuid().toString(),
                nz(entry.displayName()),
                entry.category().key(),
                entry.priority(),
                entry.lastSeen(),
                nz(entry.lastDimension()),
                pos == null ? "" : pos.x,
                pos == null ? "" : pos.y,
                pos == null ? "" : pos.z,
                entry.encounterCount(),
                entry.killCount(),
                entry.deathCount(),
                nz(entry.notes())
            )).append('\n');
        }
        return sb.toString();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    /** Imports entries from CSV, skipping the header row when present. */
    public static TargetStore fromCsv(String text) {
        TargetStore store = new TargetStore();
        if (text == null) return store;
        for (String line : text.split("\r?\n")) {
            if (line.isBlank()) continue;
            List<String> cells = com.logvex.hunter.core.util.Text.parseCsvLine(line);
            if (cells.isEmpty()) continue;
            if (cells.get(0).equalsIgnoreCase("username")) continue;
            TargetEntry entry = new TargetEntry();
            entry.setUsername(cell(cells, 0));
            String uuid = cell(cells, 1);
            if (uuid != null && !uuid.isBlank()) {
                try {
                    entry.setUuid(UUID.fromString(uuid.trim()));
                } catch (IllegalArgumentException ignored) {
                    // ignore malformed uuid
                }
            }
            entry.setDisplayName(cell(cells, 2));
            entry.setCategory(TargetCategory.fromKey(cell(cells, 3)));
            entry.setPriority(parseInt(cell(cells, 4), 5));
            entry.setLastSeen(parseLong(cell(cells, 5), 0));
            entry.setLastDimension(cell(cells, 6));
            String x = cell(cells, 7);
            String y = cell(cells, 8);
            String z = cell(cells, 9);
            if (x != null && y != null && z != null && !x.isBlank() && !y.isBlank() && !z.isBlank()) {
                entry.setLastKnownPosition(new Vec3(parseDouble(x), parseDouble(y), parseDouble(z)));
            }
            entry.setEncounterCount(parseInt(cell(cells, 10), 0));
            entry.setKillCount(parseInt(cell(cells, 11), 0));
            entry.setDeathCount(parseInt(cell(cells, 12), 0));
            entry.setNotes(cell(cells, 13));
            if (entry.username() != null || entry.uuid() != null) store.add(entry);
        }
        return store;
    }

    private static String cell(List<String> cells, int index) {
        if (index >= cells.size()) return null;
        String value = cells.get(index);
        return value == null || value.isEmpty() ? null : value;
    }

    private static int parseInt(String value, int fallback) {
        try {
            return value == null || value.isBlank() ? fallback : Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static long parseLong(String value, long fallback) {
        try {
            return value == null || value.isBlank() ? fallback : Long.parseLong(value.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static double parseDouble(String value) {
        try {
            return value == null || value.isBlank() ? 0 : Double.parseDouble(value.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
