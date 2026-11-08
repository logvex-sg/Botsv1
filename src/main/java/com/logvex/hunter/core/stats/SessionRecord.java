package com.logvex.hunter.core.stats;

import com.logvex.hunter.core.util.Json;
import com.logvex.hunter.core.util.Text;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One combat session: a stretch of time during which tracking or a controlled engagement was active.
 */
public final class SessionRecord {
    public final String id;
    public long startedAt;
    public long endedAt;
    public String server = "";
    public String dimension = "";
    public int kills;
    public int deaths;
    public int encounters;
    public int targetsTracked;
    public long durationMillis;

    public SessionRecord(String id, long startedAt) {
        this.id = id;
        this.startedAt = startedAt;
    }

    public void close(long timestamp) {
        endedAt = timestamp;
        durationMillis = Math.max(0, endedAt - startedAt);
    }

    public boolean isOpen() {
        return endedAt == 0;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("id", id);
        map.put("startedAt", startedAt);
        map.put("endedAt", endedAt);
        map.put("durationMillis", durationMillis);
        map.put("server", server);
        map.put("dimension", dimension);
        map.put("kills", kills);
        map.put("deaths", deaths);
        map.put("encounters", encounters);
        map.put("targetsTracked", targetsTracked);
        return map;
    }

    public static SessionRecord fromJson(Map<String, Object> map) {
        SessionRecord record = new SessionRecord(Json.getString(map, "id", "session"), Json.getLong(map, "startedAt", 0));
        record.endedAt = Json.getLong(map, "endedAt", 0);
        record.durationMillis = Json.getLong(map, "durationMillis", 0);
        record.server = Json.getString(map, "server", "");
        record.dimension = Json.getString(map, "dimension", "");
        record.kills = Json.getInt(map, "kills", 0);
        record.deaths = Json.getInt(map, "deaths", 0);
        record.encounters = Json.getInt(map, "encounters", 0);
        record.targetsTracked = Json.getInt(map, "targetsTracked", 0);
        return record;
    }

    public static String csvHeader() {
        return "id,startedAt,endedAt,durationMillis,server,dimension,kills,deaths,encounters,targetsTracked";
    }

    public String toCsv() {
        return Text.csvRow(id, startedAt, endedAt, durationMillis, server, dimension, kills, deaths, encounters, targetsTracked);
    }

    public static List<String> csvHeaderCells() {
        List<String> cells = new ArrayList<>();
        for (String cell : csvHeader().split(",")) cells.add(cell);
        return cells;
    }

    public static Map<String, String> csvHeaderMap() {
        Map<String, String> map = new LinkedHashMap<>();
        int i = 0;
        for (String cell : csvHeader().split(",")) map.put(cell, String.valueOf(i++));
        return map;
    }
}
