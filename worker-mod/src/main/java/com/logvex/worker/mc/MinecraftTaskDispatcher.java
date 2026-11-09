package com.logvex.worker.mc;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.logvex.worker.core.EquipmentReport;
import com.logvex.worker.core.EquipmentRequirements;
import com.logvex.worker.core.InventorySummary;
import com.logvex.worker.core.ItemEntry;
import com.logvex.worker.core.Json;
import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.TaskDispatcher;
import com.logvex.worker.core.TaskResult;
import com.logvex.worker.core.WorkerSnapshot;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.Player;

/**
 * Executes a task on the Minecraft client.
 *
 * <p>Each kind is a small, explicit method. Anything that touches game state goes through
 * {@link WorkerGameBridge}, which puts it on the client thread; the network thread never calls into
 * Minecraft directly. Read-only tasks report what they find and change nothing; the single mutating
 * task ({@code regear}) only ever shift-clicks, only when the host explicitly asks for moves, and
 * re-reads the inventory afterwards so its report reflects what actually happened.
 */
public final class MinecraftTaskDispatcher implements TaskDispatcher {
    private volatile String currentTask = "";
    private volatile String lastActivity = "";
    private volatile long lastActivityAt;
    private volatile String lastError = "";

    @Override
    public WorkerSnapshot snapshot() {
        WorkerSnapshot snapshot = WorkerGameBridge.call(StatusCollector::collect, new WorkerSnapshot());
        snapshot.currentTask = currentTask;
        snapshot.lastActivity = lastActivity;
        snapshot.lastActivityAt = lastActivityAt;
        snapshot.lastError = lastError;
        return snapshot;
    }

    @Override
    public TaskResult dispatch(String taskId, String kind, JsonObject payload) {
        long started = System.currentTimeMillis();
        currentTask = kind;
        try {
            TaskResult result = switch (kind) {
                case Protocol.TASK_STATUS -> status(taskId);
                case Protocol.TASK_INVENTORY -> inventory(taskId);
                case Protocol.TASK_COUNT -> count(taskId, payload);
                case Protocol.TASK_SEARCH -> search(taskId, payload);
                case Protocol.TASK_EQUIPMENT -> equipment(taskId, payload);
                case Protocol.TASK_REGEAR -> regear(taskId, payload);
                case Protocol.TASK_COMMAND -> command(taskId, payload);
                case Protocol.TASK_CHAT -> chat(taskId, payload);
                case Protocol.TASK_POSITION -> position(taskId);
                default -> TaskResult.failure(taskId, kind, "unsupported task kind: " + kind);
            };
            result.with("durationMs", System.currentTimeMillis() - started);
            lastActivity = kind + (result.ok ? " ok" : " failed");
            lastActivityAt = System.currentTimeMillis();
            if (!result.ok) lastError = result.message;
            return result;
        } catch (Exception ex) {
            lastError = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
            return TaskResult.failure(taskId, kind, "task error: " + lastError);
        } finally {
            currentTask = "";
        }
    }

    // ------------------------------------------------------------------ reads

    private TaskResult status(String taskId) {
        WorkerSnapshot snapshot = WorkerGameBridge.call(StatusCollector::collect, new WorkerSnapshot());
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_STATUS,
            snapshot.inWorld ? "in " + snapshot.dimension : "not in a world");
        result.data = Json.gson().toJsonTree(snapshot).getAsJsonObject();
        return result;
    }

    private TaskResult inventory(String taskId) {
        InventoryView view = WorkerGameBridge.call(this::readInventory, null);
        if (view == null) return TaskResult.failure(taskId, Protocol.TASK_INVENTORY, "no client available");

        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_INVENTORY,
            view.carried.size() + " carried stacks, " + view.accessible.size() + " accessible stacks");
        result.with("carried", view.carried);
        result.with("accessible", view.accessible);
        result.with("armor", view.armor);
        result.with("carriedTotal", InventorySummary.totalItems(view.carried));
        result.with("carriedDistinct", InventorySummary.distinctItems(view.carried));
        result.with("accessibleTotal", InventorySummary.totalItems(view.accessible));
        result.with("containerOpen", view.containerOpen);
        result.with("freeSlots", view.freeSlots);
        result.with("totals", InventorySummary.totalsById(view.carried));
        return result;
    }

    private TaskResult count(String taskId, JsonObject payload) {
        String query = Json.string(payload, "query", Json.string(payload, "item", ""));
        if (query.isBlank()) return TaskResult.failure(taskId, Protocol.TASK_COUNT, "no item query supplied");
        InventoryView view = WorkerGameBridge.call(this::readInventory, null);
        if (view == null) return TaskResult.failure(taskId, Protocol.TASK_COUNT, "no client available");

        int carried = InventorySummary.countMatching(view.carried, query);
        int accessible = InventorySummary.countMatching(view.accessible, query);
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_COUNT, carried + " carried");
        result.with("query", query);
        result.with("carried", carried);
        result.with("accessible", accessible);
        result.with("containerOpen", view.containerOpen);
        return result;
    }

    private TaskResult search(String taskId, JsonObject payload) {
        String query = Json.string(payload, "query", Json.string(payload, "item", ""));
        if (query.isBlank()) return TaskResult.failure(taskId, Protocol.TASK_SEARCH, "no search term supplied");
        InventoryView view = WorkerGameBridge.call(this::readInventory, null);
        if (view == null) return TaskResult.failure(taskId, Protocol.TASK_SEARCH, "no client available");

        List<ItemEntry> matches = InventorySummary.find(view.carried, query);
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_SEARCH, matches.size() + " matching stacks");
        result.with("query", query);
        result.with("matches", matches);
        result.with("total", InventorySummary.countMatching(view.carried, query));
        return result;
    }

    private TaskResult equipment(String taskId, JsonObject payload) {
        EquipmentRequirements requirements = EquipmentRequirements.fromJson(payload);
        EquipmentReport report = WorkerGameBridge.call(() -> StatusCollector.evaluate(requirements), null);
        if (report == null) return TaskResult.failure(taskId, Protocol.TASK_EQUIPMENT, "no client available");
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_EQUIPMENT,
            report.ready ? "loadout satisfied" : report.missing.size() + " item(s) missing");
        result.with("report", report);
        return result;
    }

    private TaskResult position(String taskId) {
        WorkerSnapshot snapshot = WorkerGameBridge.call(StatusCollector::collect, new WorkerSnapshot());
        if (!snapshot.inWorld) return TaskResult.failure(taskId, Protocol.TASK_POSITION, "not in a world");
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_POSITION,
            String.format("%.1f %.1f %.1f", snapshot.x, snapshot.y, snapshot.z));
        result.with("x", snapshot.x);
        result.with("y", snapshot.y);
        result.with("z", snapshot.z);
        result.with("dimension", snapshot.dimension);
        result.with("health", snapshot.health);
        result.with("food", snapshot.food);
        return result;
    }

    // ----------------------------------------------------------------- writes

    /**
     * Regear: report what is missing, and only move items when the host asked for it.
     *
     * <p>{@code payload.allowMoves} defaults to false, so a plain regear request is a dry run. When
     * moves are enabled the worker withdraws matching items from whatever container is currently
     * open and then re-reads the inventory, so the confirmation reflects reality rather than intent.
     */
    private TaskResult regear(String taskId, JsonObject payload) {
        EquipmentRequirements requirements = EquipmentRequirements.fromJson(payload);
        boolean allowMoves = Json.bool(payload, "allowMoves", false);

        EquipmentReport before = WorkerGameBridge.call(() -> StatusCollector.evaluate(requirements), null);
        if (before == null) return TaskResult.failure(taskId, Protocol.TASK_REGEAR, "no client available");

        if (!allowMoves) {
            TaskResult result = TaskResult.ok(taskId, Protocol.TASK_REGEAR,
                before.ready ? "loadout satisfied (no moves requested)" : "dry run: " + before.missing.size() + " missing");
            result.with("report", before);
            result.with("moved", 0);
            result.with("movedItems", List.of());
            result.with("dryRun", true);
            return result;
        }

        boolean containerOpen = WorkerGameBridge.call(() -> {
            Player player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
            return InventoryReader.hasContainerOpen(player);
        }, false);

        if (!containerOpen) {
            TaskResult result = TaskResult.ok(taskId, Protocol.TASK_REGEAR,
                "no container open; nothing can be withdrawn");
            result.with("report", before);
            result.with("moved", 0);
            result.with("movedItems", List.of());
            result.with("dryRun", false);
            return result;
        }

        JsonArray movedItems = new JsonArray();
        for (var line : before.lines) {
            if (line.satisfied) continue;
            int needed = line.missing();
            Integer moved = WorkerGameBridge.call(
                () -> ContainerMover.withdrawFromOpenContainer(line.query, needed), 0);
            if (moved != null && moved > 0) {
                JsonObject movedItem = new JsonObject();
                movedItem.addProperty("query", line.query);
                movedItem.addProperty("count", moved);
                movedItems.add(movedItem);
            }
        }

        EquipmentReport after = WorkerGameBridge.call(() -> StatusCollector.evaluate(requirements), before);
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_REGEAR,
            after.ready ? "regear complete" : "regear incomplete: " + after.missing.size() + " still missing");
        result.with("report", after);
        result.with("before", before);
        result.with("movedItems", movedItems);
        result.with("dryRun", false);
        return result;
    }

    private TaskResult command(String taskId, JsonObject payload) {
        String command = Json.string(payload, "command", Json.string(payload, "line", ""));
        if (command.startsWith("/")) command = command.substring(1);
        if (command.isBlank()) return TaskResult.failure(taskId, Protocol.TASK_COMMAND, "no command supplied");
        String finalCommand = command;
        String error = WorkerGameBridge.call(() -> CommandSender.sendCommand(finalCommand), "no client available");
        if (error != null) return TaskResult.failure(taskId, Protocol.TASK_COMMAND, error);
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_COMMAND, "sent /" + command);
        result.with("command", command);
        return result;
    }

    private TaskResult chat(String taskId, JsonObject payload) {
        String message = Json.string(payload, "message", Json.string(payload, "text", ""));
        if (message.isBlank()) return TaskResult.failure(taskId, Protocol.TASK_CHAT, "no message supplied");
        String error = WorkerGameBridge.call(() -> CommandSender.sendChat(message), "no client available");
        if (error != null) return TaskResult.failure(taskId, Protocol.TASK_CHAT, error);
        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_CHAT, "sent chat");
        result.with("message", message);
        return result;
    }

    // ----------------------------------------------------------------- helpers

    /** Everything the inventory task reports, gathered in one client-thread hop. */
    private record InventoryView(
        List<ItemEntry> carried,
        List<ItemEntry> accessible,
        List<ItemEntry> armor,
        boolean containerOpen,
        int freeSlots
    ) {}

    private InventoryView readInventory() {
        Minecraft minecraft = Minecraft.getInstance();
        Player player = minecraft == null ? null : minecraft.player;
        if (player == null) return new InventoryView(List.of(), List.of(), List.of(), false, 0);
        return new InventoryView(
            InventoryReader.carried(player),
            InventoryReader.accessible(player),
            InventoryReader.armor(player),
            InventoryReader.hasContainerOpen(player),
            InventoryReader.freeSlots(player)
        );
    }
}
