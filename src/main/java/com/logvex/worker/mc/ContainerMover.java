package com.logvex.worker.mc;

import com.logvex.worker.core.ItemEntry;
import com.logvex.worker.core.ItemQuery;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;

/**
 * Performs the only inventory interaction this mod supports: a shift-click ("quick move").
 *
 * <p>Quick-move is deliberately the whole vocabulary. It is the one action a player can take whose
 * result is unambiguous and always legal for the current screen, so the worker never has to guess at
 * slot arithmetic or invent clicks the server would reject. Withdrawing from an open chest into the
 * player's inventory and equipping a carried armor piece are both a single quick-move.
 *
 * <p>Every method must run on the client thread, and every caller must re-read state afterwards to
 * confirm the change: a quick-move that the server refuses simply does nothing.
 */
public final class ContainerMover {
    private ContainerMover() {}

    /**
     * Quick-moves every slot of the open container whose item matches, until the player's inventory
     * is full or the requested number of items has been taken.
     *
     * @return the number of items actually moved out of the container
     */
    public static int withdrawFromOpenContainer(String query, int limit) {
        return moveMatching(query, limit, true);
    }

    /**
     * Quick-moves matching slots from the player's inventory into the open container.
     *
     * @return the number of items actually moved into the container
     */
    public static int depositToOpenContainer(String query, int limit) {
        return moveMatching(query, limit, false);
    }

    /** Quick-moves every non-empty slot of the open container into the player (used to unpack). */
    public static int withdrawAllFromOpenContainer() {
        return moveMatching("", Integer.MAX_VALUE, true);
    }

    /**
     * Quick-moves matching slots across the open screen.
     *
     * @param fromContainer true to move container slots into the player; false for the reverse
     * @param query         an item query, or blank to match every non-empty slot
     */
    private static int moveMatching(String query, int limit, boolean fromContainer) {
        LocalPlayer player = player();
        if (player == null) return 0;
        AbstractContainerMenu menu = player.containerMenu;
        if (menu == null || menu == player.inventoryMenu) return 0;

        int moved = 0;
        // Snapshot the matching window slots first: moving an item mutates the menu as we go.
        List<Integer> windowSlots = new ArrayList<>();
        for (int windowSlot = 0; windowSlot < menu.slots.size(); windowSlot++) {
            var slot = menu.getSlot(windowSlot);
            boolean inPlayerInventory = slot.container instanceof net.minecraft.world.entity.player.Inventory;
            if (fromContainer == inPlayerInventory) continue;
            var stack = slot.getItem();
            if (stack.isEmpty()) continue;
            String id = InventoryReader.itemId(stack);
            String name = stack.getHoverName().getString();
            if (query.isBlank() || ItemQuery.matches(id, name, query)) windowSlots.add(windowSlot);
        }

        for (int windowSlot : windowSlots) {
            if (limit > 0 && moved >= limit) break;
            var before = menu.getSlot(windowSlot).getItem();
            if (before.isEmpty()) continue;
            int countBefore = before.getCount();
            Minecraft.getInstance().gameMode.handleInventoryMouseClick(
                menu.containerId, windowSlot, 0, ClickType.QUICK_MOVE, player);
            moved += countBefore;
        }
        return moved;
    }

    /**
     * Quick-moves carried armour into empty armour slots, one piece at a time.
     *
     * <p>Shift-clicking an armour piece in the inventory screen is the vanilla way to equip it, so
     * this needs no container to be open. Only stacks whose {@code EQUIPPABLE} component names a
     * head, chest, legs or feet slot are candidates, so tools and food are never swept up.
     *
     * @param limit the most pieces to equip this call
     * @return the number of pieces actually equipped
     */
    public static int equipCarriedArmor(int limit) {
        LocalPlayer player = player();
        if (player == null || limit <= 0) return 0;
        AbstractContainerMenu menu = player.containerMenu;
        if (menu == null) return 0;
        int equipped = 0;
        for (int windowSlot = 0; windowSlot < menu.slots.size() && equipped < limit; windowSlot++) {
            var slot = menu.getSlot(windowSlot);
            if (!(slot.container instanceof net.minecraft.world.entity.player.Inventory)) continue;
            var stack = slot.getItem();
            if (stack.isEmpty() || !isArmor(stack)) continue;
            Minecraft.getInstance().gameMode.handleInventoryMouseClick(
                menu.containerId, windowSlot, 0, ClickType.QUICK_MOVE, player);
            equipped++;
        }
        return equipped;
    }

    /** Whether a stack is a wearable armour piece (not a tool or a shield). */
    private static boolean isArmor(net.minecraft.world.item.ItemStack stack) {
        var equippable = stack.get(net.minecraft.core.component.DataComponents.EQUIPPABLE);
        if (equippable == null) return false;
        var slot = equippable.slot();
        return slot == net.minecraft.world.entity.EquipmentSlot.HEAD
            || slot == net.minecraft.world.entity.EquipmentSlot.CHEST
            || slot == net.minecraft.world.entity.EquipmentSlot.LEGS
            || slot == net.minecraft.world.entity.EquipmentSlot.FEET;
    }

    /** The carried item entries, used to build a "what changed" report. */
    public static List<ItemEntry> carriedNow() {
        LocalPlayer player = player();
        return player == null ? List.of() : InventoryReader.carried(player);
    }

    private static LocalPlayer player() {
        Minecraft minecraft = Minecraft.getInstance();
        return minecraft == null ? null : minecraft.player;
    }
}
