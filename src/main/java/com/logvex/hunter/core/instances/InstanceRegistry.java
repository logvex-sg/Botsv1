package com.logvex.hunter.core.instances;

import com.logvex.hunter.core.util.Json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The registry of known client instances. */
public final class InstanceRegistry {
    public static final int SCHEMA_VERSION = 1;

    private final Map<String, InstanceRecord> instances = new LinkedHashMap<>();

    public InstanceRecord add(InstanceRecord record) {
        if (record == null) return null;
        instances.put(record.id(), record);
        return record;
    }

    public InstanceRecord get(String id) {
        return instances.get(id);
    }

    public boolean remove(String id) {
        return instances.remove(id) != null;
    }

    public List<InstanceRecord> all() {
        return new ArrayList<>(instances.values());
    }

    public int size() {
        return instances.size();
    }

    public int onlineCount() {
        int count = 0;
        for (InstanceRecord record : instances.values()) {
            if (record.status() == InstanceStatus.ONLINE) count++;
        }
        return count;
    }

    public List<InstanceRecord> byStatus(InstanceStatus status) {
        List<InstanceRecord> result = new ArrayList<>();
        for (InstanceRecord record : instances.values()) {
            if (record.status() == status) result.add(record);
        }
        return result;
    }

    public void clear() {
        instances.clear();
    }

    public Map<String, Object> toJson() {
        Map<String, Object> root = Json.object();
        root.put("schema", SCHEMA_VERSION);
        List<Object> list = new ArrayList<>();
        for (InstanceRecord record : instances.values()) list.add(record.toJson());
        root.put("instances", list);
        return root;
    }

    @SuppressWarnings("unchecked")
    public static InstanceRegistry fromJson(Map<String, Object> root) {
        InstanceRegistry registry = new InstanceRegistry();
        for (Object raw : Json.getArray(root, "instances")) {
            if (raw instanceof Map<?, ?> map) {
                registry.add(InstanceRecord.fromJson((Map<String, Object>) map));
            }
        }
        return registry;
    }

    public String toJsonText() {
        return Json.writePretty(toJson());
    }
}
