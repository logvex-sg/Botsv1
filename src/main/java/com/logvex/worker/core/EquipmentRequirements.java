package com.logvex.worker.core;

import java.util.ArrayList;
import java.util.List;

/**
 * A loadout the host asks a worker to hold.
 *
 * <p>This is a description, not an instruction to move items: the worker compares it against what
 * the client actually has and reports the difference. Whether anything is then moved is a separate,
 * explicitly authorised step.
 */
public final class EquipmentRequirements {
    public String name = "default";
    public List<Requirement> items = new ArrayList<>();
    public int minArmorPieces;
    public int minFood;
    /** Durability percentage below which a worn piece is reported as needing replacement. */
    public int lowDurabilityPercent = 10;

    public EquipmentRequirements() {}

    public EquipmentRequirements(String name) {
        this.name = name;
    }

    public EquipmentRequirements add(String query, int count, String label) {
        items.add(new Requirement(query, count, label));
        return this;
    }

    public static EquipmentRequirements fromJson(com.google.gson.JsonObject root) {
        EquipmentRequirements requirements = new EquipmentRequirements(Json.string(root, "name", "default"));
        requirements.minArmorPieces = Json.integer(root, "minArmorPieces", 0);
        requirements.minFood = Json.integer(root, "minFood", 0);
        requirements.lowDurabilityPercent = Json.integer(root, "lowDurabilityPercent", 10);
        if (root.has("items") && root.get("items").isJsonArray()) {
            for (var element : root.getAsJsonArray("items")) {
                if (!element.isJsonObject()) continue;
                var item = element.getAsJsonObject();
                requirements.items.add(new Requirement(
                    Json.string(item, "query", Json.string(item, "id", "")),
                    Json.integer(item, "count", 1),
                    Json.string(item, "label", "")));
            }
        }
        return requirements;
    }
}
