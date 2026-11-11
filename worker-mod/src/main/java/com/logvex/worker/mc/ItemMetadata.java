package com.logvex.worker.mc;

import com.logvex.worker.core.ItemEntry;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;

/**
 * Reads the metadata the host needs to classify an item honestly: item tags, enchantments, data
 * components and a custom name.
 *
 * <p>Classification on the host must never assume two items are interchangeable, so a stack is
 * reported with the facts that distinguish it. Every read is defensive: a failure yields an empty
 * list rather than throwing, because a worker must never die while collecting status.
 *
 * <p>Must be called on the client thread.
 */
public final class ItemMetadata {
    private ItemMetadata() {}

    /** Fills the metadata fields of an entry from its stack. */
    public static void apply(ItemEntry entry, ItemStack stack) {
        if (entry == null || stack == null || stack.isEmpty()) return;
        entry.tags = tags(stack);
        entry.enchantments = enchantments(stack);
        entry.components = components(stack);
        entry.customName = customName(stack);
    }

    /** Fully-qualified item tags, e.g. {@code minecraft:logs}. */
    public static List<String> tags(ItemStack stack) {
        List<String> tags = new ArrayList<>();
        try {
            for (TagKey<Item> tag : stack.getTags().toList()) {
                Identifier location = tag.location();
                if (location != null) tags.add(location.toString());
            }
        } catch (RuntimeException ex) {
            return new ArrayList<>();
        }
        return tags;
    }

    /** Enchantments on the stack, by id and level. */
    public static List<ItemEntry.Enchant> enchantments(ItemStack stack) {
        List<ItemEntry.Enchant> found = new ArrayList<>();
        try {
            var enchantments = stack.getEnchantments();
            for (Holder<Enchantment> holder : enchantments.keySet()) {
                ResourceKey<Enchantment> key = holder.unwrapKey().orElse(null);
                if (key == null) continue;
                found.add(new ItemEntry.Enchant(key.identifier().toString(), enchantments.getLevel(holder)));
            }
        } catch (RuntimeException ex) {
            return new ArrayList<>();
        }
        return found;
    }

    /** The ids of the data components present on the stack, e.g. {@code minecraft:container}. */
    public static List<String> components(ItemStack stack) {
        List<String> components = new ArrayList<>();
        try {
            for (DataComponentType<?> type : stack.getComponents().keySet()) {
                Identifier id = BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(type);
                if (id != null) components.add(id.toString());
            }
        } catch (RuntimeException ex) {
            return new ArrayList<>();
        }
        return components;
    }

    /** The stack's custom name as plain text, or null when it has none. */
    public static String customName(ItemStack stack) {
        try {
            var name = stack.getCustomName();
            return name == null ? null : name.getString();
        } catch (RuntimeException ex) {
            return null;
        }
    }
}
