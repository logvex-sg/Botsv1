package com.logvex.hunter.core.stasis;

/** Overall defensive readiness level reported by the stasis system. */
public enum StasisLevel {
    SAFE("Safe"),
    CAUTION("Caution"),
    DANGER("Danger"),
    CRITICAL("Critical");

    private final String displayName;

    StasisLevel(String displayName) {
        this.displayName = displayName;
    }

    public String displayName() {
        return displayName;
    }

    public boolean atLeast(StasisLevel other) {
        return ordinal() >= other.ordinal();
    }
}
