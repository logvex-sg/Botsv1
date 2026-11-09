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
        LocalPlayer player = player();
        if (player == null) return 0;
        AbstractContainerMenu menu = player.containerMenu;
        if (menu == null || menu == player.inventoryMenu) return 0;

        int moved = 0;
        // Snapshot the matching window slots first: moving an item mutates the menu as we go.
        List<Integer> windowSlots = new ArrayList<>();
        for (int windowSlot = 0; windowSlot < menu.slots.size(); windowSlot++) {
            var slot = menu.getSlot(windowSlot);
            var stack = slot.getItem();
            if (stack.isEmpty()) continue;
            String id = InventoryReader.itemId(stack);
            String name = stack.getHoverName().getString();
            if (ItemQuery.matches(id, name, query)) windowSlots.add(windowSlot);
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
     * Quick-moves the first carried slot matching the query. For armor and shields this equips the
     * item; for everything else it moves the stack within the inventory.
     *
     * @return true when a move was issued
     */
    public static boolean equipOrMoveCarried(String query) {
        LocalPlayer player = player();
        if (player == null) return false;
        AbstractContainerMenu menu = player.containerMenu;
        if (menu == null) return false;
        for (int windowSlot = 0; windowSlot < menu.slots.size(); windowSlot++) {
            var slot = menu.getSlot(windowSlot);
            var stack = slot.getItem();
            if (stack.isEmpty()) continue;
            // Only the player's own inventory slots are candidates; a container's slots are not.
            if (!(slot.container instanceof net.minecraft.world.entity.player.Inventory)) continue;
            String id = InventoryReader.itemId(stack);
            String name = stack.getHoverName().getString();
            if (!ItemQuery.matches(id, name, query)) continue;
            Minecraft.getInstance().gameMode.handleInventoryMouseClick(
                menu.containerId, windowSlot, 0, ClickType.QUICK_MOVE, player);
            return true;
        }
        return false;
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
