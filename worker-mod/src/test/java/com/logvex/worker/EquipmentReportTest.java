package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.logvex.worker.core.EquipmentReport;
import com.logvex.worker.core.EquipmentRequirements;
import com.logvex.worker.core.ItemEntry;
import java.util.List;
import org.junit.jupiter.api.Test;

class EquipmentReportTest {
    private static ItemEntry item(String id, String name, int count) {
        return new ItemEntry(id, name, count, 0, 0, 0, false);
    }

    @Test
    void reportsSatisfiedLoadoutAsReady() {
        EquipmentRequirements requirements = new EquipmentRequirements("pvp")
            .add("totem", 1, "Totem")
            .add("diamond_sword", 1, "Sword");
        requirements.minArmorPieces = 2;
        requirements.minFood = 8;

        EquipmentReport report = EquipmentReport.evaluate(
            requirements,
            List.of(item("minecraft:totem_of_undying", "Totem of Undying", 2),
                    item("minecraft:diamond_sword", "Diamond Sword", 1)),
            4, 20, 2, List.of());

        assertTrue(report.ready);
        assertTrue(report.missing.isEmpty());
    }

    @Test
    void listsEachMissingLineWithCounts() {
        EquipmentRequirements requirements = new EquipmentRequirements("pvp")
            .add("totem", 3, "Totem");
        EquipmentReport report = EquipmentReport.evaluate(
            requirements,
            List.of(item("minecraft:totem_of_undying", "Totem of Undying", 1)),
            0, 0, 1, List.of());

        assertFalse(report.ready);
        assertEquals(1, report.lines.size());
        assertEquals(1, report.lines.get(0).found);
        assertEquals(3, report.lines.get(0).required);
        assertEquals(2, report.lines.get(0).missing());
        assertTrue(report.missing.get(0).contains("1/3"));
    }

    @Test
    void countsArmorAndFoodShortfalls() {
        EquipmentRequirements requirements = new EquipmentRequirements("gear");
        requirements.minArmorPieces = 4;
        requirements.minFood = 10;

        EquipmentReport report = EquipmentReport.evaluate(requirements, List.of(), 2, 4, 0, List.of());

        assertFalse(report.ready);
        assertEquals(2, report.missing.size());
        assertTrue(report.missing.stream().anyMatch(m -> m.startsWith("armor")));
        assertTrue(report.missing.stream().anyMatch(m -> m.startsWith("food")));
    }

    @Test
    void carriesDamagedGearLabelsThrough() {
        EquipmentRequirements requirements = new EquipmentRequirements("gear");
        EquipmentReport report = EquipmentReport.evaluate(
            requirements, List.of(), 0, 0, 0, List.of("Diamond Helmet (5%)"));

        assertTrue(report.ready);
        assertEquals(1, report.damaged.size());
    }
}
