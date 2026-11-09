package com.logvex.hunter.gui.stats;

import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.stats.SessionRecord;
import com.logvex.hunter.core.stats.Statistics;
import com.logvex.hunter.core.util.Time;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.stats.StatisticsModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.orbit.EventHandler;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Statistics dashboard with totals, session history, breakdowns and JSON/CSV export. */
public class StatisticsScreen extends HunterScreen {
    private WLabel totalsLabel;
    private WTable sessionTable;
    private WTable breakdownTable;
    private WTable eventsTable;
    private int tableCooldown;

    public StatisticsScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Statistics");
    }

    @Override
    public void initWidgets() {
        add(theme.label("Totals", true)).expandX();
        totalsLabel = add(theme.label("")).expandX().widget();
        totalsLabel.color = Color.WHITE;

        var actions = add(theme.horizontalList()).expandX().widget();
        WButton exportJson = actions.add(theme.button("Export JSON")).widget();
        exportJson.action = () -> export("json");
        WButton exportCsv = actions.add(theme.button("Export CSV")).widget();
        exportCsv.action = () -> export("csv");
        WButton reset = actions.add(theme.button("Reset statistics")).widget();
        reset.action = () -> {
            core().statistics().reset();
            core().markDirty();
            rebuild();
        };

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Sessions", true)).expandX();
        sessionTable = add(theme.table()).expandX().widget();

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Breakdown", true)).expandX();
        breakdownTable = add(theme.table()).expandX().widget();

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Recent events", true)).expandX();
        eventsTable = add(theme.table()).expandX().widget();

        rebuild();
    }

    private void export(String format) {
        StatisticsModule module = HunterRegistry.statistics();
        if (module == null) {
            HunterChat.error("Statistics module is not registered.");
            return;
        }
        String path = module.export(format);
        if (path == null) HunterChat.error("Export failed.");
        else HunterChat.info("Exported statistics to " + path);
    }

    @EventHandler
    private void onTick(meteordevelopment.meteorclient.events.world.TickEvent.Post event) {
        rebuild();
    }

    private void rebuild() {
        if (totalsLabel == null) return;
        Statistics stats = core().statistics();

        totalsLabel.set(String.format(Locale.ROOT,
            "Kills: %d    Deaths: %d    K/D: %.2f    Sessions: %d    Encounters: %d    Tracked: %d    Manual switches: %d    Playtime: %s",
            stats.totalKills(), stats.totalDeaths(), stats.kdRatio(), stats.sessions(),
            stats.playerEncounters(), stats.targetsTracked(), stats.manualTargetSwitches(),
            Time.duration(stats.totalPlaytimeMillis())));

        // Three tables and two sort passes are far too much to redo every tick; refresh them twice a
        // second. The totals label above stays live.
        if (tableCooldown-- > 0) return;
        tableCooldown = 10;

        sessionTable.clear();
        List<SessionRecord> sessions = stats.sessionHistory();
        if (sessions.isEmpty()) {
            sessionTable.add(theme.label("No sessions recorded yet.")).expandCellX();
            sessionTable.row();
        } else {
            sessionTable.add(theme.label("Started")).expandCellX();
            sessionTable.add(theme.label("Duration")).expandCellX();
            sessionTable.add(theme.label("Server")).expandCellX();
            sessionTable.add(theme.label("Kills")).expandCellX();
            sessionTable.add(theme.label("Deaths")).expandCellX();
            sessionTable.add(theme.label("Encounters")).expandCellX();
            sessionTable.row();
            int shown = 0;
            for (int i = sessions.size() - 1; i >= 0 && shown < 20; i--, shown++) {
                SessionRecord record = sessions.get(i);
                long duration = record.isOpen() ? System.currentTimeMillis() - record.startedAt : record.durationMillis;
                sessionTable.add(theme.label(Time.stamp(record.startedAt))).expandCellX();
                sessionTable.add(theme.label(Time.duration(duration) + (record.isOpen() ? " (open)" : ""))).expandCellX();
                sessionTable.add(theme.label(record.server.isBlank() ? "-" : record.server)).expandCellX();
                sessionTable.add(theme.label(Integer.toString(record.kills))).expandCellX();
                sessionTable.add(theme.label(Integer.toString(record.deaths))).expandCellX();
                sessionTable.add(theme.label(Integer.toString(record.encounters))).expandCellX();
                sessionTable.row();
            }
        }

        breakdownTable.clear();
        breakdownTable.add(theme.label("Modules")).expandCellX();
        breakdownTable.add(theme.label("Activations")).expandCellX();
        breakdownTable.add(theme.label("Equipment used")).expandCellX();
        breakdownTable.add(theme.label("Uses")).expandCellX();
        breakdownTable.row();

        var modules = stats.moduleActivations().entrySet().stream().sorted(Map.Entry.<String, Integer>comparingByValue().reversed()).toList();
        var equipment = stats.equipmentUses().entrySet().stream().sorted(Map.Entry.<String, Integer>comparingByValue().reversed()).toList();
        int rows = Math.max(modules.size(), equipment.size());
        if (rows == 0) {
            breakdownTable.add(theme.label("No data yet.")).expandCellX();
            breakdownTable.row();
        }
        for (int i = 0; i < rows; i++) {
            breakdownTable.add(theme.label(i < modules.size() ? modules.get(i).getKey() : "")).expandCellX();
            breakdownTable.add(theme.label(i < modules.size() ? modules.get(i).getValue().toString() : "")).expandCellX();
            breakdownTable.add(theme.label(i < equipment.size() ? equipment.get(i).getKey() : "")).expandCellX();
            breakdownTable.add(theme.label(i < equipment.size() ? equipment.get(i).getValue().toString() : "")).expandCellX();
            breakdownTable.row();
        }

        eventsTable.clear();
        List<CombatEvent> events = stats.recentEvents(15);
        if (events.isEmpty()) {
            eventsTable.add(theme.label("No events.")).expandCellX();
            eventsTable.row();
        }
        for (CombatEvent event : events) {
            eventsTable.add(theme.label(Time.clock(event.timestamp))).expandCellX();
            eventsTable.add(theme.label(event.kind.key())).expandCellX();
            eventsTable.add(theme.label(event.message)).expandCellX();
            eventsTable.row();
        }
    }
}
