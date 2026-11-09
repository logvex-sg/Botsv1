package com.logvex.hunter.core.stats;

import com.logvex.hunter.core.util.Json;
import com.logvex.hunter.core.util.Text;
import com.logvex.hunter.core.util.Time;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Running counters and history for the whole addon.
 *
 * <p>Counters are plain numbers so that the class stays Minecraft-free and testable. The history
 * lists are bounded: they exist to feed the dashboard and the exported reports, not to grow without
 * limit during a long session.
 */
public final class Statistics {
    public static final int SCHEMA_VERSION = 1;
    public static final int MAX_SESSIONS = 200;
    public static final int MAX_EVENTS = 300;

    private int totalKills;
    private int totalDeaths;
    private int sessions;
    private int playerEncounters;
    private int targetsTracked;
    private int manualTargetSwitches;
    private long totalPlaytimeMillis;
    private long firstStartedAt;
    private long lastSavedAt;

    private final Map<String, Integer> equipmentUses = new LinkedHashMap<>();
    private final Map<String, Integer> moduleActivations = new LinkedHashMap<>();
    private final Map<String, Integer> killsByTarget = new LinkedHashMap<>();
    private final List<SessionRecord> sessionHistory = new ArrayList<>();
    private final List<CombatEvent> recentEvents = new ArrayList<>();
    private long eventRevision;

    // ------------------------------------------------------------ counters

    public int totalKills() {
        return totalKills;
    }

    public int totalDeaths() {
        return totalDeaths;
    }

    public int sessions() {
        return sessions;
    }

    public int playerEncounters() {
        return playerEncounters;
    }

    public int targetsTracked() {
        return targetsTracked;
    }

    public int manualTargetSwitches() {
        return manualTargetSwitches;
    }

    public long totalPlaytimeMillis() {
        return totalPlaytimeMillis;
    }

    public long firstStartedAt() {
        return firstStartedAt;
    }

    public long lastSavedAt() {
        return lastSavedAt;
    }

    public void setLastSavedAt(long lastSavedAt) {
        this.lastSavedAt = lastSavedAt;
    }

    public void addKill() {
        totalKills++;
    }

    public void addKill(String targetName) {
        totalKills++;
        if (targetName != null && !targetName.isBlank()) {
            killsByTarget.merge(targetName.toLowerCase(java.util.Locale.ROOT), 1, Integer::sum);
        }
    }

    public void addDeath() {
        totalDeaths++;
    }

    public void addEncounter() {
        playerEncounters++;
    }

    public void addSession() {
        sessions++;
    }

    public void addTrackedTarget() {
        targetsTracked++;
    }

    public void addManualSwitch() {
        manualTargetSwitches++;
    }

    public void addPlaytime(long millis) {
        if (millis > 0) totalPlaytimeMillis += millis;
    }

    public void markFirstStart(long timestamp) {
        if (firstStartedAt == 0) firstStartedAt = timestamp;
    }

    public void recordEquipment(String item) {
        if (item == null || item.isBlank()) return;
        equipmentUses.merge(item, 1, Integer::sum);
    }

    public void recordModuleActivation(String module) {
        if (module == null || module.isBlank()) return;
        moduleActivations.merge(module, 1, Integer::sum);
    }

    public Map<String, Integer> equipmentUses() {
        return equipmentUses;
    }

    public Map<String, Integer> moduleActivations() {
        return moduleActivations;
    }

    public Map<String, Integer> killsByTarget() {
        return killsByTarget;
    }

    /** Kill/death ratio, or the kill count when there are no deaths. */
    public double kdRatio() {
        if (totalDeaths == 0) return totalKills;
        return (double) totalKills / totalDeaths;
    }

    public double averageSessionMillis() {
        if (sessions == 0) return 0;
        return (double) totalPlaytimeMillis / sessions;
    }

    public void addSession(SessionRecord record) {
        if (record == null) return;
        sessionHistory.add(record);
        sessions++;
        while (sessionHistory.size() > MAX_SESSIONS) sessionHistory.remove(0);
    }

    public List<SessionRecord> sessionHistory() {
        return sessionHistory;
    }

    public SessionRecord latestSession() {
        return sessionHistory.isEmpty() ? null : sessionHistory.get(sessionHistory.size() - 1);
    }

    public void addEvent(CombatEvent event) {
        if (event == null) return;
        recentEvents.add(event);
        eventRevision++;
        while (recentEvents.size() > MAX_EVENTS) recentEvents.remove(0);
    }

    /**
     * Bumped every time an event is recorded. A dashboard that mirrors {@link #recentEvents()} can
     * compare this against the value it last rendered and skip rebuilding its rows when nothing
     * changed, instead of re-creating widgets on every tick.
     */
    public long eventRevision() {
        return eventRevision;
    }

    public List<CombatEvent> recentEvents() {
        return recentEvents;
    }

    /** The most recent events, newest first. */
    public List<CombatEvent> recentEvents(int limit) {
        List<CombatEvent> out = new ArrayList<>();
        for (int i = recentEvents.size() - 1; i >= 0 && out.size() < limit; i--) out.add(recentEvents.get(i));
        return out;
    }

    public void reset() {
        totalKills = 0;
        totalDeaths = 0;
        sessions = 0;
        playerEncounters = 0;
        targetsTracked = 0;
        manualTargetSwitches = 0;
        totalPlaytimeMillis = 0;
        firstStartedAt = 0;
        equipmentUses.clear();
        moduleActivations.clear();
        killsByTarget.clear();
        sessionHistory.clear();
        recentEvents.clear();
    }

    // --------------------------------------------------------- persistence

    public Map<String, Object> toJson() {
        Map<String, Object> root = Json.object();
        root.put("schema", SCHEMA_VERSION);
        root.put("totalKills", totalKills);
        root.put("totalDeaths", totalDeaths);
        root.put("sessions", sessions);
        root.put("playerEncounters", playerEncounters);
        root.put("targetsTracked", targetsTracked);
        root.put("manualTargetSwitches", manualTargetSwitches);
        root.put("totalPlaytimeMillis", totalPlaytimeMillis);
        root.put("firstStartedAt", firstStartedAt);
        root.put("lastSavedAt", lastSavedAt);

        Map<String, Object> equipment = Json.object();
        equipment.putAll(equipmentUses);
        root.put("equipmentUses", equipment);

        Map<String, Object> modules = Json.object();
        modules.putAll(moduleActivations);
        root.put("moduleActivations", modules);

        Map<String, Object> kills = Json.object();
        kills.putAll(killsByTarget);
        root.put("killsByTarget", kills);

        List<Object> history = new ArrayList<>();
        for (SessionRecord record : sessionHistory) history.add(record.toJson());
        root.put("sessionHistory", history);

        List<Object> events = new ArrayList<>();
        for (CombatEvent event : recentEvents) events.add(event.toJson());
        root.put("recentEvents", events);
        return root;
    }

    public static Statistics fromJson(Map<String, Object> root) {
        Statistics stats = new Statistics();
        stats.totalKills = Json.getInt(root, "totalKills", 0);
        stats.totalDeaths = Json.getInt(root, "totalDeaths", 0);
        stats.sessions = Json.getInt(root, "sessions", 0);
        stats.playerEncounters = Json.getInt(root, "playerEncounters", 0);
        stats.targetsTracked = Json.getInt(root, "targetsTracked", 0);
        stats.manualTargetSwitches = Json.getInt(root, "manualTargetSwitches", 0);
        stats.totalPlaytimeMillis = Json.getLong(root, "totalPlaytimeMillis", 0);
        stats.firstStartedAt = Json.getLong(root, "firstStartedAt", 0);
        stats.lastSavedAt = Json.getLong(root, "lastSavedAt", 0);

        for (Map.Entry<String, Object> entry : Json.getObject(root, "equipmentUses").entrySet()) {
            if (entry.getValue() instanceof Number n) stats.equipmentUses.put(entry.getKey(), n.intValue());
        }
        for (Map.Entry<String, Object> entry : Json.getObject(root, "moduleActivations").entrySet()) {
            if (entry.getValue() instanceof Number n) stats.moduleActivations.put(entry.getKey(), n.intValue());
        }
        for (Map.Entry<String, Object> entry : Json.getObject(root, "killsByTarget").entrySet()) {
            if (entry.getValue() instanceof Number n) stats.killsByTarget.put(entry.getKey(), n.intValue());
        }
        for (Object raw : Json.getArray(root, "sessionHistory")) {
            if (raw instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> json = (Map<String, Object>) map;
                stats.sessionHistory.add(SessionRecord.fromJson(json));
            }
        }
        for (Object raw : Json.getArray(root, "recentEvents")) {
            if (raw instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> json = (Map<String, Object>) map;
                stats.recentEvents.add(CombatEvent.fromJson(json));
            }
        }
        return stats;
    }

    public String toJsonText() {
        return Json.writePretty(toJson());
    }

    public String toCsv() {
        StringBuilder sb = new StringBuilder();
        sb.append("metric,value\n");
        sb.append(Text.csvRow("totalKills", totalKills)).append('\n');
        sb.append(Text.csvRow("totalDeaths", totalDeaths)).append('\n');
        sb.append(Text.csvRow("kdRatio", String.format(java.util.Locale.ROOT, "%.2f", kdRatio()))).append('\n');
        sb.append(Text.csvRow("sessions", sessions)).append('\n');
        sb.append(Text.csvRow("playerEncounters", playerEncounters)).append('\n');
        sb.append(Text.csvRow("targetsTracked", targetsTracked)).append('\n');
        sb.append(Text.csvRow("manualTargetSwitches", manualTargetSwitches)).append('\n');
        sb.append(Text.csvRow("totalPlaytime", Time.duration(totalPlaytimeMillis))).append('\n');
        sb.append(Text.csvRow("averageSession", Time.duration((long) averageSessionMillis()))).append('\n');
        sb.append('\n');
        sb.append(SessionRecord.csvHeader()).append('\n');
        for (SessionRecord record : sessionHistory) sb.append(record.toCsv()).append('\n');
        return sb.toString();
    }

    /** Session lengths in minutes, oldest first, for the dashboard graph. */
    public List<Double> sessionDurationsMinutes(int limit) {
        List<Double> out = new ArrayList<>();
        int start = Math.max(0, sessionHistory.size() - Math.max(1, limit));
        for (int i = start; i < sessionHistory.size(); i++) {
            out.add(sessionHistory.get(i).durationMillis / 60000.0);
        }
        return out;
    }
}
