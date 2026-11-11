package com.logvex.worker.core;

import java.util.ArrayList;
import java.util.List;

/**
 * The result of comparing a loadout with what a worker actually has.
 *
 * <p>Mirrors the shape the host expects so the host can render a missing-equipment list without any
 * extra mapping.
 */
public final class EquipmentReport {
    /** A single loadout line and whether it is satisfied. */
    public static final class Line {
        public String query = "";
        public String label = "";
        public int required;
        public int found;
        public boolean satisfied;

        public Line() {}

        public Line(String query, String label, int required, int found) {
            this.query = query;
            this.label = label;
            this.required = required;
            this.found = found;
            this.satisfied = found >= required;
        }

        public int missing() {
            return Math.max(0, required - found);
        }
    }

    public String profile = "default";
    public boolean ready;
    public int armorPieces;
    public int minArmorPieces;
    public int food;
    public int minFood;
    public int totems;
    public List<Line> lines = new ArrayList<>();
    public List<String> missing = new ArrayList<>();
    public List<String> damaged = new ArrayList<>();

    /** Compares the requirement set against an inventory. */
    public static EquipmentReport evaluate(
        EquipmentRequirements requirements,
        List<ItemEntry> inventory,
        int armorPieces,
        int food,
        int totems,
        List<String> damagedLabels
    ) {
        EquipmentReport report = new EquipmentReport();
        report.profile = requirements.name;
        report.armorPieces = armorPieces;
        report.minArmorPieces = requirements.minArmorPieces;
        report.food = food;
        report.minFood = requirements.minFood;
        report.totems = totems;

        for (Requirement requirement : requirements.items) {
            int found = InventorySummary.countMatching(inventory, requirement.query);
            Line line = new Line(requirement.query, requirement.label, requirement.count, found);
            report.lines.add(line);
            if (!line.satisfied) {
                report.missing.add(line.label + " (" + line.found + "/" + line.required + ")");
            }
        }

        if (armorPieces < requirements.minArmorPieces) {
            report.missing.add("armor pieces (" + armorPieces + "/" + requirements.minArmorPieces + ")");
        }
        if (food < requirements.minFood) {
            report.missing.add("food (" + food + "/" + requirements.minFood + ")");
        }
        if (damagedLabels != null) report.damaged.addAll(damagedLabels);

        report.ready = report.missing.isEmpty();
        return report;
    }
}
