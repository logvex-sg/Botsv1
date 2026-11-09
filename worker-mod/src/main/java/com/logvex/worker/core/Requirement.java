package com.logvex.worker.core;

/** One line of an equipment loadout: "have at least {@code count} of {@code query}". */
public final class Requirement {
    public String query = "";
    public int count = 1;
    public String label = "";

    public Requirement() {}

    public Requirement(String query, int count, String label) {
        this.query = query == null ? "" : query;
        this.count = Math.max(1, count);
        this.label = label == null || label.isEmpty() ? this.query : label;
    }
}
