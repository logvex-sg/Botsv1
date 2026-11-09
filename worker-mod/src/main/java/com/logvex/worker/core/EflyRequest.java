package com.logvex.worker.core;

import com.google.gson.JsonObject;

/**
 * A validated EFly instruction from the host.
 *
 * <p>EFly is the worker's wrapper around the client's own elytra-flight module (Meteor's
 * {@code ElytraFly}) plus its path manager. The host does not send code: it sends one of a small
 * number of actions with plain numbers, and the game layer maps them onto the module's settings and
 * navigation calls. This record is the parse/validate boundary — anything malformed is refused here,
 * before it can reach the client.
 *
 * <p>Two actions exist:
 * <ul>
 *   <li>{@link Action#START} — turn elytra flight on and, when a target is given, fly towards it.</li>
 *   <li>{@link Action#STOP} — turn elytra flight off and stop pathing.</li>
 * </ul>
 */
public record EflyRequest(
    Action action,
    double x,
    double y,
    double z,
    boolean hasTarget,
    String mode,
    double minHeight,
    boolean useFireworks,
    boolean startPathing
) {
    public enum Action { START, STOP }

    public static final double DEFAULT_MIN_HEIGHT = 120;

    /** Parses and validates a task payload. Returns {@code null} when the payload is unusable. */
    public static EflyRequest parse(JsonObject payload) {
        if (payload == null) return null;
        String rawAction = Json.string(payload, Protocol.FIELD_ACTION, Protocol.EFLY_START);
        Action action = switch (rawAction == null ? "" : rawAction.toLowerCase(java.util.Locale.ROOT)) {
            case Protocol.EFLY_STOP, "off", "disable" -> Action.STOP;
            case Protocol.EFLY_START, "on", "enable" -> Action.START;
            default -> null;
        };
        if (action == null) return null;

        boolean hasX = payload.has(Protocol.FIELD_X);
        boolean hasY = payload.has(Protocol.FIELD_Y);
        boolean hasZ = payload.has(Protocol.FIELD_Z);
        boolean hasTarget = hasX && hasY && hasZ;
        double x = Json.number(payload, Protocol.FIELD_X, 0);
        double y = Json.number(payload, Protocol.FIELD_Y, 0);
        double z = Json.number(payload, Protocol.FIELD_Z, 0);
        if (hasTarget && (!isFinite(x) || !isFinite(y) || !isFinite(z))) return null;

        String mode = Json.string(payload, Protocol.FIELD_MODE, "");
        double minHeight = Json.number(payload, Protocol.FIELD_MIN_HEIGHT, DEFAULT_MIN_HEIGHT);
        boolean useFireworks = Json.bool(payload, Protocol.FIELD_USE_FIREWORKS, false);
        // Starting pathing only makes sense with a target; the host may also just enable flight and
        // steer manually, so this is opt-in and defaults to "on when a target is present".
        boolean startPathing = Json.bool(payload, "startPathing", hasTarget);

        return new EflyRequest(action, x, y, z, hasTarget, mode == null ? "" : mode, minHeight, useFireworks, startPathing);
    }

    public static EflyRequest stop() {
        return new EflyRequest(Action.STOP, 0, 0, 0, false, "", DEFAULT_MIN_HEIGHT, false, false);
    }

    public boolean isStop() {
        return action == Action.STOP;
    }

    private static boolean isFinite(double value) {
        return !Double.isNaN(value) && !Double.isInfinite(value);
    }
}
