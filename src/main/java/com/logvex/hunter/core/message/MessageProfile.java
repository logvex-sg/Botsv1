package com.logvex.hunter.core.message;

import com.logvex.hunter.core.util.Json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A named group of message templates.
 *
 * <p>Profiles make it possible to keep, for example, an aggressive set of kill messages and a
 * quiet set for recording sessions, and switch between them without losing either.
 */
public final class MessageProfile {
    private String name;
    private final Map<MessageEvent, List<MessageTemplate>> templates = new LinkedHashMap<>();

    public MessageProfile(String name) {
        this.name = name;
    }

    public String name() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    /** All templates for an event, creating the list on first use. */
    public List<MessageTemplate> templates(MessageEvent event) {
        return templates.computeIfAbsent(event, k -> new ArrayList<>());
    }

    public void add(MessageEvent event, MessageTemplate template) {
        templates(event).add(template);
    }

    public void set(MessageEvent event, List<MessageTemplate> list) {
        templates.put(event, new ArrayList<>(list));
    }

    public Map<MessageEvent, List<MessageTemplate>> allTemplates() {
        return templates;
    }

    public boolean isEmpty() {
        for (List<MessageTemplate> list : templates.values()) {
            if (!list.isEmpty()) return false;
        }
        return true;
    }

    public MessageProfile copy(String newName) {
        MessageProfile copy = new MessageProfile(newName);
        for (Map.Entry<MessageEvent, List<MessageTemplate>> entry : templates.entrySet()) {
            List<MessageTemplate> list = new ArrayList<>();
            for (MessageTemplate template : entry.getValue()) list.add(template.copy());
            copy.set(entry.getKey(), list);
        }
        return copy;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> root = Json.object();
        root.put("name", name);
        Map<String, Object> events = Json.object();
        for (Map.Entry<MessageEvent, List<MessageTemplate>> entry : templates.entrySet()) {
            List<Object> list = new ArrayList<>();
            for (MessageTemplate template : entry.getValue()) list.add(template.toJson());
            events.put(entry.getKey().key(), list);
        }
        root.put("events", events);
        return root;
    }

    @SuppressWarnings("unchecked")
    public static MessageProfile fromJson(Map<String, Object> map) {
        MessageProfile profile = new MessageProfile(Json.getString(map, "name", "default"));
        Map<String, Object> events = Json.getObject(map, "events");
        for (Map.Entry<String, Object> entry : events.entrySet()) {
            MessageEvent event = MessageEvent.fromKey(entry.getKey());
            if (event == null || !(entry.getValue() instanceof List<?> list)) continue;
            List<MessageTemplate> templates = new ArrayList<>();
            for (Object raw : list) {
                if (raw instanceof Map<?, ?> m) {
                    templates.add(MessageTemplate.fromJson((Map<String, Object>) m));
                } else if (raw instanceof String s) {
                    templates.add(new MessageTemplate(s));
                }
            }
            profile.set(event, templates);
        }
        return profile;
    }
}
