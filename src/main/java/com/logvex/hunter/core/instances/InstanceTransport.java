package com.logvex.hunter.core.instances;

/** How an instance is reached and what it is allowed to do. */
public enum InstanceTransport {
    /** No remote control: the instance is only listed and its statistics are read. */
    READ_ONLY("Read only"),
    /** The instance runs its own HTTP endpoint that accepts authenticated commands. */
    HTTP("HTTP");

    private final String displayName;

    InstanceTransport(String displayName) {
        this.displayName = displayName;
    }

    public String displayName() {
        return displayName;
    }

    public String key() {
        return name().toLowerCase(java.util.Locale.ROOT);
    }

    public static InstanceTransport fromKey(String key) {
        if (key == null) return READ_ONLY;
        for (InstanceTransport transport : values()) {
            if (transport.key().equalsIgnoreCase(key) || transport.name().equalsIgnoreCase(key)) return transport;
        }
        return READ_ONLY;
    }
}
