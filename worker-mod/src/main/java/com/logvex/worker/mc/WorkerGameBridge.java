package com.logvex.worker.mc;

import com.logvex.worker.WorkerMod;
import com.google.gson.JsonObject;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import net.minecraft.client.Minecraft;

/**
 * Marshals work onto the Minecraft client thread.
 *
 * <p>Every read of game state and every interaction with the client must happen on the client
 * thread; the network threads must not touch it. {@code Minecraft} is a task-draining event loop and
 * {@code execute} is public, so no mixin or Fabric API is needed to hop threads. Calls that need a
 * value block on a future with a short timeout so a stuck client cannot wedge the worker.
 */
public final class WorkerGameBridge {
    private static final long CALL_TIMEOUT_MILLIS = 4_000;

    private WorkerGameBridge() {}

    /** Runs a task on the client thread and waits for its result. */
    public static <T> T call(Callable<T> task, T fallback) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft == null) return fallback;
        if (minecraft.isSameThread()) {
            try {
                return task.call();
            } catch (Exception ex) {
                WorkerMod.LOG.warn("client-thread call failed", ex);
                return fallback;
            }
        }
        CompletableFuture<T> future = new CompletableFuture<>();
        minecraft.execute(() -> {
            try {
                future.complete(task.call());
            } catch (Exception ex) {
                future.completeExceptionally(ex);
            }
        });
        try {
            return future.get(CALL_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException ex) {
            // The client is busy (loading a world, for example). Report the fallback rather than
            // blocking the worker's task thread indefinitely.
            return fallback;
        } catch (ExecutionException ex) {
            WorkerMod.LOG.warn("client-thread task failed", ex.getCause());
            return fallback;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return fallback;
        }
    }

    /** Fire-and-forget variant for actions whose outcome is reported separately. */
    public static void run(Runnable task) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft == null) return;
        if (minecraft.isSameThread()) {
            task.run();
            return;
        }
        minecraft.execute(task);
    }

    /** Convenience for building a payload the host can read without extra parsing. */

}
