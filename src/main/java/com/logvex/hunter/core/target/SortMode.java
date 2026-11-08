package com.logvex.hunter.core.target;

/** How automatic target selection orders the candidates. */
public enum SortMode {
    /** Highest priority first, then closest. */
    PRIORITY,
    /** Closest first. */
    DISTANCE,
    /** Lowest health first. */
    HEALTH,
    /** Most recently seen first. */
    RECENCY;

    public String displayName() {
        return switch (this) {
            case PRIORITY -> "Priority";
            case DISTANCE -> "Distance";
            case HEALTH -> "Health";
            case RECENCY -> "Recency";
        };
    }
}
