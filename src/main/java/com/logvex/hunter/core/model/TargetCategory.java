package com.logvex.hunter.core.model;

import java.util.Locale;

/**
 * The independently configurable target lists the Target Manager supports.
 *
 * <p>{@link #protectedCategory()} lists are never selected as an attack target, and are the
 * mechanism behind friend and ignore-list protection.
 */
public enum TargetCategory {
    PRIORITY("Priority Targets", true, false),
    BOT("Bot Accounts", true, false),
    OPPONENT("Known Opponents", true, false),
    IGNORE("Ignore List", false, true),
    FRIEND("Friends", false, true),
    TEMPORARY("Temporary Targets", true, false);

    private final String displayName;
    private final boolean selectable;
    private final boolean protectedCategory;

    TargetCategory(String displayName, boolean selectable, boolean protectedCategory) {
        this.displayName = displayName;
        this.selectable = selectable;
        this.protectedCategory = protectedCategory;
    }

    public String displayName() {
        return displayName;
    }

    /** Whether entries in this list may ever be chosen as a target. */
    public boolean selectable() {
        return selectable;
    }

    /** Whether entries in this list are protected from being targeted. */
    public boolean protectedCategory() {
        return protectedCategory;
    }

    public String key() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static TargetCategory fromKey(String key) {
        if (key == null) return TEMPORARY;
        String normalized = key.trim().toUpperCase(Locale.ROOT).replace('-', '_').replace(' ', '_');
        for (TargetCategory category : values()) {
            if (category.name().equals(normalized) || category.key().equalsIgnoreCase(key)) return category;
        }
        return TEMPORARY;
    }
}
