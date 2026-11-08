package com.logvex.hunter.core.message;

import com.logvex.hunter.core.util.Json;

import java.util.Map;

/** A single configurable message line, optionally disabled or rate-limited. */
public final class MessageTemplate {
    private String text;
    private boolean enabled = true;
    /** Minimum seconds between two sends of this template; 0 disables the cooldown. */
    private int cooldownSeconds = 0;

    public MessageTemplate(String text) {
        this.text = text;
    }

    public String text() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public boolean enabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int cooldownSeconds() {
        return cooldownSeconds;
    }

    public void setCooldownSeconds(int cooldownSeconds) {
        this.cooldownSeconds = Math.max(0, cooldownSeconds);
    }

    public MessageTemplate copy() {
        MessageTemplate copy = new MessageTemplate(text);
        copy.enabled = enabled;
        copy.cooldownSeconds = cooldownSeconds;
        return copy;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("text", text);
        map.put("enabled", enabled);
        if (cooldownSeconds > 0) map.put("cooldown", cooldownSeconds);
        return map;
    }

    public static MessageTemplate fromJson(Map<String, Object> map) {
        MessageTemplate template = new MessageTemplate(Json.getString(map, "text", ""));
        template.setEnabled(Json.getBoolean(map, "enabled", true));
        template.setCooldownSeconds(Json.getInt(map, "cooldown", 0));
        return template;
    }

    @Override
    public String toString() {
        return text;
    }
}
