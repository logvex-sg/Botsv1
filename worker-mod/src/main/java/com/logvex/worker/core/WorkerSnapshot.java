package com.logvex.worker.core;

import java.util.ArrayList;
import java.util.List;

/**
 * Everything the host needs to draw a worker row, in one flat object.
 *
 * <p>Sent on registration and then on every heartbeat, so the host never has to poll and the worker
 * never has to answer a "what are you doing" question twice.
 */
public final class WorkerSnapshot {
    public String workerId = "";
    public String label = "";
    public String username = "";
    public String minecraftVersion = "";
    public String serverAddress = "";
    public String dimension = "unknown";
    public String gameMode = "unknown";
    /** Whether the client is currently in a world (not merely launched). */
    public boolean inWorld;

    public double x;
    public double y;
    public double z;

    public float health;
    public float maxHealth;
    public int food;
    public float saturation;

    public int armorPieces;
    public int totems;
    public int foodItems;
    public String heldItem = "";
    public String offhandItem = "";

    public String currentTask = "";
    public String lastActivity = "";
    public long lastActivityAt;
    public String lastError = "";

    public int totalItems;
    public int distinctItems;
    public int freeSlots;

    public List<String> capabilities = new ArrayList<>();
}
