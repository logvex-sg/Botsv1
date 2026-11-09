package com.logvex.hunter.hud;

import com.logvex.hunter.core.equipment.EquipmentAdvisor;
import com.logvex.hunter.core.equipment.EquipmentSnapshot;
import com.logvex.hunter.core.equipment.InventoryStatus;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.systems.hud.Hud;
import meteordevelopment.meteorclient.systems.hud.HudElementInfo;
import meteordevelopment.meteorclient.systems.hud.HudRenderer;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.ArrayList;
import java.util.List;

/** Shows armour, totem and food status plus the top equipment warnings. */
public class EquipmentHud extends HunterHudElement {
    public static final HudElementInfo<EquipmentHud> INFO = new HudElementInfo<>(
        Hud.GROUP, "logvex-equipment", "Logvex Equipment", "Shows armour, totems, food and equipment warnings.",
        EquipmentHud::new);

    private final Setting<Boolean> showWarnings = sgGeneral.add(new BoolSetting.Builder()
        .name("show-warnings").description("Show the equipment warnings below the summary.").defaultValue(true).build());

    private final Setting<Integer> maxWarnings = sgGeneral.add(new meteordevelopment.meteorclient.settings.IntSetting.Builder()
        .name("max-warnings").description("How many warnings to show.").defaultValue(3).min(1).sliderRange(1, 8)
        .visible(showWarnings::get).build());

    public EquipmentHud() {
        super(INFO);
    }

    @Override
    public void render(HudRenderer renderer) {
        EquipmentSnapshot equipment = com.logvex.hunter.mc.HunterRuntime.get().equipment();
        InventoryStatus inventory = com.logvex.hunter.mc.HunterRuntime.get().inventory();

        beginBlock();
        lines.add("Armor: " + equipment.equippedArmorPieces() + " pieces / " + equipment.armorPoints() + " pts");
        lines.add("Totems: " + inventory.totems + "  Food: " + inventory.food);
        lines.add("Free slots: " + inventory.freeSlots);
        var worst = equipment.mostDamaged();
        if (worst != null) {
            lines.add(worst.nameOrId() + ": " + Math.round(worst.durabilityFraction() * 100) + "%");
        }

        Color titleColor = Color.WHITE;
        if (showWarnings.get()) {
            List<EquipmentAdvisor.Warning> warnings = EquipmentAdvisor.evaluate(equipment, inventory,
                core().config().activeProfile().equipmentProfile());
            int shown = 0;
            for (EquipmentAdvisor.Warning warning : warnings) {
                if (shown++ >= maxWarnings.get()) break;
                lines.add("! " + warning.message());
                if (warning.severity() == EquipmentAdvisor.Severity.CRITICAL) titleColor = Color.RED;
                else if (warning.severity() == EquipmentAdvisor.Severity.WARNING && titleColor != Color.RED) titleColor = Color.YELLOW;
            }
        }
        renderBlock(renderer, "Equipment", lines, titleColor);
    }
}
