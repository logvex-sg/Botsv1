package com.logvex.worker.mc;

import com.logvex.worker.core.InventorySummary;
import com.logvex.worker.core.ItemEntry;
import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.StorageRequests;
import com.logvex.worker.core.TaskResult;
import java.util.ArrayList;
import java.util.List;
import meteordevelopment.meteorclient.utils.player.InvUtils;
import meteordevelopment.meteorclient.utils.world.BlockUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.ItemContainerContents;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/**
 * Executes the storage and world-maintenance task kinds on the Minecraft client.
 *
 * <p>This is the only place the worker opens a container, moves items across a container screen, or
 * breaks a block. The vocabulary is deliberately small and matches {@link ContainerMover}: a
 * container is opened with one block interaction, items move with a quick-move, and a block is
 * broken with a normal block break. Anything the server refuses simply does nothing, and the caller
 * re-reads state to confirm the change.
 *
 * <p><b>Threading.</b> Dispatch runs on the worker's task thread, not the client thread. Each step
 * that touches game state is a short {@link WorkerGameBridge#call} onto the client thread, and any
 * waiting happens back on the task thread — never on the client thread, which must stay free to
 * process the server's reply that opens a screen. A wait that times out is reported as a failure
 * rather than assumed to have worked.
 *
 * <p>The worker never fights, never aims at a player and never attacks: breaking portal blocks is
 * the only block-breaking it does, and it is limited to the nether/end portal blocks the host asked
 * about.
 */
public final class StorageExecutor {
    /** How long to wait for the server to open a screen after an interaction. */
    private static final int OPEN_TIMEOUT_MS = 1_500;
    /** How long to spend breaking one block (a portal or a placed shulker box). */
    private static final int BREAK_TIMEOUT_MS = 1_500;
    private static final int POLL_MS = 25;
    /** A shulker box holds 27 slots; used for the free-slot count in a read. */
    private static final int SHULKER_SLOTS = 27;

    private StorageExecutor() {}

    // ------------------------------------------------------------------ container-read

    /** Opens a container at a block position and reports its contents. */
    public static TaskResult containerRead(String taskId, StorageRequests.ContainerRead request) {
        if (!inWorld()) return TaskResult.failure(taskId, Protocol.TASK_CONTAINER_READ, "not in a world");

        BlockPos pos = BlockPos.containing(request.x(), request.y(), request.z());
        String opened = openContainer(pos);
        if (opened != null) return TaskResult.failure(taskId, Protocol.TASK_CONTAINER_READ, opened);

        ContainerContents contents = WorkerGameBridge.call(StorageExecutor::readOpenContainer, null);
        if (contents == null) {
            return TaskResult.failure(taskId, Protocol.TASK_CONTAINER_READ,
                "opened a screen at " + format(pos) + " but it held no readable container");
        }

        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_CONTAINER_READ,
            contents.items.size() + " stack(s) in container");
        result.with(Protocol.FIELD_QUERY, request.label());
        result.with(Protocol.FIELD_X, request.x());
        result.with(Protocol.FIELD_Y, request.y());
        result.with(Protocol.FIELD_Z, request.z());
        result.with("items", contents.items);
        result.with(Protocol.FIELD_CAPACITY, contents.capacity);
        result.with(Protocol.FIELD_FREE_SLOTS, Math.max(0, contents.capacity - contents.items.size()));
        return result;
    }

    // ------------------------------------------------------------------ container-move

    /**
     * Moves items across a container screen.
     *
     * <p>When the host named a source position the worker opens that block first; otherwise it uses
     * whatever screen is already open, so a host that opened a chest itself still works. Withdraw
     * quick-moves matching container slots into the player; deposit quick-moves matching player slots
     * into the container.
     */
    public static TaskResult containerMove(String taskId, StorageRequests.ContainerMove request) {
        if (!inWorld()) return TaskResult.failure(taskId, Protocol.TASK_CONTAINER_MOVE, "not in a world");

        if (request.hasTarget()) {
            BlockPos pos = BlockPos.containing(request.x(), request.y(), request.z());
            String opened = openContainer(pos);
            if (opened != null) return TaskResult.failure(taskId, Protocol.TASK_CONTAINER_MOVE, opened);
        } else if (!containerOpen()) {
            return TaskResult.failure(taskId, Protocol.TASK_CONTAINER_MOVE,
                "no container is open and no source position was given");
        }

        boolean withdraw = request.direction() == StorageRequests.Direction.WITHDRAW;
        int moved = WorkerGameBridge.call(() -> withdraw
            ? ContainerMover.withdrawFromOpenContainer(request.query(), request.limit())
            : ContainerMover.depositToOpenContainer(request.query(), request.limit()), 0);

        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_CONTAINER_MOVE,
            moved > 0 ? "moved " + moved + " item(s)" : "nothing matched '" + request.query() + "'");
        result.with(Protocol.FIELD_QUERY, request.query());
        result.with(Protocol.FIELD_DIRECTION, withdraw ? "withdraw" : "deposit");
        result.with(Protocol.FIELD_MOVED, moved);
        result.with(Protocol.FIELD_LIMIT, request.limit());
        return result;
    }

    // ------------------------------------------------------------------ shulker-read

    /** Reports the decoded contents of the shulker boxes the worker is carrying. */
    public static TaskResult shulkerRead(String taskId, StorageRequests.ShulkerRead request) {
        if (!inWorld()) return TaskResult.failure(taskId, Protocol.TASK_SHULKER_READ, "not in a world");

        List<ShulkerReport> shulkers = WorkerGameBridge.call(() -> scanShulkers(request.slot()), List.of());
        if (shulkers == null) return TaskResult.failure(taskId, Protocol.TASK_SHULKER_READ, "no client available");

        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_SHULKER_READ,
            shulkers.size() + " shulker(s) reported");
        result.with(Protocol.FIELD_SHULKERS, shulkers);
        result.with("count", shulkers.size());
        return result;
    }

    // ------------------------------------------------------------------ shulker-unpack

    /**
     * Empties carried shulker boxes into the worker's inventory.
     *
     * <p>Vanilla has no "unpack" click: a shulker box is emptied by placing it, which opens its
     * screen, then quick-moving every slot out, then breaking the now-empty box again. Each step is
     * an ordinary player action, so the server accepts it. The box's contents are read from its item
     * component first, so an empty box is skipped without placing it.
     */
    public static TaskResult shulkerUnpack(String taskId, StorageRequests.ShulkerUnpack request) {
        if (!inWorld()) return TaskResult.failure(taskId, Protocol.TASK_SHULKER_UNPACK, "not in a world");

        int[] slots = WorkerGameBridge.call(() -> shulkerSlots(request.slot()), new int[0]);
        if (slots == null || slots.length == 0) {
            return TaskResult.ok(taskId, Protocol.TASK_SHULKER_UNPACK, "no carried shulker box found");
        }

        int unpacked = 0;
        int emptied = 0;
        int failures = 0;
        for (int slot : slots) {
            int moved = unpackOne(slot);
            if (moved < 0) {
                failures++;
                continue;
            }
            unpacked += moved;
            emptied++;
        }

        if (failures == slots.length) {
            return TaskResult.failure(taskId, Protocol.TASK_SHULKER_UNPACK,
                "could not place a shulker box to unpack it (no room nearby?)");
        }

        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_SHULKER_UNPACK,
            "unpacked " + unpacked + " item(s) from " + (slots.length - failures) + " shulker(s)");
        result.with(Protocol.FIELD_MOVED, unpacked);
        result.with(Protocol.FIELD_EMPTY, emptied);
        result.with("shulkers", slots.length - failures);
        if (failures > 0) result.with("failed", failures);
        return result;
    }

    /**
     * Unpacks one carried shulker box by placing it, emptying it and breaking it again.
     *
     * @return the number of items moved out, or -1 when the box could not be placed
     */
    private static int unpackOne(int slot) {
        BlockPos spot = WorkerGameBridge.call(() -> placeShulker(slot), null);
        if (spot == null) return -1;

        try {
            if (!waitForScreen()) return -1;
            int moved = WorkerGameBridge.call(ContainerMover::withdrawAllFromOpenContainer, 0);
            WorkerGameBridge.run(StorageExecutor::closeScreen);
            // Break the (now empty) placed box so the box itself is recovered.
            waitForBlockBreak(spot);
            return Math.max(0, moved);
        } finally {
            WorkerGameBridge.run(InvUtils::swapBack);
        }
    }

    // ------------------------------------------------------------------ shulker-pack

    /**
     * Fills carried shulker boxes with matching loose items from the worker's inventory.
     *
     * <p>The mirror of {@code shulker-unpack}: a box is opened by placing it, the matching inventory
     * slots are quick-moved into it, then the box is broken again and recovered. Only items matching
     * the query move, so a pack never sweeps up the worker's own tools or armour. Boxes are filled
     * until the requested count is reached or no carried box has room left.
     */
    public static TaskResult shulkerPack(String taskId, StorageRequests.ShulkerPack request) {
        if (!inWorld()) return TaskResult.failure(taskId, Protocol.TASK_SHULKER_PACK, "not in a world");

        int[] slots = WorkerGameBridge.call(() -> shulkerSlots(request.slot()), new int[0]);
        if (slots == null || slots.length == 0) {
            return TaskResult.ok(taskId, Protocol.TASK_SHULKER_PACK, "no carried shulker box found");
        }

        int packed = 0;
        int filled = 0;
        int failures = 0;
        for (int slot : slots) {
            if (packed >= request.limit()) break;
            int room = WorkerGameBridge.call(() -> shulkerFreeSlots(slot), 0);
            if (room <= 0) continue;
            int moved = packOne(slot, request.query(), request.limit() - packed);
            if (moved < 0) {
                failures++;
                continue;
            }
            packed += moved;
            if (moved > 0) filled++;
        }

        if (packed == 0 && failures == slots.length) {
            return TaskResult.failure(taskId, Protocol.TASK_SHULKER_PACK,
                "could not place a shulker box to pack it (no room nearby?)");
        }

        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_SHULKER_PACK,
            packed > 0
                ? "packed " + packed + " item(s) into " + filled + " shulker(s)"
                : "nothing matched '" + request.query() + "' to pack");
        result.with(Protocol.FIELD_QUERY, request.query());
        result.with(Protocol.FIELD_MOVED, packed);
        result.with("shulkers", filled);
        result.with(Protocol.FIELD_LIMIT, request.limit());
        if (failures > 0) result.with("failed", failures);
        return result;
    }

    /**
     * Packs one carried shulker box by placing it, quick-moving matching inventory slots in and
     * breaking the box again so it is recovered.
     *
     * @return the number of items moved in, or -1 when the box could not be placed
     */
    private static int packOne(int slot, String query, int limit) {
        BlockPos spot = WorkerGameBridge.call(() -> placeShulker(slot), null);
        if (spot == null) return -1;

        try {
            if (!waitForScreen()) return -1;
            int moved = WorkerGameBridge.call(() -> ContainerMover.depositToOpenContainer(query, limit), 0);
            WorkerGameBridge.run(StorageExecutor::closeScreen);
            waitForBlockBreak(spot);
            return Math.max(0, moved);
        } finally {
            WorkerGameBridge.run(InvUtils::swapBack);
        }
    }

    // ------------------------------------------------------------------ restock

    /**
     * Tops the worker's inventory up to a minimum by withdrawing from a container.
     *
     * <p>Restock is withdraw-only by design: it never puts items into a container. The host decides
     * what "enough" is and asks for the shortfall; the worker opens the named source (or uses the
     * open screen) and takes that many matching items.
     */
    public static TaskResult restock(String taskId, StorageRequests.Restock request) {
        if (!inWorld()) return TaskResult.failure(taskId, Protocol.TASK_RESTOCK, "not in a world");

        int carried = WorkerGameBridge.call(() -> countCarried(request.query()), 0);
        if (carried >= request.limit()) {
            TaskResult result = TaskResult.ok(taskId, Protocol.TASK_RESTOCK,
                "already carrying " + carried + " (>= " + request.limit() + ")");
            result.with(Protocol.FIELD_QUERY, request.query());
            result.with(Protocol.FIELD_MOVED, 0);
            result.with(Protocol.FIELD_REMAINING, 0);
            return result;
        }

        if (request.hasSource()) {
            BlockPos pos = BlockPos.containing(request.x(), request.y(), request.z());
            String opened = openContainer(pos);
            if (opened != null) return TaskResult.failure(taskId, Protocol.TASK_RESTOCK, opened);
        } else if (!containerOpen()) {
            return TaskResult.failure(taskId, Protocol.TASK_RESTOCK,
                "no source container is open and no source position was given");
        }

        int need = request.limit() - carried;
        int moved = WorkerGameBridge.call(
            () -> ContainerMover.withdrawFromOpenContainer(request.query(), need), 0);
        int now = WorkerGameBridge.call(() -> countCarried(request.query()), carried);
        int remaining = Math.max(0, request.limit() - now);

        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_RESTOCK,
            moved > 0 ? "restocked " + moved + " item(s)" : "the source had no '" + request.query() + "'");
        result.with(Protocol.FIELD_QUERY, request.query());
        result.with(Protocol.FIELD_MOVED, moved);
        result.with("carried", now);
        result.with(Protocol.FIELD_REMAINING, remaining);
        return result;
    }

    // ------------------------------------------------------------------ portal-scan

    /** Finds portal blocks near the worker and, when asked, removes the ones it is authorised for. */
    public static TaskResult portalScan(String taskId, StorageRequests.PortalScan request) {
        if (!inWorld()) return TaskResult.failure(taskId, Protocol.TASK_PORTAL_SCAN, "not in a world");

        List<BlockPos> portals = WorkerGameBridge.call(() -> findPortals(request), List.of());
        if (portals == null) return TaskResult.failure(taskId, Protocol.TASK_PORTAL_SCAN, "no client available");

        int removed = 0;
        if (request.isRemove()) {
            for (BlockPos pos : portals) {
                if (waitForBlockBreak(pos)) removed++;
            }
        }

        TaskResult result = TaskResult.ok(taskId, Protocol.TASK_PORTAL_SCAN,
            request.isRemove()
                ? "removed " + removed + "/" + portals.size() + " portal block(s)"
                : portals.size() + " portal block(s) found");
        result.with(Protocol.FIELD_PORTALS, portals.stream().map(StorageExecutor::describe).toList());
        result.with("count", portals.size());
        result.with("removed", removed);
        result.with(Protocol.FIELD_RADIUS, request.radius());
        result.with(Protocol.FIELD_ACTION, request.isRemove() ? "remove" : "scan");
        return result;
    }

    // ------------------------------------------------------------------ interaction (task thread + short client hops)

    /**
     * Opens the container at a block position by right-clicking it.
     *
     * <p>The interaction is issued on the client thread, then this method (on the task thread) waits
     * for the server to open the screen. Waiting here rather than on the client thread is what lets
     * the client thread process the packet that opens it.
     *
     * @return null on success, or a human-readable reason it could not be opened
     */
    private static String openContainer(BlockPos pos) {
        String error = WorkerGameBridge.call(() -> beginOpen(pos), "no client available");
        if (error != null) return error;
        return waitForScreen() ? null : "the server did not open a screen at " + format(pos);
    }

    /** One client-thread interaction that starts opening a container. Returns an error, or null. */
    private static String beginOpen(BlockPos pos) {
        Minecraft minecraft = Minecraft.getInstance();
        LocalPlayer player = minecraft == null ? null : minecraft.player;
        if (player == null || minecraft.level == null || minecraft.gameMode == null) return "no client available";
        if (InventoryReader.hasContainerOpen(player)) player.closeContainer();

        BlockState state = minecraft.level.getBlockState(pos);
        if (state.isAir()) return "no block at " + format(pos);
        if (!state.hasBlockEntity() && !isLikelyContainer(state)) {
            return "the block at " + format(pos) + " is not a container";
        }
        if (!player.isWithinBlockInteractionRange(pos, 1.0)) {
            return "the container at " + format(pos) + " is out of reach";
        }

        faceBlock(player, pos);
        BlockHitResult hit = new BlockHitResult(Vec3.atCenterOf(pos), facing(pos), pos, false);
        minecraft.gameMode.useItemOn(player, InteractionHand.MAIN_HAND, hit);
        return null;
    }

    /** Places the given carried shulker box at a nearby spot, returning that spot or null. */
    private static BlockPos placeShulker(int slot) {
        LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
        if (player == null) return null;
        if (!isShulker(stackAt(slot)) || shulkerItemCount(stackAt(slot)) <= 0) return null;
        BlockPos spot = findPlaceSpot(player);
        if (spot == null) return null;
        if (!InvUtils.swap(slot, true)) return null;
        boolean placed = BlockUtils.place(spot, InvUtils.find(StorageExecutor::isShulker), 50, false);
        return placed ? spot : null;
    }

    private static void closeScreen() {
        LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
        if (player != null && InventoryReader.hasContainerOpen(player)) player.closeContainer();
    }

    /**
     * Breaks a block, driving the break to completion.
     *
     * <p>Waits on the task thread between short client-thread ticks so the client can process the
     * server's acknowledgement. Returns true once the block is gone.
     */
    private static boolean waitForBlockBreak(BlockPos pos) {
        WorkerGameBridge.run(() -> beginBreak(pos));
        long deadline = System.currentTimeMillis() + BREAK_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (WorkerGameBridge.call(() -> blockGone(pos), Boolean.TRUE)) return true;
            WorkerGameBridge.run(() -> continueBreak(pos));
            sleep(POLL_MS);
        }
        return WorkerGameBridge.call(() -> blockGone(pos), Boolean.TRUE);
    }

    private static void beginBreak(BlockPos pos) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft == null || minecraft.gameMode == null) return;
        minecraft.gameMode.startDestroyBlock(pos, Direction.UP);
    }

    private static void continueBreak(BlockPos pos) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft == null || minecraft.gameMode == null) return;
        minecraft.gameMode.continueDestroyBlock(pos, Direction.UP);
    }

    private static boolean blockGone(BlockPos pos) {
        Minecraft minecraft = Minecraft.getInstance();
        return minecraft == null || minecraft.level == null || minecraft.level.getBlockState(pos).isAir();
    }

    /** Waits on the task thread for a container screen to open. */
    private static boolean waitForScreen() {
        long deadline = System.currentTimeMillis() + OPEN_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (containerOpen()) return true;
            sleep(POLL_MS);
        }
        return containerOpen();
    }

    // ------------------------------------------------------------------ reads (client thread)

    private static boolean containerOpen() {
        return WorkerGameBridge.call(() -> {
            LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
            return InventoryReader.hasContainerOpen(player);
        }, Boolean.FALSE);
    }

    private static ContainerContents readOpenContainer() {
        LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
        if (player == null || !InventoryReader.hasContainerOpen(player)) return null;
        AbstractContainerMenu menu = player.containerMenu;
        List<ItemEntry> items = new ArrayList<>();
        int capacity = 0;
        for (int windowSlot = 0; windowSlot < menu.slots.size(); windowSlot++) {
            var slot = menu.getSlot(windowSlot);
            if (slot.container instanceof net.minecraft.world.entity.player.Inventory) continue;
            capacity++;
            ItemStack stack = slot.getItem();
            if (stack.isEmpty()) continue;
            items.add(entryFor(stack, windowSlot));
        }
        return new ContainerContents(items, capacity);
    }

    private static List<ShulkerReport> scanShulkers(int onlySlot) {
        LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
        if (player == null) return List.of();
        List<ShulkerReport> reports = new ArrayList<>();
        for (ItemEntry entry : InventoryReader.carried(player)) {
            if (onlySlot >= 0 && entry.slot != onlySlot) continue;
            ItemStack stack = stackAt(entry.slot);
            if (!isShulker(stack)) continue;
            reports.add(reportFor(entry.slot, stack));
        }
        return reports;
    }

    private static int[] shulkerSlots(int onlySlot) {
        LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
        if (player == null) return new int[0];
        List<Integer> slots = new ArrayList<>();
        for (ItemEntry entry : InventoryReader.carried(player)) {
            if (onlySlot >= 0 && entry.slot != onlySlot) continue;
            ItemStack stack = stackAt(entry.slot);
            if (isShulker(stack) && shulkerItemCount(stack) > 0) slots.add(entry.slot);
        }
        int[] out = new int[slots.size()];
        for (int i = 0; i < out.length; i++) out[i] = slots.get(i);
        return out;
    }

    private static List<BlockPos> findPortals(StorageRequests.PortalScan request) {
        Minecraft minecraft = Minecraft.getInstance();
        LocalPlayer player = minecraft == null ? null : minecraft.player;
        if (player == null || minecraft.level == null) return List.of();
        BlockPos center = request.hasTarget()
            ? BlockPos.containing(request.x(), request.y(), request.z())
            : player.blockPosition();
        int radius = request.radius();
        List<BlockPos> portals = new ArrayList<>();
        for (BlockPos pos : BlockPos.withinManhattan(center, radius, radius, radius)) {
            BlockState state = minecraft.level.getBlockState(pos);
            if (state.is(Blocks.NETHER_PORTAL) || state.is(Blocks.END_PORTAL) || state.is(Blocks.END_GATEWAY)) {
                portals.add(pos.immutable());
            }
        }
        return portals;
    }

    private static int countCarried(String query) {
        LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
        if (player == null) return 0;
        return InventorySummary.countMatching(InventoryReader.carried(player), query);
    }

    // ------------------------------------------------------------------ item helpers

    private static ItemEntry entryFor(ItemStack stack, int slot) {
        String id = InventoryReader.itemId(stack);
        String name = stack.getHoverName().getString();
        boolean damageable = stack.isDamageableItem();
        int damage = damageable ? stack.getDamageValue() : 0;
        int maxDamage = damageable ? stack.getMaxDamage() : 0;
        ItemEntry entry = new ItemEntry(id, name, stack.getCount(), slot, damage, maxDamage, damageable);
        ItemMetadata.apply(entry, stack);
        return entry;
    }

    private static ItemStack stackAt(int slot) {
        LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
        if (player == null) return ItemStack.EMPTY;
        var inventory = player.getInventory();
        if (slot >= 0 && slot < inventory.getContainerSize()) return inventory.getItem(slot);
        if (slot == 40) return player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.OFFHAND);
        return ItemStack.EMPTY;
    }

    private static boolean isShulker(ItemStack stack) {
        return stack != null && !stack.isEmpty()
            && stack.getItem() instanceof net.minecraft.world.item.BlockItem blockItem
            && blockItem.getBlock() instanceof net.minecraft.world.level.block.ShulkerBoxBlock
            && stack.has(DataComponents.CONTAINER);
    }

    private static int shulkerItemCount(ItemStack stack) {
        int total = 0;
        for (ItemStack inside : shulkerContents(stack)) total += inside.getCount();
        return total;
    }

    /** How many of a shulker box's 27 slots are still free, on the client thread. */
    private static int shulkerFreeSlots(int slot) {
        ItemStack stack = stackAt(slot);
        if (!isShulker(stack)) return 0;
        return Math.max(0, SHULKER_SLOTS - shulkerContents(stack).size());
    }

    private static List<ItemStack> shulkerContents(ItemStack stack) {
        List<ItemStack> contents = new ArrayList<>();
        if (stack == null || stack.isEmpty()) return contents;
        ItemContainerContents component = stack.get(DataComponents.CONTAINER);
        if (component == null) return contents;
        for (ItemStack inside : component.nonEmptyItems()) contents.add(inside);
        return contents;
    }

    private static ShulkerReport reportFor(int slot, ItemStack stack) {
        List<ItemEntry> items = new ArrayList<>();
        int index = 0;
        for (ItemStack inside : shulkerContents(stack)) items.add(entryFor(inside, index++));
        return new ShulkerReport(slot, stack.getHoverName().getString(), items,
            items.size(), Math.max(0, SHULKER_SLOTS - items.size()));
    }

    // ------------------------------------------------------------------ placement helpers

    /** A nearby position where a shulker box can be placed: replaceable with support below. */
    private static BlockPos findPlaceSpot(LocalPlayer player) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft == null || minecraft.level == null) return null;
        BlockPos origin = player.blockPosition();
        int[] offsets = {0, 1, -1, 2, -2};
        for (int dy : offsets) {
            for (int dx : offsets) {
                for (int dz : offsets) {
                    BlockPos candidate = origin.offset(dx, dy, dz);
                    if (!minecraft.level.getBlockState(candidate).canBeReplaced()) continue;
                    if (minecraft.level.getBlockState(candidate.below()).isAir()) continue;
                    return candidate;
                }
            }
        }
        return null;
    }

    private static boolean isLikelyContainer(BlockState state) {
        var block = state.getBlock();
        return block instanceof net.minecraft.world.level.block.ChestBlock
            || block instanceof net.minecraft.world.level.block.BarrelBlock
            || block instanceof net.minecraft.world.level.block.ShulkerBoxBlock
            || block instanceof net.minecraft.world.level.block.HopperBlock
            || block instanceof net.minecraft.world.level.block.DispenserBlock
            || block instanceof net.minecraft.world.level.block.DropperBlock
            || block instanceof net.minecraft.world.level.block.EnderChestBlock
            || block instanceof net.minecraft.world.level.block.AbstractFurnaceBlock
            || block instanceof net.minecraft.world.level.block.BrewingStandBlock
            || block instanceof net.minecraft.world.level.block.CrafterBlock;
    }

    /** Turns the player toward a block so the interaction packet carries a sane rotation. */
    private static void faceBlock(LocalPlayer player, BlockPos pos) {
        double dx = pos.getX() + 0.5 - player.getX();
        double dy = pos.getY() + 0.5 - (player.getY() + player.getEyeHeight());
        double dz = pos.getZ() + 0.5 - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        player.setYRot((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0));
        player.setXRot((float) (-Math.toDegrees(Math.atan2(dy, horizontal))));
    }

    /** The side of a block to click: the side facing the player, so the click lands on its face. */
    private static Direction facing(BlockPos pos) {
        LocalPlayer player = Minecraft.getInstance() == null ? null : Minecraft.getInstance().player;
        if (player == null) return Direction.UP;
        Vec3 diff = player.getEyePosition().subtract(Vec3.atCenterOf(pos));
        return Direction.getNearest((int) Math.round(diff.x), (int) Math.round(diff.y), (int) Math.round(diff.z), Direction.UP);
    }

    // ------------------------------------------------------------------ small helpers

    private static boolean inWorld() {
        Minecraft minecraft = Minecraft.getInstance();
        return minecraft != null && minecraft.level != null && minecraft.player != null;
    }

    private static String describe(BlockPos pos) {
        return pos.getX() + " " + pos.getY() + " " + pos.getZ();
    }

    private static String format(BlockPos pos) {
        return pos.getX() + " " + pos.getY() + " " + pos.getZ();
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    /** An open container's contents, read on the client thread. */
    private record ContainerContents(List<ItemEntry> items, int capacity) {}

    /** A shulker box as reported by {@code shulker-read}, matching the host's {@code ShulkerRecord}. */
    public static final class ShulkerReport {
        public final int slot;
        public final String label;
        public final List<ItemEntry> items;
        public final int usedSlots;
        public final int freeSlots;

        public ShulkerReport(int slot, String label, List<ItemEntry> items, int usedSlots, int freeSlots) {
            this.slot = slot;
            this.label = label == null ? "" : label;
            this.items = items;
            this.usedSlots = usedSlots;
            this.freeSlots = freeSlots;
        }
    }
}
