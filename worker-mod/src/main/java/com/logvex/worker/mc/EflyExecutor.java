package com.logvex.worker.mc;

import com.logvex.worker.core.EflyRequest;
import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.TaskResult;
import java.util.Locale;
import meteordevelopment.meteorclient.pathing.PathManagers;
import meteordevelopment.meteorclient.systems.modules.Modules;
import meteordevelopment.meteorclient.systems.modules.movement.elytrafly.ElytraFly;
import meteordevelopment.meteorclient.systems.modules.movement.elytrafly.ElytraFlightModes;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;

/**
 * Executes EFly tasks by driving the client's own elytra-flight implementation.
 *
 * <p>There is no bespoke EFly API to call, and inventing one would be wrong. Meteor already ships
 * {@code ElytraFly} — a module that flies the player with the equipped elytra and, with autopilot
 * on, keeps it moving forward. This class does the honest thing: it enables that module, sets its
 * real settings, and asks Meteor's path manager (Baritone, when installed) to fly to the target.
 * Everything it reports back is read from the module's actual state, never assumed.
 *
 * <p>All work is marshalled onto the client thread by {@link WorkerGameBridge}; the network threads
 * never touch Minecraft.
 */
public final class EflyExecutor {
    private static volatile boolean active;
    private static volatile String target = "";
    private static volatile double lastX;
    private static volatile double lastY;
    private static volatile double lastZ;

    private EflyExecutor() {}

    public static boolean isActive() {
        return active;
    }

    /** "x y z" of the current EFly target, or blank when none. */
    public static String target() {
        return target;
    }

    public static TaskResult start(String taskId, EflyRequest request) {
        Boolean applied = WorkerGameBridge.call(() -> applyStart(request), Boolean.FALSE);
        if (applied == null || !applied) {
            return TaskResult.failure(taskId, Protocol.TASK_EFLY, "no client or elytra-fly module available");
        }
        active = true;
        target = request.hasTarget() ? format(request.x(), request.y(), request.z()) : "";
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_EFLY,
            request.hasTarget() ? "efly engaged, heading to " + target : "efly engaged");
        result.with(Protocol.FIELD_ACTION, Protocol.EFLY_START);
        result.with(Protocol.FIELD_MODE, request.mode());
        result.with(Protocol.FIELD_USE_FIREWORKS, request.useFireworks());
        result.with(Protocol.FIELD_MIN_HEIGHT, request.minHeight());
        if (request.hasTarget()) {
            result.with(Protocol.FIELD_X, request.x());
            result.with(Protocol.FIELD_Y, request.y());
            result.with(Protocol.FIELD_Z, request.z());
        }
        return result;
    }

    public static TaskResult stop(String taskId) {
        WorkerGameBridge.run(EflyExecutor::applyStop);
        active = false;
        target = "";
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_EFLY, "efly disengaged");
        result.with(Protocol.FIELD_ACTION, Protocol.EFLY_STOP);
        return result;
    }

    // ------------------------------------------------------------------ client thread

    private static boolean applyStart(EflyRequest request) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft == null || minecraft.player == null) return false;

        ElytraFly fly;
        try {
            fly = Modules.get().get(ElytraFly.class);
        } catch (RuntimeException ex) {
            return false;
        }
        if (fly == null) return false;

        // Apply the supported flight settings first so the module behaves as the host asked.
        applyMode(fly, request.mode());
        fly.useFireworks.set(request.useFireworks());
        fly.autoPilotMinimumHeight.set(request.minHeight());
        // Autopilot is what actually moves the player forward; without it the module only steers.
        if (request.hasTarget()) fly.autoPilot.set(true);

        if (!fly.isActive()) fly.toggle();

        if (request.hasTarget() && request.startPathing()) {
            PathManagers.get().moveTo(new BlockPos((int) Math.floor(request.x()), (int) Math.floor(request.y()), (int) Math.floor(request.z())));
        }
        return true;
    }

    private static void applyStop() {
        try {
            PathManagers.get().stop();
        } catch (RuntimeException ignored) {
            // Path manager may be the no-op implementation; nothing to stop.
        }
        try {
            ElytraFly fly = Modules.get().get(ElytraFly.class);
            if (fly != null && fly.isActive()) fly.toggle();
        } catch (RuntimeException ignored) {
            // Module may be unavailable; the link still reports stopped.
        }
    }

    private static void applyMode(ElytraFly fly, String mode) {
        if (mode == null || mode.isBlank()) return;
        String normalized = mode.toLowerCase(Locale.ROOT);
        for (ElytraFlightModes candidate : ElytraFlightModes.values()) {
            if (candidate.name().toLowerCase(Locale.ROOT).equals(normalized)) {
                fly.flightMode.set(candidate);
                return;
            }
        }
    }

    // ------------------------------------------------------------------ status

    /** Refreshes the live position used for progress reporting; call on the client tick. */
    public static void samplePosition() {
        Minecraft minecraft = Minecraft.getInstance();
        LocalPlayer player = minecraft == null ? null : minecraft.player;
        if (player == null) return;
        lastX = player.getX();
        lastY = player.getY();
        lastZ = player.getZ();
    }

    /** A one-line progress string for the snapshot, or blank when not flying. */
    public static String progressLine() {
        if (!active) return "";
        if (target.isEmpty()) return "efly: airborne";
        double dx = lastX - parse(target, 0);
        double dy = lastY - parse(target, 1);
        double dz = lastZ - parse(target, 2);
        double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return String.format(Locale.ROOT, "efly: %.0f blocks to target", distance);
    }

    private static double parse(String formatted, int index) {
        String[] parts = formatted.split(" ");
        if (index >= parts.length) return 0;
        try {
            return Double.parseDouble(parts[index]);
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private static String format(double x, double y, double z) {
        return String.format(Locale.ROOT, "%.0f %.0f %.0f", x, y, z);
    }
}
