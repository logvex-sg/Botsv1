package com.logvex.worker.core;

import com.google.gson.JsonObject;

/**
 * Validated storage and world-maintenance instructions from the host.
 *
 * <p>This is the parse/validate boundary for the storage task kinds. Like {@link EflyRequest}, it
 * turns an untrusted payload into a small, plain record with everything checked up front, so a
 * malformed request is refused here rather than reaching the game layer as a half-built action. The
 * host never sends code: it sends coordinates, an item query, a count and a direction, and the game
 * layer maps those onto inventory clicks and block interactions.
 *
 * <p>Pure: unit-testable without a Minecraft client.
 */
public final class StorageRequests {
    private StorageRequests() {}

    /** Which way items move across an open container screen. */
    public enum Direction { WITHDRAW, DEPOSIT }

    /** The largest number of items a single request may move, so a bad limit cannot empty a chest. */
    public static final int MAX_LIMIT = 3456;
    /** The largest block radius a portal scan or removal may cover. */
    public static final int MAX_RADIUS = 64;

    /** Read one registered container's contents at a fixed block position. */
    public record ContainerRead(double x, double y, double z, String dimension, String label) {}

    /**
     * Move items across a container screen.
     *
     * <p>{@link Direction#WITHDRAW} takes matching items out of the container into the player;
     * {@link Direction#DEPOSIT} puts matching items from the player into the container. A source
     * position is present when the host wants the worker to open a specific block first; when it is
     * absent the worker acts on whatever container screen is already open.
     */
    public record ContainerMove(
        Direction direction,
        String query,
        int limit,
        boolean hasTarget,
        double x,
        double y,
        double z,
        String dimension,
        String label
    ) {}

    /** Read the decoded contents of the shulker boxes the worker is carrying. */
    public record ShulkerRead(int slot) {
        /** True when the host named a single inventory slot instead of asking for every shulker. */
        public boolean hasSlot() {
            return slot >= 0;
        }
    }

    /** Empty a carried shulker box into the worker's inventory and any open container. */
    public record ShulkerUnpack(int slot) {
        public boolean hasSlot() {
            return slot >= 0;
        }
    }

    /**
     * Pack matching loose items from the worker's inventory into a carried shulker box.
     *
     * <p>Vanilla has no "pack" click either: a shulker box is filled by placing it, which opens its
     * screen, then quick-moving the matching inventory slots in, then breaking the box again. Only
     * items matching {@code query} move, so packing never sweeps up the worker's tools or armour.
     */
    public record ShulkerPack(String query, int limit, int slot) {
        public boolean hasSlot() {
            return slot >= 0;
        }
    }

    /** Top the worker's inventory back up to a minimum from a source container. */
    public record Restock(String query, int limit, boolean hasSource, double x, double y, double z, String dimension) {}

    /** Find nether/end portal blocks near the worker, and optionally remove them. */
    public record PortalScan(Action action, int radius, boolean hasTarget, double x, double y, double z) {
        public enum Action { SCAN, REMOVE }

        public boolean isRemove() {
            return action == Action.REMOVE;
        }
    }

    public static ContainerRead parseContainerRead(JsonObject payload) {
        if (payload == null) return null;
        boolean hasTarget = payload.has(Protocol.FIELD_X) && payload.has(Protocol.FIELD_Y) && payload.has(Protocol.FIELD_Z);
        if (!hasTarget) return null;
        double x = Json.number(payload, Protocol.FIELD_X, 0);
        double y = Json.number(payload, Protocol.FIELD_Y, 0);
        double z = Json.number(payload, Protocol.FIELD_Z, 0);
        if (!finite(x, y, z)) return null;
        return new ContainerRead(x, y, z,
            Json.string(payload, "dimension", ""),
            Json.string(payload, Protocol.FIELD_LABEL, ""));
    }

    public static ContainerMove parseContainerMove(JsonObject payload) {
        if (payload == null) return null;
        Direction direction = switch (Json.string(payload, Protocol.FIELD_DIRECTION, "withdraw").toLowerCase(java.util.Locale.ROOT)) {
            case "withdraw", "take", "out" -> Direction.WITHDRAW;
            case "deposit", "put", "in" -> Direction.DEPOSIT;
            default -> null;
        };
        if (direction == null) return null;
        String query = Json.string(payload, Protocol.FIELD_QUERY, Json.string(payload, Protocol.FIELD_ITEM, ""));
        if (query.isBlank()) return null;
        int limit = clamp(Json.integer(payload, Protocol.FIELD_LIMIT, Json.integer(payload, "count", 1)), 1, MAX_LIMIT);

        boolean hasTarget = payload.has(Protocol.FIELD_X) && payload.has(Protocol.FIELD_Y) && payload.has(Protocol.FIELD_Z);
        double x = Json.number(payload, Protocol.FIELD_X, 0);
        double y = Json.number(payload, Protocol.FIELD_Y, 0);
        double z = Json.number(payload, Protocol.FIELD_Z, 0);
        if (hasTarget && !finite(x, y, z)) return null;
        return new ContainerMove(direction, query, limit, hasTarget, x, y, z,
            Json.string(payload, "dimension", ""),
            Json.string(payload, Protocol.FIELD_LABEL, ""));
    }

    public static ShulkerRead parseShulkerRead(JsonObject payload) {
        return new ShulkerRead(Json.integer(payload, Protocol.FIELD_SLOT, -1));
    }

    public static ShulkerUnpack parseShulkerUnpack(JsonObject payload) {
        return new ShulkerUnpack(Json.integer(payload, Protocol.FIELD_SLOT, -1));
    }

    public static ShulkerPack parseShulkerPack(JsonObject payload) {
        if (payload == null) return null;
        String query = Json.string(payload, Protocol.FIELD_QUERY, Json.string(payload, Protocol.FIELD_ITEM, ""));
        if (query.isBlank()) return null;
        int limit = clamp(Json.integer(payload, Protocol.FIELD_LIMIT, Json.integer(payload, "count", 1)), 1, MAX_LIMIT);
        return new ShulkerPack(query, limit, Json.integer(payload, Protocol.FIELD_SLOT, -1));
    }

    public static Restock parseRestock(JsonObject payload) {
        if (payload == null) return null;
        String query = Json.string(payload, Protocol.FIELD_QUERY, Json.string(payload, Protocol.FIELD_ITEM, ""));
        if (query.isBlank()) return null;
        int limit = clamp(Json.integer(payload, Protocol.FIELD_LIMIT, Json.integer(payload, "count", 1)), 1, MAX_LIMIT);
        boolean hasSource = payload.has(Protocol.FIELD_X) && payload.has(Protocol.FIELD_Y) && payload.has(Protocol.FIELD_Z);
        double x = Json.number(payload, Protocol.FIELD_X, 0);
        double y = Json.number(payload, Protocol.FIELD_Y, 0);
        double z = Json.number(payload, Protocol.FIELD_Z, 0);
        if (hasSource && !finite(x, y, z)) return null;
        return new Restock(query, limit, hasSource, x, y, z, Json.string(payload, "dimension", ""));
    }

    public static PortalScan parsePortalScan(JsonObject payload) {
        JsonObject safe = payload == null ? new JsonObject() : payload;
        PortalScan.Action action = switch (Json.string(safe, Protocol.FIELD_ACTION, "scan").toLowerCase(java.util.Locale.ROOT)) {
            case "scan", "find", "list" -> PortalScan.Action.SCAN;
            case "remove", "break", "clear" -> PortalScan.Action.REMOVE;
            default -> null;
        };
        if (action == null) return null;
        int radius = clamp(Json.integer(safe, Protocol.FIELD_RADIUS, 24), 1, MAX_RADIUS);
        boolean hasTarget = safe.has(Protocol.FIELD_X) && safe.has(Protocol.FIELD_Y) && safe.has(Protocol.FIELD_Z);
        double x = Json.number(safe, Protocol.FIELD_X, 0);
        double y = Json.number(safe, Protocol.FIELD_Y, 0);
        double z = Json.number(safe, Protocol.FIELD_Z, 0);
        if (hasTarget && !finite(x, y, z)) return null;
        return new PortalScan(action, radius, hasTarget, x, y, z);
    }

    private static boolean finite(double x, double y, double z) {
        return Double.isFinite(x) && Double.isFinite(y) && Double.isFinite(z);
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
