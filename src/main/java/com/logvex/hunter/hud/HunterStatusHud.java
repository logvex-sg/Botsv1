package com.logvex.hunter.hud;

import com.logvex.hunter.core.HunterCore;
import meteordevelopment.meteorclient.systems.hud.Hud;
import meteordevelopment.meteorclient.systems.hud.HudElementInfo;
import meteordevelopment.meteorclient.systems.hud.HudRenderer;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Shows the hunter's overall status: running state, session, health, armour and counters. */
public class HunterStatusHud extends HunterHudElement {
    public static final HudElementInfo<HunterStatusHud> INFO = new HudElementInfo<>(
        Hud.GROUP, "logvex-status", "Logvex Status", "Shows the hunter's running state and session summary.",
        HunterStatusHud::new);

    public HunterStatusHud() {
        super(INFO);
    }

    @Override
    public void render(HudRenderer renderer) {
        HunterCore core = core();
        beginBlock();
        String state = core.config().emergencyStop() ? "EMERGENCY STOP" : (core.running() ? "running" : "stopped");
        lines.add("State: " + state);
        lines.add("Profile: " + core.config().activeProfileName());
        lines.add(core.connected() ? "Server: " + (core.serverAddress().isBlank() ? "unknown" : core.serverAddress()) : "Server: not connected");
        lines.add(String.format(Locale.ROOT, "Health: %.1f  Armor: %d", com.logvex.hunter.mc.HunterRuntime.get().localHealth(),
            com.logvex.hunter.mc.HunterRuntime.get().localArmor()));
        lines.add("Kills: " + core.statistics().totalKills() + "  Deaths: " + core.statistics().totalDeaths());
        lines.add("Targets: " + core.targets().size() + "  Visible: " + core.tracker().visibleCount());

        Color titleColor = core.config().emergencyStop() ? Color.RED : (core.running() ? Color.GREEN : Color.GRAY);
        renderBlock(renderer, "Logvex Hunter", lines, titleColor);
    }
}
