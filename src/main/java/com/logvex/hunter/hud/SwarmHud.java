package com.logvex.hunter.hud;

import com.logvex.hunter.core.swarm.SwarmPeer;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.swarm.SwarmModule;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.systems.hud.Hud;
import meteordevelopment.meteorclient.systems.hud.HudElementInfo;
import meteordevelopment.meteorclient.systems.hud.HudRenderer;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.ArrayList;
import java.util.List;

/** Shows the swarm link state: host/worker, the port and the live worker count. */
public class SwarmHud extends HunterHudElement {
    public static final HudElementInfo<SwarmHud> INFO = new HudElementInfo<>(
        Hud.GROUP, "logvex-swarm", "Logvex Swarm", "Shows the in-game swarm host/worker status.",
        SwarmHud::new);

    private final Setting<Integer> maxWorkers = sgGeneral.add(new IntSetting.Builder()
        .name("max-workers").description("How many workers to list.")
        .defaultValue(5).min(0).sliderRange(0, 20).build());

    public SwarmHud() {
        super(INFO);
    }

    @Override
    public void render(HudRenderer renderer) {
        SwarmModule module = HunterRegistry.swarm();
        List<String> lines = new ArrayList<>();
        Color titleColor;

        if (module == null) {
            lines.add("module unavailable");
            titleColor = Color.GRAY;
        } else if (module.mode() == SwarmModule.Mode.HOST) {
            boolean hosting = module.isHosting();
            lines.add(hosting ? "Host :" + module.boundPort() : "Host stopped");
            lines.add(module.roster().summary());
            int shown = 0;
            for (SwarmPeer peer : module.roster().peers()) {
                if (shown++ >= maxWorkers.get()) break;
                String suffix = peer.lastLatencyMillis() >= 0 ? " " + peer.lastLatencyMillis() + "ms" : "";
                lines.add(" " + peer.label() + " " + peer.status() + suffix);
            }
            titleColor = hosting ? Color.GREEN : Color.GRAY;
        } else {
            boolean up = module.isWorkerConnected();
            lines.add("Worker " + (up ? "connected" : "offline"));
            lines.add(module.workerEndpoint());
            titleColor = up ? Color.GREEN : Color.YELLOW;
        }

        renderBlock(renderer, "LogVex Swarm", lines, titleColor);
    }
}
