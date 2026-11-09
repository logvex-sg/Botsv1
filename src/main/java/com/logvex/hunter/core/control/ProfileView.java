package com.logvex.hunter.core.control;

import com.logvex.hunter.core.util.Json;

import java.util.Map;

/** A summary of one profile: its name, whether it is active, and a few headline values. */
public record ProfileView(
    String name,
    boolean active,
    double range,
    int scanIntervalTicks,
    String sortMode,
    boolean autoSelect,
    boolean protectFriends,
    boolean protectIgnored
) {
    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("name", name);
        map.put("active", active);
        map.put("range", range);
        map.put("scanInterval", scanIntervalTicks);
        map.put("sortMode", sortMode);
        map.put("autoSelect", autoSelect);
        map.put("protectFriends", protectFriends);
        map.put("protectIgnored", protectIgnored);
        return map;
    }
}
