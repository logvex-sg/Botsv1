package com.logvex.hunter.core.control;

import com.logvex.hunter.core.util.Json;

import java.util.List;
import java.util.Map;

/**
 * A read-only description of one module setting, suitable for rendering in the dashboard or over
 * the companion API.
 *
 * <p>The {@code type} is a coarse hint ("boolean", "integer", "double", "enum", "string") derived
 * from the Meteor setting class, and {@code suggestions} carries the allowed values for enums and
 * booleans so a remote client can offer a picker instead of free text.
 */
public record SettingView(
    String name,
    String title,
    String description,
    String type,
    String value,
    String defaultValue,
    boolean modified,
    double min,
    double max,
    List<String> suggestions
) {
    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("name", name);
        map.put("title", title);
        map.put("description", description);
        map.put("type", type);
        map.put("value", value);
        map.put("default", defaultValue);
        map.put("modified", modified);
        if (type.equals("integer") || type.equals("double")) {
            map.put("min", min);
            map.put("max", max);
        }
        if (!suggestions.isEmpty()) map.put("suggestions", suggestions);
        return map;
    }
}
