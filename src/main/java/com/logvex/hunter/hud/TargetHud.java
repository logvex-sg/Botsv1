package com.logvex.hunter.hud;

import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.target.TargetCandidate;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.systems.hud.Hud;
import meteordevelopment.meteorclient.systems.hud.HudElementInfo;
import meteordevelopment.meteorclient.systems.hud.HudRenderer;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Shows the current target: name, distance, health and armour. */
public class TargetHud extends HunterHudElement {
    public static final HudElementInfo<TargetHud> INFO = new HudElementInfo<>(
        Hud.GROUP, "logvex-target", "Logvex Target", "Shows the current target's name, distance, health and armour.",
        TargetHud::new);

    private final Setting<Boolean> showHealth = sgGeneral.add(new BoolSetting.Builder()
        .name("show-health").description("Show the target's health.").defaultValue(true).build());

    private final Setting<Boolean> showArmor = sgGeneral.add(new BoolSetting.Builder()
        .name("show-armor").description("Show the target's armour points.").defaultValue(true).build());

    private final Setting<Boolean> showCoordinates = sgGeneral.add(new BoolSetting.Builder()
        .name("show-coordinates").description("Show the target's coordinates.").defaultValue(false).build());

    public TargetHud() {
        super(INFO);
    }

    @Override
    public void render(HudRenderer renderer) {
        TargetCandidate target = core().currentTarget();
        if (target == null) {
            if (isInEditor()) renderBlock(renderer, "Target", List.of("no target"), Color.GRAY);
            return;
        }

        PlayerSnapshot snapshot = target.snapshot;
        beginBlock();
        lines.add(String.format(Locale.ROOT, "Distance: %.1fm", target.distance));
        if (showHealth.get()) {
            lines.add(String.format(Locale.ROOT, "Health: %.1f / %.1f", snapshot.health(), snapshot.maxHealth()));
        }
        if (showArmor.get()) lines.add("Armor: " + snapshot.armorPoints());
        if (showCoordinates.get()) {
            lines.add(String.format(Locale.ROOT, "XYZ: %.0f %.0f %.0f", snapshot.position().x, snapshot.position().y, snapshot.position().z));
        }
        renderBlock(renderer, target.name(), lines, Color.RED);
    }
}
