package com.logvex.hunter.core.control;

import com.logvex.hunter.core.util.Json;

import java.util.Map;

/** A summary of one module: identity, state and its settings. */
public record ModuleView(
    String name,
    String title,
    String description,
    String category,
    boolean enabled,
    boolean hunterModule,
    java.util.List<SettingView> settings
) {
    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("name", name);
        map.put("title", title);
        map.put("description", description);
        map.put("category", category);
        map.put("enabled", enabled);
        map.put("hunter", hunterModule);
        java.util.List<Object> list = new java.util.ArrayList<>();
        for (SettingView setting : settings) list.add(setting.toJson());
        map.put("settings", list);
        return map;
    }
}
