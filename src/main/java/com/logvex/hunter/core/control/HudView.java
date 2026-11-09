package com.logvex.hunter.core.control;

import com.logvex.hunter.core.util.Json;

import java.util.Map;

/** A summary of one HUD element: its name, title, group and whether it is currently enabled. */
public record HudView(
    String name,
    String title,
    String group,
    boolean active,
    boolean hunterElement
) {
    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("name", name);
        map.put("title", title);
        map.put("group", group);
        map.put("active", active);
        map.put("hunter", hunterElement);
        return map;
    }
}
