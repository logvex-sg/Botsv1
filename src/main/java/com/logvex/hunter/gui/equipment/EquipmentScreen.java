package com.logvex.hunter.gui.equipment;

import com.logvex.hunter.core.equipment.EquipmentAdvisor;
import com.logvex.hunter.core.equipment.EquipmentItem;
import com.logvex.hunter.core.equipment.EquipmentProfile;
import com.logvex.hunter.core.equipment.EquipmentSnapshot;
import com.logvex.hunter.core.equipment.InventoryStatus;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.equipment.EquipmentManagerModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.orbit.EventHandler;

import java.util.List;
import java.util.Locale;

/** Inventory and equipment dashboard: armour, durability, totems, food and warnings. */
public class EquipmentScreen extends HunterScreen {
    private WTable equipmentTable;
    private WTable warningsTable;
    private WLabel inventoryLabel;

    public EquipmentScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Equipment");
    }

    @Override
    public void initWidgets() {
        add(theme.label("Equipped", true)).expandX();
        equipmentTable = add(theme.table()).expandX().widget();

        inventoryLabel = add(theme.label("")).expandX().widget();
        inventoryLabel.color = Color.LIGHT_GRAY;

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Warnings", true)).expandX();
        warningsTable = add(theme.table()).expandX().widget();

        var actions = add(theme.horizontalList()).expandX().widget();
        WButton weapon = actions.add(theme.button("Recommend weapon")).widget();
        weapon.action = () -> {
            EquipmentManagerModule module = HunterRegistry.equipment();
            String recommended = module == null ? null : module.recommendedWeapon();
            if (recommended == null) info("No preferred weapon in the inventory.");
            else info("Recommended weapon: " + recommended);
        };
        WButton refresh = actions.add(theme.button("Refresh")).widget();
        refresh.action = this::rebuild;

        rebuild();
    }

    @EventHandler
    private void onTick(meteordevelopment.meteorclient.events.world.TickEvent.Post event) {
        rebuild();
    }

    private void rebuild() {
        if (equipmentTable == null) return;
        EquipmentSnapshot snapshot = HunterRuntime.get().equipment();
        InventoryStatus inventory = HunterRuntime.get().inventory();

        equipmentTable.clear();
        equipmentTable.add(theme.label("Slot")).expandCellX();
        equipmentTable.add(theme.label("Item")).expandCellX();
        equipmentTable.add(theme.label("Durability")).expandCellX();
        equipmentTable.add(theme.label("Protection")).expandCellX();
        equipmentTable.row();

        for (EquipmentItem item : snapshot.all()) {
            equipmentTable.add(theme.label(item.slot.displayName())).expandCellX();
            equipmentTable.add(theme.label(item.isEmpty() ? "-" : item.nameOrId())).expandCellX();
            String durability = item.damageable()
                ? item.remainingDurability + "/" + item.maxDurability + " (" + Math.round(item.durabilityFraction() * 100) + "%)"
                : "-";
            equipmentTable.add(theme.label(durability)).expandCellX();
            equipmentTable.add(theme.label(item.protection > 0 ? Integer.toString(item.protection) : "-")).expandCellX();
            equipmentTable.row();
        }

        inventoryLabel.set(String.format(Locale.ROOT,
            "Totems: %d    Food: %d    Free slots: %d/%d    Weapons: %s",
            inventory.totems, inventory.food, inventory.freeSlots, inventory.usedSlots + inventory.freeSlots,
            inventory.weapons.isEmpty() ? "none" : String.join(", ", inventory.weapons)));

        warningsTable.clear();
        EquipmentManagerModule module = HunterRegistry.equipment();
        List<EquipmentAdvisor.Warning> warnings = module == null ? List.of() : module.warnings();
        if (warnings.isEmpty()) {
            warningsTable.add(theme.label("No equipment warnings.")).expandCellX();
            warningsTable.row();
            return;
        }
        for (EquipmentAdvisor.Warning warning : warnings) {
            WLabel label = warningsTable.add(theme.label(warning.severity() + ": " + warning.message())).expandCellX().widget();
            label.color = switch (warning.severity()) {
                case INFO -> Color.LIGHT_GRAY;
                case WARNING -> Color.YELLOW;
                case CRITICAL -> Color.RED;
            };
            warningsTable.row();
        }
    }

    private void info(String message) {
        com.logvex.hunter.mc.HunterChat.info(message);
    }
}
