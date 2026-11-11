package com.logvex.worker.meteor;

import com.google.gson.JsonObject;
import com.logvex.worker.core.Protocol;
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
import meteordevelopment.meteorclient.settings.StringSetting;
import meteordevelopment.meteorclient.utils.player.ChatUtils;

/**
 * Manual EFly control from the client.
 *
 * <p>Drives the same {@code efly} task the host sends, so an operator can start or stop elytra flight
 * on their own client — useful for setting up a route the host will then repeat. The actual flying is
 * done by Meteor's {@code ElytraFly} module and its path manager; this only asks for it.
 */
public class EflyControllerModule extends FleetModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<String> targetX = sgGeneral.add(new StringSetting.Builder()
        .name("target-x")
        .description("Target X coordinate (blank for 'just fly').")
        .defaultValue("")
        .build());

    private final Setting<String> targetY = sgGeneral.add(new StringSetting.Builder()
        .name("target-y")
        .description("Target Y coordinate.")
        .defaultValue("120")
        .build());

    private final Setting<String> targetZ = sgGeneral.add(new StringSetting.Builder()
        .name("target-z")
        .description("Target Z coordinate.")
        .defaultValue("")
        .build());

    private final Setting<String> mode = sgGeneral.add(new StringSetting.Builder()
        .name("flight-mode")
        .description("ElytraFly mode: vanilla, packet, pitch40 or bounce (blank keeps the current one).")
        .defaultValue("")
        .build());

    private final Setting<Boolean> useFireworks = sgGeneral.add(new BoolSetting.Builder()
        .name("use-fireworks")
        .description("Let ElytraFly use firework rockets.")
        .defaultValue(false)
        .build());

    private final Setting<Integer> minHeight = sgGeneral.add(new IntSetting.Builder()
        .name("min-height")
        .description("Minimum height for autopilot.")
        .defaultValue(120)
        .range(-64, 320)
        .sliderRange(-64, 320)
        .build());

    private WLabel statusLabel;

    public EflyControllerModule() {
        super("efly-controller", "Starts and stops elytra flight on this client through Meteor's ElytraFly.");
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        WVerticalList list = theme.verticalList();
        list.add(theme.label("Flying is performed by Meteor's ElytraFly module.")).expandX();
        statusLabel = list.add(theme.label("Idle.")).expandX().widget();

        WButton start = list.add(theme.button("Start EFly")).expandX().widget();
        start.action = () -> {
            TaskResult result = runtime().dispatcher().runLocal(Protocol.TASK_EFLY, startPayload());
            report(result);
        };

        WButton stop = list.add(theme.button("Stop EFly")).expandX().widget();
        stop.action = () -> {
            TaskResult result = runtime().dispatcher().runLocal(Protocol.TASK_EFLY, stopPayload());
            report(result);
        };

        return list;
    }

    @Override
    public void refresh() {
        if (statusLabel == null) return;
        var snapshot = snapshot();
        if (snapshot.eflyActive) {
            statusLabel.set(snapshot.taskProgress.isEmpty() ? "Flying." : snapshot.taskProgress);
        } else {
            statusLabel.set("Idle.");
        }
    }

    private JsonObject startPayload() {
        JsonObject payload = new JsonObject();
        payload.addProperty(Protocol.FIELD_ACTION, Protocol.EFLY_START);
        if (!targetX.get().isBlank() && !targetZ.get().isBlank()) {
            payload.addProperty(Protocol.FIELD_X, parse(targetX.get(), 0));
            payload.addProperty(Protocol.FIELD_Y, parse(targetY.get(), 120));
            payload.addProperty(Protocol.FIELD_Z, parse(targetZ.get(), 0));
        }
        if (!mode.get().isBlank()) payload.addProperty(Protocol.FIELD_MODE, mode.get());
        payload.addProperty(Protocol.FIELD_USE_FIREWORKS, useFireworks.get());
        payload.addProperty(Protocol.FIELD_MIN_HEIGHT, minHeight.get());
        return payload;
    }

    private static JsonObject stopPayload() {
        JsonObject payload = new JsonObject();
        payload.addProperty(Protocol.FIELD_ACTION, Protocol.EFLY_STOP);
        return payload;
    }

    private void report(TaskResult result) {
        String line = (result.ok ? "OK: " : "FAILED: ") + result.message;
        if (statusLabel != null) statusLabel.set(line);
        if (result.ok) ChatUtils.info("%s", line);
        else ChatUtils.error("%s", line);
    }

    private static double parse(String value, double fallback) {
        try {
            return Double.parseDouble(value.trim());
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }

    @Override
    public String getInfoString() {
        return snapshot().eflyActive ? "flying" : "idle";
    }
}
