package com.logvex.hunter.modules.stats;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.stats.Statistics;
import com.logvex.hunter.core.store.AtomicFiles;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.modules.HunterModule;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;

import java.io.IOException;
import java.nio.file.Path;

/** Records playtime and exposes the statistics export used by the dashboard. */
public class StatisticsModule extends HunterModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<Boolean> trackPlaytime = sgGeneral.add(new BoolSetting.Builder()
        .name("track-playtime").description("Add to the total playtime counter every minute.")
        .defaultValue(true).build());

    private final Setting<Boolean> exportOnStop = sgGeneral.add(new BoolSetting.Builder()
        .name("export-on-stop").description("Write a CSV and JSON report when the module is disabled.")
        .defaultValue(false).build());

    private final Setting<Integer> maxHistory = sgGeneral.add(new IntSetting.Builder()
        .name("history-size").description("How many sessions to keep in the history.")
        .defaultValue(50).min(5).sliderRange(5, 200).build());

    private long lastPlaytimeTick;

    public StatisticsModule() {
        super(HunterAddon.CATEGORY, "hunter-statistics", "Tracks session statistics and exports reports.");
    }

    public Statistics statistics() {
        return core().statistics();
    }

    @meteordevelopment.orbit.EventHandler
    private void onTick(meteordevelopment.meteorclient.events.world.TickEvent.Post event) {
        if (!trackPlaytime.get()) return;
        long now = runtime().now();
        if (lastPlaytimeTick == 0) {
            lastPlaytimeTick = now;
            return;
        }
        if (now - lastPlaytimeTick >= 1000) {
            core().statistics().addPlaytime(now - lastPlaytimeTick);
            lastPlaytimeTick = now;
        }
    }

    @Override
    public void onActivate() {
        core().statistics().recordModuleActivation(name);
        core().sessions().setHistoryEntries(maxHistory.get());
        lastPlaytimeTick = runtime().now();
    }

    @Override
    public void onDeactivate() {
        if (trackPlaytime.get()) flushPlaytime();
        if (exportOnStop.get()) export("stop");
    }

    @Override
    public void onEmergencyStop() {
        if (trackPlaytime.get()) flushPlaytime();
        super.onEmergencyStop();
    }

    private void flushPlaytime() {
        long now = runtime().now();
        if (lastPlaytimeTick == 0) {
            lastPlaytimeTick = now;
            return;
        }
        long delta = now - lastPlaytimeTick;
        if (delta > 0) core().statistics().addPlaytime(delta);
        lastPlaytimeTick = now;
    }

    /** Writes a JSON and a CSV export next to the other hunter files. Returns the JSON path. */
    public String export(String reason) {
        HunterCore core = core();
        Statistics stats = core.statistics();
        stats.setLastSavedAt(runtime().now());
        Path json = core.paths().root().resolve("export-" + safe(reason) + ".json");
        Path csv = core.paths().root().resolve("export-" + safe(reason) + ".csv");
        try {
            AtomicFiles.ensureDirectory(core.paths().root());
            AtomicFiles.write(json, stats.toJsonText());
            AtomicFiles.write(csv, stats.toCsv());
            core.recordEvent(com.logvex.hunter.core.stats.CombatEvent.Kind.INFO, "Exported statistics", json.toString());
            return json.toString();
        } catch (IOException e) {
            HunterChat.error("Statistics export failed: " + e.getMessage());
            return null;
        }
    }

    private static String safe(String reason) {
        String value = reason == null ? "report" : reason.toLowerCase(java.util.Locale.ROOT);
        return value.replaceAll("[^a-z0-9_-]", "-");
    }

    public long playtimeMillis() {
        return statistics().totalPlaytimeMillis();
    }
}
