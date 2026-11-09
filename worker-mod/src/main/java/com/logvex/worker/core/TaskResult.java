package com.logvex.worker.core;

import com.google.gson.JsonObject;

/**
 * The outcome of a task, sent back to the host.
 *
 * <p>{@code ok} is only ever true once the action has actually completed. The host is required to
 * treat a missing result as "unknown", so the worker must not report success optimistically.
 */
public final class TaskResult {
    public boolean ok;
    public String taskId = "";
    public String kind = "";
    public String message = "";
    public JsonObject data = new JsonObject();

    public TaskResult() {}

    public static TaskResult ok(String taskId, String kind, String message) {
        TaskResult result = new TaskResult();
        result.ok = true;
        result.taskId = taskId;
        result.kind = kind;
        result.message = message;
        return result;
    }

    public static TaskResult failure(String taskId, String kind, String message) {
        TaskResult result = new TaskResult();
        result.ok = false;
        result.taskId = taskId;
        result.kind = kind;
        result.message = message;
        return result;
    }

    public TaskResult with(String key, Object value) {
        data.add(key, Json.gson().toJsonTree(value));
        return this;
    }
}
