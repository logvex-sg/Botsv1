package com.logvex.worker.core;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The closed set of task kinds a worker will execute.
 *
 * <p>This list is the security boundary. A host message whose kind is not here is rejected with an
 * error, so a compromised or buggy host cannot ask the worker to do something that was never
 * implemented. It is also reported to the host as the worker's capability list.
 */
public final class TaskCatalog {
    private TaskCatalog() {}

    private static final Set<String> KINDS = Set.of(
        Protocol.TASK_STATUS,
        Protocol.TASK_INVENTORY,
        Protocol.TASK_COUNT,
        Protocol.TASK_SEARCH,
        Protocol.TASK_EQUIPMENT,
        Protocol.TASK_REGEAR,
        Protocol.TASK_COMMAND,
        Protocol.TASK_CHAT,
        Protocol.TASK_POSITION,
        Protocol.TASK_EFLY,
        Protocol.TASK_CONTAINER_READ,
        Protocol.TASK_CONTAINER_MOVE,
        Protocol.TASK_SHULKER_READ,
        Protocol.TASK_SHULKER_UNPACK,
        Protocol.TASK_SHULKER_PACK,
        Protocol.TASK_RESTOCK,
        Protocol.TASK_PORTAL_SCAN,
        Protocol.TASK_NL_TASK
    );

    public static boolean isSupported(String kind) {
        return kind != null && KINDS.contains(kind.toLowerCase(Locale.ROOT));
    }

    public static List<String> all() {
        return List.of(
            Protocol.TASK_STATUS,
            Protocol.TASK_INVENTORY,
            Protocol.TASK_COUNT,
            Protocol.TASK_SEARCH,
            Protocol.TASK_EQUIPMENT,
            Protocol.TASK_REGEAR,
            Protocol.TASK_COMMAND,
            Protocol.TASK_CHAT,
            Protocol.TASK_POSITION,
            Protocol.TASK_EFLY,
            Protocol.TASK_CONTAINER_READ,
            Protocol.TASK_CONTAINER_MOVE,
            Protocol.TASK_SHULKER_READ,
            Protocol.TASK_SHULKER_UNPACK,
            Protocol.TASK_SHULKER_PACK,
            Protocol.TASK_RESTOCK,
            Protocol.TASK_PORTAL_SCAN,
            Protocol.TASK_NL_TASK
        );
    }

    /**
     * Whether a kind changes game state and therefore requires the worker's task permissions to
     * allow it. Read-only kinds always run; {@code regear}, {@code command}, {@code chat},
     * {@code efly}, the natural-language kind {@code nl-task} and the storage mutating kinds
     * ({@code container-move}, {@code shulker-unpack}, {@code restock}) move the client, talk to the
     * server or move items, so a worker can refuse them.
     */
    public static boolean isMutating(String kind) {
        if (kind == null) return false;
        String normalized = kind.toLowerCase(Locale.ROOT);
        return Protocol.TASK_REGEAR.equals(normalized)
            || Protocol.TASK_COMMAND.equals(normalized)
            || Protocol.TASK_CHAT.equals(normalized)
            || Protocol.TASK_EFLY.equals(normalized)
            || Protocol.TASK_CONTAINER_MOVE.equals(normalized)
            || Protocol.TASK_SHULKER_UNPACK.equals(normalized)
            || Protocol.TASK_SHULKER_PACK.equals(normalized)
            || Protocol.TASK_RESTOCK.equals(normalized)
            || Protocol.TASK_NL_TASK.equals(normalized);
    }
}
