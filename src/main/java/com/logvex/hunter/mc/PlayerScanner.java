package com.logvex.hunter.mc;

import com.logvex.hunter.core.equipment.EquipmentItem;
import com.logvex.hunter.core.equipment.EquipmentSlot;
import com.logvex.hunter.core.equipment.EquipmentSnapshot;
import com.logvex.hunter.core.equipment.InventoryStatus;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.Vec3;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.tags.ItemTags;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemAttributeModifiers;

import java.util.ArrayList;
import java.util.List;

/** Converts live game entities and item stacks into the core's Minecraft-free value objects. */
public final class PlayerScanner {
    private PlayerScanner() {}

    public static PlayerSnapshot snapshot(Player player, String dimension, long now) {
        Vec3 position = new Vec3(player.getX(), player.getY(), player.getZ());
        ItemStack main = player.getMainHandItem();
        ItemStack off = player.getOffhandItem();
        return new PlayerSnapshot(
            player.getUUID(),
            player.getScoreboardName(),
            position,
            player.getHealth(),
            player.getMaxHealth(),
            player.getArmorValue(),
            isWeapon(main),
            off.is(Items.TOTEM_OF_UNDYING),
            player.isInvisible(),
            player.isCreative(),
            player.isSpectator(),
            dimension,
            now);
    }

    public static EquipmentSnapshot equipment(Player player, long now) {
        EquipmentSnapshot snapshot = new EquipmentSnapshot(now);
        if (player == null) return snapshot;
        snapshot.set(item(player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.HEAD), EquipmentSlot.HELMET));
        snapshot.set(item(player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.CHEST), EquipmentSlot.CHESTPLATE));
        snapshot.set(item(player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.LEGS), EquipmentSlot.LEGGINGS));
        snapshot.set(item(player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.FEET), EquipmentSlot.BOOTS));
        snapshot.set(item(player.getMainHandItem(), EquipmentSlot.MAIN_HAND));
        snapshot.set(item(player.getOffhandItem(), EquipmentSlot.OFF_HAND));
        return snapshot;
    }

    public static InventoryStatus inventory(Player player) {
        if (player == null) return InventoryStatus.empty();
        Inventory inv = player.getInventory();
        int totems = 0;
        int food = 0;
        int used = 0;
        int size = inv.getContainerSize();
        List<String> weapons = new ArrayList<>();
        for (int i = 0; i < size; i++) {
            ItemStack stack = inv.getItem(i);
            if (stack.isEmpty()) continue;
            used++;
            if (stack.is(Items.TOTEM_OF_UNDYING)) totems += stack.getCount();
            if (stack.has(DataComponents.FOOD)) food += stack.getCount();
            if (isWeapon(stack)) weapons.add(itemId(stack));
        }
        // The offhand totem is part of the inventory the user cares about even though it is not
        // part of the container list.
        ItemStack off = player.getOffhandItem();
        if (off.is(Items.TOTEM_OF_UNDYING)) totems += off.getCount();
        return new InventoryStatus(totems, food, Math.max(0, size - used), used, weapons);
    }

    public static EquipmentItem item(ItemStack stack, EquipmentSlot slot) {
        if (stack == null || stack.isEmpty()) return EquipmentItem.empty(slot);
        boolean totem = stack.is(Items.TOTEM_OF_UNDYING);
        boolean food = stack.has(DataComponents.FOOD);
        int max = stack.isDamageableItem() ? stack.getMaxDamage() : 0;
        int remaining = stack.isDamageableItem() ? Math.max(0, max - stack.getDamageValue()) : -1;
        return new EquipmentItem(slot, itemId(stack), stack.getHoverName().getString(), stack.getCount(),
            remaining, max, protection(stack), food, totem);
    }

    /** Armor points contributed by the stack's own armour attribute modifiers. */
    private static int protection(ItemStack stack) {
        ItemAttributeModifiers modifiers = stack.getOrDefault(DataComponents.ATTRIBUTE_MODIFIERS, ItemAttributeModifiers.EMPTY);
        int total = 0;
        for (ItemAttributeModifiers.Entry entry : modifiers.modifiers()) {
            if (entry.attribute().value() == net.minecraft.world.entity.ai.attributes.Attributes.ARMOR.value()) {
                total += (int) Math.round(entry.modifier().amount());
            }
        }
        return total;
    }

    public static boolean isWeapon(ItemStack stack) {
        if (stack == null || stack.isEmpty()) return false;
        return stack.is(ItemTags.SWORDS) || stack.is(ItemTags.AXES)
            || stack.is(Items.TRIDENT) || stack.is(Items.MACE)
            || stack.is(Items.BOW) || stack.is(Items.CROSSBOW);
    }

    public static String itemId(ItemStack stack) {
        return BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
    }

    /** The local player's held weapon id, or an empty string when none. */
    public static String weaponName(Player player) {
        if (player == null) return "";
        ItemStack main = player.getMainHandItem();
        if (!main.isEmpty()) return itemId(main);
        ItemStack off = player.getOffhandItem();
        return off.isEmpty() ? "" : itemId(off);
    }

    /** Convenience for other modules: whether an entity is a tracked player and not the local one. */
    public static boolean isOtherPlayer(LivingEntity entity, Player self) {
        return entity instanceof Player player && player != self;
    }
}
