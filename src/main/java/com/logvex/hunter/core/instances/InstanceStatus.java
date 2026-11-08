package com.logvex.hunter.core.instances;

/** The liveness reported by an instance. */
public enum InstanceStatus {
    UNKNOWN("Unknown"),
    ONLINE("Online"),
    OFFLINE("Offline"),
    DISABLED("Disabled");

    private final String displayName;

    InstanceStatus(String displayName) {
        this.displayName = displayName;
    }

    public String displayName() {
        return displayName;
    }

    public String key() {
        return name().toLowerCase(java.util.Locale.ROOT);
    }

    public static InstanceStatus fromKey(String key) {
        if (key == null) return UNKNOWN;
        for (InstanceStatus status : values()) {
            if (status.key().equalsIgnoreCase(key) || status.name().equalsIgnoreCase(key)) return status;
        }
        return UNKNOWN;
    }
}
