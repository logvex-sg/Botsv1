package com.logvex.hunter.core.util;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/** Duration and timestamp formatting used by the HUD, chat and statistics. */
public final class Time {
    private Time() {}

    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault());
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.systemDefault());

    public static String clock(long epochMillis) {
        return CLOCK.format(Instant.ofEpochMilli(epochMillis));
    }

    public static String stamp(long epochMillis) {
        return STAMP.format(Instant.ofEpochMilli(epochMillis));
    }

    /** Compact human duration, e.g. {@code 2h 5m 3s}. */
    public static String duration(long millis) {
        if (millis < 0) millis = 0;
        long seconds = millis / 1000;
        long days = seconds / 86400;
        long hours = (seconds % 86400) / 3600;
        long minutes = (seconds % 3600) / 60;
        long secs = seconds % 60;
        StringBuilder sb = new StringBuilder();
        if (days > 0) sb.append(days).append("d ");
        if (hours > 0) sb.append(hours).append("h ");
        if (minutes > 0) sb.append(minutes).append("m ");
        sb.append(secs).append('s');
        return sb.toString().trim();
    }

    public static String duration(Duration duration) {
        return duration(duration.toMillis());
    }

    /** Relative age, e.g. {@code 12s ago} or {@code 3h ago}. */
    public static String ago(long epochMillis, long now) {
        long delta = Math.max(0, now - epochMillis);
        if (delta < 1000) return "just now";
        return duration(delta) + " ago";
    }

    public static String ago(long epochMillis) {
        return ago(epochMillis, System.currentTimeMillis());
    }
}
