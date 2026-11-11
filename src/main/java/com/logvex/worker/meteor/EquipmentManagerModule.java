package com.logvex.worker.meteor;

import com.logvex.worker.core.EquipmentReport;
import com.logvex.worker.core.EquipmentRequirements;
import com.logvex.worker.core.Json;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.WWidget;
import meteordevelopment.meteorclient.gui.widgets.containers.WVerticalList;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.settings.StringSetting;

/**
 * Reports this client's equipment against a loadout.
 *
 * <p>The loadout here is the client's own default (a totem, a minimum armour count and some food).
 * The authoritative loadout comparison for the fleet lives on the host, which sends the requirements
 * with the {@code equipment} task; this module exists so an operator standing at the machine can see
 * the same answer without the host.
 */
public class EquipmentManagerModule extends FleetModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<Integer> minArmor = sgGeneral.add(new IntSetting.Builder()
        .name("min-armor-pieces")
        .description("Minimum number of armour pieces considered ready.")
        .defaultValue(4)
        .range(0, 4)
        .sliderRange(0, 4)
        .build());

    private final Setting<Integer> minFood = sgGeneral.add(new IntSetting.Builder()
        .name("min-food")
        .description("Minimum number of food items considered ready.")
        .defaultValue(16)
        .range(0, 256)
        .sliderRange(0, 128)
        .build());

    private final Setting<Integer> minTotems = sgGeneral.add(new IntSetting.Builder()
        .name("min-totems")
        .description("Minimum number of totems considered ready.")
        .defaultValue(1)
        .range(0, 64)
        .sliderRange(0, 16)
        .build());

    private final Setting<String> required = sgGeneral.add(new StringSetting.Builder()
        .name("required-item")
        .description("An extra item the loadout must contain (blank for none).")
        .defaultValue("")
        .build());

    private WLabel reportLabel;

    public EquipmentManagerModule() {
        super("equipment-manager", "Checks this client's armour, food, totems and durability against a loadout.");
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        WVerticalList list = theme.verticalList();
        reportLabel = list.add(theme.label("Press Evaluate.")).expandX().widget();
        WButton evaluate = list.add(theme.button("Evaluate loadout")).expandX().widget();
        evaluate.action = this::update;
        return list;
    }

    @Override
    public void refresh() {
        update();
    }

    private void update() {
        EquipmentRequirements requirements = requirements();
        EquipmentReport report = runtime().dispatcher().evaluate(requirements);
        if (reportLabel == null) return;
        StringBuilder text = new StringBuilder();
        text.append(report.ready ? "READY" : "NOT READY");
        text.append(" — armor ").append(report.armorPieces).append('/').append(report.minArmorPieces);
        text.append(", food ").append(report.food).append('/').append(report.minFood);
        text.append(", totems ").append(report.totems);
        if (!report.missing.isEmpty()) text.append(" — missing: ").append(String.join(", ", report.missing));
        if (!report.damaged.isEmpty()) text.append(" — damaged: ").append(String.join(", ", report.damaged));
        reportLabel.set(text.toString());
    }

    private EquipmentRequirements requirements() {
        EquipmentRequirements requirements = new EquipmentRequirements("local");
        requirements.minArmorPieces = minArmor.get();
        requirements.minFood = minFood.get();
        if (minTotems.get() > 0) requirements.add("totem", minTotems.get(), "Totems");
        if (!required.get().isBlank()) requirements.add(required.get(), 1, required.get());
        return requirements;
    }

    @Override
    public String getInfoString() {
        return minArmor.get() + " armor";
    }
}
