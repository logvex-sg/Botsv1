package com.logvex.worker.meteor;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.logvex.worker.core.EquipmentRequirements;
import com.logvex.worker.core.Json;
import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.Requirement;
import com.logvex.worker.core.TaskResult;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.WWidget;
import meteordevelopment.meteorclient.gui.widgets.containers.WVerticalList;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.settings.StringListSetting;
import meteordevelopment.meteorclient.utils.player.ChatUtils;

/**
 * Runs a regear on this client: report what is missing, and optionally withdraw it.
 *
 * <p>Withdrawing only ever shift-clicks out of a container the client already has open; it never
 * opens one. That matches the host's rule and keeps the worker's inventory vocabulary to the single
 * unambiguous action ("quick move"). Moves are opt-in, so pressing the button without enabling them
 * is a safe dry run.
 */
public class RegearManagerModule extends FleetModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<java.util.List<String>> items = sgGeneral.add(new StringListSetting.Builder()
        .name("loadout-items")
        .description("Items to regear, one per line ('item' or 'item count').")
        .defaultValue(java.util.List.of("totem 1", "golden_apple 16"))
        .build());

    private final Setting<Integer> minArmor = sgGeneral.add(new IntSetting.Builder()
        .name("min-armor-pieces")
        .description("Minimum armour pieces.")
        .defaultValue(4)
        .range(0, 4)
        .sliderRange(0, 4)
        .build());

    private final Setting<Integer> minFood = sgGeneral.add(new IntSetting.Builder()
        .name("min-food")
        .description("Minimum food items.")
        .defaultValue(16)
        .range(0, 256)
        .sliderRange(0, 128)
        .build());

    private final Setting<Boolean> allowMoves = sgGeneral.add(new BoolSetting.Builder()
        .name("allow-moves")
        .description("Withdraw missing items from an already-open container. Off = dry run.")
        .defaultValue(false)
        .build());

    private WLabel reportLabel;

    public RegearManagerModule() {
        super("regear-manager", "Compares and optionally restocks this client's loadout from an open container.");
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        WVerticalList list = theme.verticalList();
        reportLabel = list.add(theme.label("Press Regear.")).expandX().widget();

        WButton dryRun = list.add(theme.button("Regear (dry run)")).expandX().widget();
        dryRun.action = () -> run(false);

        WButton run = list.add(theme.button("Regear (withdraw)")).expandX().widget();
        run.action = () -> run(true);

        return list;
    }

    private void run(boolean moves) {
        JsonObject payload = requirements();
        payload.addProperty(Protocol.FIELD_ALLOW_MOVES, moves && allowMoves.get());
        TaskResult result = runtime().dispatcher().runLocal(Protocol.TASK_REGEAR, payload);
        String line = (result.ok ? "OK: " : "FAILED: ") + result.message;
        if (reportLabel != null) reportLabel.set(line);
        if (result.ok) ChatUtils.info("%s", line);
        else ChatUtils.error("%s", line);
    }

    private JsonObject requirements() {
        EquipmentRequirements req = new EquipmentRequirements("local");
        req.minArmorPieces = minArmor.get();
        req.minFood = minFood.get();
        for (String line : items.get()) {
            Requirement parsed = parseLine(line);
            if (parsed != null) req.items.add(parsed);
        }
        return Json.gson().toJsonTree(req).getAsJsonObject();
    }

    private static Requirement parseLine(String line) {
        if (line == null || line.isBlank()) return null;
        String[] parts = line.trim().split("\\s+");
        int count = 1;
        if (parts.length > 1) {
            try {
                count = Math.max(1, Integer.parseInt(parts[1]));
            } catch (NumberFormatException ex) {
                return new Requirement(parts[0], 1, parts[0]);
            }
        }
        return new Requirement(parts[0], count, parts[0]);
    }

    @Override
    public String getInfoString() {
        return items.get().size() + " items";
    }
}
