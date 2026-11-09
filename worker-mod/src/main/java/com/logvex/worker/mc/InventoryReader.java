package com.logvex.worker.mc;

import com.logvex.worker.core.ItemEntry;
import com.logvex.worker.core.ItemQuery;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

/**
 * Reads inventory state into plain {@link ItemEntry} records.
 *
 * <p>Two distinct things are reported and must not be conflated:
 * <ul>
 *   <li><b>carried</b> — the 36 main inventory slots plus the offhand. This is what the client can
 *       act on immediately.</li>
 *   <li><b>accessible</b> — the slots of any container screen that is currently open (a chest, a
 *       barrel, a shulker box). Reported separately and clearly labelled, because "the host says
 *       there are 640 iron ingots" means something different when they are in a chest the client
 *       happens to have open.</li>
 * </ul>
 * Every method must be called on the client thread.
 */
public final class InventoryReader {
    /** Main inventory is 36 slots; the offhand is read separately. */
    private static final int MAIN_SLOTS = 36;

    private InventoryReader() {}

    /** Items the client is carrying: hotbar plus main inventory, plus the offhand stack. */
    public static List<ItemEntry> carried(Player player) {
        List<ItemEntry> entries = new ArrayList<>();
        if (player == null) return entries;
        Inventory inventory = player.getInventory();
        for (int slot = 0; slot < Math.min(MAIN_SLOTS, inventory.getContainerSize()); slot++) {
            add(entries, inventory.getItem(slot), slot);
        }
        ItemStack offhand = player.getItemBySlot(EquipmentSlot.OFFHAND);
        add(entries, offhand, 40);
        return entries;
    }

    /**
     * Items in an open container screen. Returns an empty list when no container is open (the
     * player's own inventory menu does not count).
     */
    public static List<ItemEntry> accessible(Player player) {
        List<ItemEntry> entries = new ArrayList<>();
        if (player == null || player.containerMenu == null) return entries;
        var menu = player.containerMenu;
        if (menu == player.inventoryMenu) return entries;
        for (int slot = 0; slot < menu.slots.size(); slot++) {
            add(entries, menu.getSlot(slot).getItem(), slot);
        }
        return entries;
    }

    /** Whether a container screen other than the player's own inventory is open. */
    public static boolean hasContainerOpen(Player player) {
        return player != null && player.containerMenu != null && player.containerMenu != player.inventoryMenu;
    }

    /** Equipped armor, in head-to-feet order, including empty slots so the count is meaningful. */
    public static List<ItemEntry> armor(Player player) {
        List<ItemEntry> entries = new ArrayList<>();
        if (player == null) return entries;
        EquipmentSlot[] slots = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};
        int[] indexes = {39, 38, 37, 36};
        for (int i = 0; i < slots.length; i++) {
            add(entries, player.getItemBySlot(slots[i]), indexes[i]);
        }
        return entries;
    }

    /** How many armor slots currently hold something. */
    public static int armorPieceCount(Player player) {
        int count = 0;
        if (player == null) return 0;
        for (ItemEntry entry : armor(player)) {
            if (entry != null) count++;
        }
        return count;
    }

    /** Free main-inventory slots (empty stacks in the 36 carried slots). */
    public static int freeSlots(Player player) {
        if (player == null) return 0;
        Inventory inventory = player.getInventory();
        int free = 0;
        for (int slot = 0; slot < Math.min(MAIN_SLOTS, inventory.getContainerSize()); slot++) {
            if (inventory.getItem(slot).isEmpty()) free++;
        }
        return free;
    }

    /** Labels of worn or held gear whose remaining durability is at or below the threshold. */
    public static List<String> damagedGear(Player player, int lowDurabilityPercent) {
        List<String> damaged = new ArrayList<>();
        if (player == null) return damaged;
        List<ItemEntry> gear = new ArrayList<>(armor(player));
        add(gear, player.getMainHandItem(), 0);
        add(gear, player.getItemBySlot(EquipmentSlot.OFFHAND), 40);
        for (ItemEntry entry : gear) {
            if (entry != null && entry.damageable && entry.durabilityPercent() <= lowDurabilityPercent) {
                damaged.add(entry.name + " (" + entry.durabilityPercent() + "%)");
            }
        }
        return damaged;
    }

    /** Count of items matching a query across a list. */
    public static int count(List<ItemEntry> entries, String query) {
        int total = 0;
        for (ItemEntry entry : entries) {
            if (entry != null && ItemQuery.matches(entry.id, entry.name, query)) total += entry.count;
        }
        return total;
    }

    private static void add(List<ItemEntry> entries, ItemStack stack, int slot) {
        if (stack == null || stack.isEmpty()) return;
        String id = itemId(stack);
        String name = stack.getHoverName().getString();
        int damage = stack.isDamageableItem() ? stack.getDamageValue() : 0;
        int maxDamage = stack.isDamageableItem() ? stack.getMaxDamage() : 0;
        entries.add(new ItemEntry(id, name, stack.getCount(), slot, damage, maxDamage, stack.isDamageableItem()));
    }

    /** The namespaced item id, e.g. {@code minecraft:diamond_sword}. */
    public static String itemId(ItemStack stack) {
        try {
            Identifier key = BuiltInRegistries.ITEM.getKey(stack.getItem());
            return key == null ? "unknown" : key.toString();
        } catch (RuntimeException ex) {
            return "unknown";
        }
    }

    /** Whether a stack carries a food component, used for the "food" equipment line. */
    public static boolean isFood(ItemStack stack) {
        return stack != null && !stack.isEmpty() && stack.has(DataComponents.FOOD);
    }
}
