package com.logvex.hunter.core.message;

import java.util.Locale;

/** The situations that can trigger a configurable message. */
public enum MessageEvent {
    TARGET_DETECTED("target-detected", "Target detected", true),
    TARGET_DISAPPEARED("target-disappeared", "Target disappeared", true),
    TARGET_REAPPEARED("target-reappeared", "Target reappeared", true),
    TARGET_ENTERED_RANGE("target-entered-range", "Target entered range", true),
    TARGET_ELIMINATED("target-eliminated", "Target eliminated", false),
    TARGET_LOST_HEALTH("target-low-health", "Target low health", true),
    STASIS_DANGER("stasis-danger", "Stasis danger", true),
    STASIS_RECOVERED("stasis-recovered", "Stasis recovered", true),
    CONNECTION_LOST("connection-lost", "Connection lost", true);

    private final String key;
    private final String displayName;
    private final boolean enabledByDefault;

    MessageEvent(String key, String displayName, boolean enabledByDefault) {
        this.key = key;
        this.displayName = displayName;
        this.enabledByDefault = enabledByDefault;
    }

    public String key() {
        return key;
    }

    public String displayName() {
        return displayName;
    }

    public boolean enabledByDefault() {
        return enabledByDefault;
    }

    public static MessageEvent fromKey(String key) {
        if (key == null) return null;
        String normalized = key.trim().toLowerCase(Locale.ROOT).replace('_', '-');
        for (MessageEvent event : values()) {
            if (event.key.equals(normalized)) return event;
        }
        return null;
    }
}
