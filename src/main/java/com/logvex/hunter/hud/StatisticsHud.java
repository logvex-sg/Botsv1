package com.logvex.hunter.hud;

import com.logvex.hunter.core.stats.SessionRecord;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.ColorSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.systems.hud.Hud;
import meteordevelopment.meteorclient.systems.hud.HudElementInfo;
import meteordevelopment.meteorclient.systems.hud.HudRenderer;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.meteorclient.utils.render.color.SettingColor;

import java.util.List;
import java.util.Locale;

/** Shows counters and a small bar graph of the most recent session durations. */
public class StatisticsHud extends HunterHudElement {
    public static final HudElementInfo<StatisticsHud> INFO = new HudElementInfo<>(
        Hud.GROUP, "logvex-stats", "Logvex Statistics", "Shows kill/death counters and a session duration graph.",
        StatisticsHud::new);

    private final Setting<Integer> graphSessions = sgGeneral.add(new IntSetting.Builder()
        .name("graph-sessions").description("How many recent sessions the graph shows.").defaultValue(12)
        .min(0).sliderRange(0, 40).build());

    private final Setting<Integer> graphHeight = sgGeneral.add(new IntSetting.Builder()
        .name("graph-height").description("Height of the graph in pixels.").defaultValue(24)
        .min(6).sliderRange(6, 80).visible(() -> graphSessions.get() > 0).build());

    private final Setting<SettingColor> barColor = sgGeneral.add(new ColorSetting.Builder()
        .name("bar-color").description("Colour of the graph bars.").defaultValue(new SettingColor(120, 90, 220))
        .visible(() -> graphSessions.get() > 0).build());

    public StatisticsHud() {
        super(INFO);
    }

    @Override
    public void render(HudRenderer renderer) {
        var stats = core().statistics();
        boolean sh = shadow.get();
        double s = getScale();
        double lineHeight = renderer.textHeight(sh, s);

        String kd = String.format(Locale.ROOT, "%.2f", stats.kdRatio());
        String[] textLines = {
            "Kills: " + stats.totalKills() + "  Deaths: " + stats.totalDeaths() + "  K/D: " + kd,
            "Sessions: " + stats.sessions() + "  Encounters: " + stats.playerEncounters(),
            "Playtime: " + com.logvex.hunter.core.util.Time.duration(stats.totalPlaytimeMillis())
        };

        double width = renderer.textWidth("Logvex Statistics", sh, s);
        for (String line : textLines) width = Math.max(width, renderer.textWidth(line, sh, s));

        int sessions = graphSessions.get();
        double graphW = 0;
        double graphH = 0;
        List<SessionRecord> history = stats.sessionHistory();
        int shown = Math.min(sessions, history.size());
        if (sessions > 0 && shown > 0) {
            graphH = graphHeight.get();
            graphW = width;
        }

        double height = lineHeight * (textLines.length + 1) + graphH + (graphH > 0 ? 2 : 0);
        setSize(width, height);

        if (background.get()) renderer.quad(x, y, width, height, backgroundColor.get());

        double drawY = y;
        renderer.text("Logvex Statistics", x, drawY, Color.WHITE, sh, s);
        drawY += lineHeight;
        for (String line : textLines) {
            renderer.text(line, x, drawY, Color.LIGHT_GRAY, sh, s);
            drawY += lineHeight;
        }

        if (graphW > 0 && shown > 0) {
            long max = 1;
            for (int i = history.size() - shown; i < history.size(); i++) {
                max = Math.max(max, history.get(i).durationMillis);
            }
            double barWidth = graphW / shown;
            for (int i = 0; i < shown; i++) {
                SessionRecord record = history.get(history.size() - shown + i);
                double barH = Math.max(1, graphH * (record.durationMillis / (double) max));
                double barX = x + i * barWidth;
                renderer.quad(barX + 1, drawY + (graphH - barH), Math.max(1, barWidth - 2), barH, barColor.get());
            }
        }
    }
}
