package com.logvex.worker.core;

import com.google.gson.JsonObject;

/**
 * Runs a task and reports what happened.
 *
 * <p>The implementation is supplied by the game layer, which marshals each call onto the Minecraft
 * client thread. Keeping this as an interface means {@link WorkerLink} has no Minecraft types in it
 * and can be exercised end-to-end in a plain JVM test.
 */
public interface TaskDispatcher {
    /** Executes one task and returns its result. Never throws; failures come back as a result. */
    TaskResult dispatch(String taskId, String kind, JsonObject payload);

    /** The current status snapshot. Safe to call from any thread. */
    WorkerSnapshot snapshot();
}
