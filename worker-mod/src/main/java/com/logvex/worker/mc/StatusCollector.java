package com.logvex.worker.mc;

import com.logvex.worker.core.EquipmentRequirements;
import com.logvex.worker.core.EquipmentReport;
import com.logvex.worker.core.ItemEntry;
import com.logvex.worker.core.TaskCatalog;
import com.logvex.worker.core.WorkerSnapshot;
import java.util.List;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;

/**
 * Builds the status snapshot the host displays.
 *
 * <p>Reads only: nothing here changes game state. Every read is null-guarded because the client can
 * be between worlds, mid-disconnect or still on the title screen when the host asks.
 */
public final class StatusCollector {
    private StatusCollector() {}

    public static WorkerSnapshot collect() {
        WorkerSnapshot snapshot = new WorkerSnapshot();
        snapshot.minecraftVersion = minecraftVersion();
        snapshot.capabilities = TaskCatalog.all();

        Minecraft minecraft = Minecraft.getInstance();
        Player player = minecraft == null ? null : minecraft.player;
        snapshot.inWorld = player != null && minecraft.level != null;

        if (!snapshot.inWorld) {
            snapshot.dimension = "none";
            snapshot.gameMode = "none";
            snapshot.lastActivity = "not in a world";
            return snapshot;
        }

        snapshot.username = player.getScoreboardName();
        snapshot.serverAddress = serverAddress(minecraft);
        snapshot.dimension = dimensionId(player);
        snapshot.gameMode = gameMode(minecraft);

        snapshot.x = player.getX();
        snapshot.y = player.getY();
        snapshot.z = player.getZ();

        snapshot.health = player.getHealth();
        snapshot.maxHealth = player.getMaxHealth();
        snapshot.food = player.getFoodData().getFoodLevel();
        snapshot.saturation = player.getFoodData().getSaturationLevel();

        List<ItemEntry> carried = InventoryReader.carried(player);
        List<ItemEntry> armor = InventoryReader.armor(player);

        snapshot.armorPieces = 0;
        for (ItemEntry piece : armor) {
            if (piece != null) snapshot.armorPieces++;
        }
        snapshot.heldItem = nameOf(player.getMainHandItem());
        snapshot.offhandItem = nameOf(player.getItemBySlot(EquipmentSlot.OFFHAND));

        snapshot.totalItems = com.logvex.worker.core.InventorySummary.totalItems(carried);
        snapshot.distinctItems = com.logvex.worker.core.InventorySummary.distinctItems(carried);
        snapshot.freeSlots = InventoryReader.freeSlots(player);

        snapshot.totems = InventoryReader.count(carried, "totem");
        snapshot.foodItems = countFood(player);

        return snapshot;
    }

    /** Evaluates an equipment loadout against the current client. */
    public static EquipmentReport evaluate(EquipmentRequirements requirements) {
        Minecraft minecraft = Minecraft.getInstance();
        Player player = minecraft == null ? null : minecraft.player;
        if (player == null) {
            return EquipmentReport.evaluate(requirements, List.of(), 0, 0, 0, List.of());
        }
        List<ItemEntry> carried = InventoryReader.carried(player);
        int armorPieces = 0;
        for (ItemEntry piece : InventoryReader.armor(player)) {
            if (piece != null) armorPieces++;
        }
        int food = countFood(player);
        int totems = InventoryReader.count(carried, "totem");
        List<String> damaged = InventoryReader.damagedGear(player, requirements.lowDurabilityPercent);
        return EquipmentReport.evaluate(requirements, carried, armorPieces, food, totems, damaged);
    }

    public static String minecraftVersion() {
        try {
            return SharedConstants.getCurrentVersion().name();
        } catch (RuntimeException ex) {
            return "unknown";
        }
    }

    private static String serverAddress(Minecraft minecraft) {
        try {
            if (minecraft.hasSingleplayerServer()) return "singleplayer";
            ServerData server = minecraft.getCurrentServer();
            if (server == null) return "unknown";
            return server.ip == null || server.ip.isEmpty() ? server.name : server.ip;
        } catch (RuntimeException ex) {
            return "unknown";
        }
    }

    private static String dimensionId(Player player) {
        try {
            return player.level().dimension().identifier().toString();
        } catch (RuntimeException ex) {
            return "unknown";
        }
    }

    private static String gameMode(Minecraft minecraft) {
        try {
            if (minecraft.gameMode == null) return "unknown";
            var mode = minecraft.gameMode.getPlayerMode();
            return mode == null ? "unknown" : mode.getName();
        } catch (RuntimeException ex) {
            return "unknown";
        }
    }

    private static int countFood(Player player) {
        int total = 0;
        for (int slot = 0; slot < 36; slot++) {
            var stack = player.getInventory().getItem(slot);
            if (InventoryReader.isFood(stack)) total += stack.getCount();
        }
        return total;
    }

    private static String nameOf(net.minecraft.world.item.ItemStack stack) {
        return stack == null || stack.isEmpty() ? "" : stack.getHoverName().getString();
    }
}
