package com.logvex.hunter.command;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.stats.SessionRecord;
import com.logvex.hunter.core.stats.Statistics;
import com.logvex.hunter.core.util.Time;
import com.logvex.hunter.gui.stats.StatisticsScreen;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.stats.StatisticsModule;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import meteordevelopment.meteorclient.commands.Command;
import meteordevelopment.meteorclient.gui.GuiThemes;
import net.minecraft.commands.SharedSuggestionProvider;

import java.util.List;
import java.util.Map;

/** Shows and exports the hunter statistics: {@code .hstats <show|sessions|events|export|reset|gui>}. */
public class HunterStatsCommand extends Command {
    public HunterStatsCommand() {
        super("hstats", "Shows and exports Logvex Hunter statistics.", "hunterstats");
    }

    @Override
    public void build(LiteralArgumentBuilder<SharedSuggestionProvider> builder) {
        builder.executes(context -> {
            show();
            return SINGLE_SUCCESS;
        });

        builder.then(literal("show").executes(context -> {
            show();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("sessions").executes(context -> {
            List<SessionRecord> sessions = core().statistics().sessionHistory();
            if (sessions.isEmpty()) {
                info("No sessions recorded yet.");
                return SINGLE_SUCCESS;
            }
            int shown = 0;
            for (int i = sessions.size() - 1; i >= 0 && shown < 10; i--, shown++) {
                SessionRecord record = sessions.get(i);
                long duration = record.isOpen() ? System.currentTimeMillis() - record.startedAt : record.durationMillis;
                info("%s  %s  %s  %dK/%dD", Time.stamp(record.startedAt), Time.duration(duration),
                    record.server.isBlank() ? "-" : record.server, record.kills, record.deaths);
            }
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("events").executes(context -> {
            List<CombatEvent> events = core().statistics().recentEvents(15);
            if (events.isEmpty()) {
                info("No events recorded yet.");
                return SINGLE_SUCCESS;
            }
            for (CombatEvent event : events) {
                info("%s [%s] %s %s", Time.clock(event.timestamp), event.kind.key(), event.message,
                    event.detail.isBlank() ? "" : "- " + event.detail);
            }
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("export").executes(context -> {
            StatisticsModule module = HunterRegistry.statistics();
            if (module == null) {
                error("Statistics module is not registered.");
                return SINGLE_SUCCESS;
            }
            String path = module.export("command");
            if (path == null) error("Export failed.");
            else info("Exported statistics to %s", path);
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("reset").executes(context -> {
            core().statistics().reset();
            core().markDirty();
            info("Statistics reset.");
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("gui").executes(context -> {
            mc.setScreen(new StatisticsScreen(GuiThemes.get(), null));
            return SINGLE_SUCCESS;
        }));
    }

    private void show() {
        Statistics stats = core().statistics();
        info("Kills: %d  Deaths: %d  K/D: %.2f", stats.totalKills(), stats.totalDeaths(), stats.kdRatio());
        info("Sessions: %d  Encounters: %d  Tracked: %d  Manual switches: %d",
            stats.sessions(), stats.playerEncounters(), stats.targetsTracked(), stats.manualTargetSwitches());
        info("Playtime: %s  Avg session: %s", Time.duration(stats.totalPlaytimeMillis()),
            Time.duration((long) stats.averageSessionMillis()));

        Map<String, Integer> modules = stats.moduleActivations();
        if (!modules.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            modules.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .limit(5)
                .forEach(e -> sb.append(e.getKey()).append("=").append(e.getValue()).append(" "));
            info("Top modules: %s", sb.toString().trim());
        }
        Map<String, Integer> equipment = stats.equipmentUses();
        if (!equipment.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            equipment.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .limit(5)
                .forEach(e -> sb.append(e.getKey()).append("=").append(e.getValue()).append(" "));
            info("Top equipment: %s", sb.toString().trim());
        }
    }

    private HunterCore core() {
        return HunterRuntime.get().core();
    }
}
