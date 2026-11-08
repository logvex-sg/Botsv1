package com.logvex.hunter.gui.combat;

import com.logvex.hunter.core.config.HunterProfile;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.combat.CombatCoordinatorModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.gui.widgets.pressable.WCheckbox;
import meteordevelopment.meteorclient.systems.modules.Module;
import meteordevelopment.meteorclient.systems.modules.Modules;
import meteordevelopment.meteorclient.systems.modules.combat.AutoArmor;
import meteordevelopment.meteorclient.systems.modules.combat.AutoTotem;
import meteordevelopment.meteorclient.systems.modules.combat.AutoWeapon;
import meteordevelopment.meteorclient.systems.modules.combat.KillAura;
import meteordevelopment.meteorclient.systems.modules.player.AutoEat;
import meteordevelopment.meteorclient.utils.render.color.Color;

/** Shows and controls the integration with Meteor's combat modules. */
public class CombatScreen extends HunterScreen {
    private WTable table;

    public CombatScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Combat Coordination");
    }

    @Override
    public void initWidgets() {
        CombatCoordinatorModule module = HunterRegistry.combat();
        add(theme.label("Managed Meteor modules", true)).expandX();
        add(theme.label("The coordinator only toggles these modules around the current target; it never attacks."))
            .expandX().widget().color = Color.GRAY;
        add(theme.horizontalSeparator()).expandX();

        table = add(theme.table()).expandX().widget();

        addModuleRow("KillAura", KillAura.class, module);
        addModuleRow("AutoWeapon", AutoWeapon.class, module);
        addModuleRow("AutoTotem", AutoTotem.class, module);
        addModuleRow("AutoArmor", AutoArmor.class, module);
        addModuleRow("AutoEat", AutoEat.class, module);

        add(theme.horizontalSeparator()).expandX();

        var actions = add(theme.horizontalList()).expandX().widget();
        WButton emergency = actions.add(theme.button("Emergency combat disable")).widget();
        emergency.action = () -> {
            if (module != null) module.emergencyStop();
            rebuild();
        };
        WButton release = actions.add(theme.button("Release managed")).widget();
        release.action = () -> {
            if (module != null) module.releaseManaged();
            rebuild();
        };

        add(theme.horizontalSeparator()).expandX();

        var profileActions = add(theme.horizontalList()).expandX().widget();
        WButton apply = profileActions.add(theme.button("Apply profile settings")).widget();
        apply.action = () -> {
            if (module != null) module.applyProfile(core().config().activeProfile());
            rebuild();
        };
        WButton capture = profileActions.add(theme.button("Save to profile")).widget();
        capture.action = () -> {
            HunterProfile profile = core().config().activeProfile();
            if (module != null) module.captureProfile(profile);
            saveAll();
        };

        rebuild();
    }

    private void addModuleRow(String title, Class<? extends Module> type, CombatCoordinatorModule coordinator) {
        table.add(theme.label(title)).expandCellX();
        Module module = Modules.get().get(type);
        if (module == null) {
            table.add(theme.label("not installed")).expandCellX();
            table.row();
            return;
        }
        WCheckbox enabled = table.add(theme.checkbox(module.isActive())).widget();
        enabled.action = () -> {
            if (enabled.checked) module.enable();
            else module.disable();
        };
        WButton settings = table.add(theme.button("Settings")).widget();
        settings.action = () -> mc.setScreen(theme.moduleScreen(module));
        WLabel managed = table.add(theme.label(coordinator != null && coordinator.isManaged(type) ? "managed" : ""))
            .expandCellX().widget();
        managed.color = Color.LIGHT_GRAY;
        table.row();
    }

    private void rebuild() {
        if (table == null) return;
        // Toggle checkboxes reflect the live state; nothing to rebuild structurally.
        int row = 0;
        for (Class<? extends Module> type : java.util.List.of(KillAura.class, AutoWeapon.class, AutoTotem.class, AutoArmor.class, AutoEat.class)) {
            Module module = Modules.get().get(type);
            var cells = table.getRow(row++);
            if (module == null || cells == null || cells.size() < 2) continue;
            if (cells.get(1).widget() instanceof WCheckbox box) box.checked = module.isActive();
        }
    }
}
