package com.logvex.hunter.gui.profiles;

import com.logvex.hunter.core.config.HunterConfig;
import com.logvex.hunter.core.config.HunterProfile;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.combat.CombatCoordinatorModule;
import com.logvex.hunter.modules.target.PlayerTrackerModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.input.WTextBox;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.gui.widgets.pressable.WMinus;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.Map;

/** Configuration profiles: create, activate, copy the current settings and delete. */
public class ProfilesScreen extends HunterScreen {
    private WTable table;
    private WLabel activeLabel;
    private WTextBox nameBox;

    public ProfilesScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Profiles");
    }

    @Override
    public void initWidgets() {
        activeLabel = add(theme.label("")).expandX().widget();
        activeLabel.color = Color.LIGHT_GRAY;
        add(theme.horizontalSeparator()).expandX();
        table = add(theme.table()).expandX().widget();

        add(theme.horizontalSeparator()).expandX();
        var row = add(theme.horizontalList()).expandX().widget();
        nameBox = row.add(theme.textBox("", "new profile name")).expandX().widget();
        WButton create = row.add(theme.button("Create from current")).widget();
        create.action = () -> {
            String name = nameBox.get().trim();
            if (name.isEmpty()) return;
            HunterConfig config = core().config();
            HunterProfile profile = config.createProfile(name, true);
            if (profile != null) {
                captureInto(profile);
                config.setActiveProfile(name);
                core().markDirty();
                nameBox.set("");
                rebuild();
            }
        };
        enterAction = create.action;

        rebuild();
    }

    private void captureInto(HunterProfile profile) {
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) tracker.captureProfile(profile);
        CombatCoordinatorModule combat = HunterRegistry.combat();
        if (combat != null) combat.captureProfile(profile);
    }

    private void apply(HunterProfile profile) {
        HunterConfig config = core().config();
        config.setActiveProfile(profile.name());
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) tracker.applyProfile(profile);
        CombatCoordinatorModule combat = HunterRegistry.combat();
        if (combat != null) combat.applyProfile(profile);
        core().markDirty();
        saveAll();
        rebuild();
    }

    private void rebuild() {
        if (table == null) return;
        HunterConfig config = core().config();
        table.clear();
        activeLabel.set("Active profile: " + config.activeProfileName());

        table.add(theme.label("Profile")).expandCellX();
        table.add(theme.label("Range")).expandCellX();
        table.add(theme.label("Sort")).expandCellX();
        table.add(theme.label("Auto-select")).expandCellX();
        table.add(theme.label("Protect friends")).expandCellX();
        table.row();

        for (Map.Entry<String, HunterProfile> entry : config.profiles().entrySet()) {
            HunterProfile profile = entry.getValue();
            table.add(theme.label(profile.name() + (profile.name().equals(config.activeProfileName()) ? " *" : ""))).expandCellX();
            table.add(theme.label(String.format(java.util.Locale.ROOT, "%.0f", profile.range()))).expandCellX();
            table.add(theme.label(profile.sortMode().displayName())).expandCellX();
            table.add(theme.label(Boolean.toString(profile.autoSelect()))).expandCellX();
            table.add(theme.label(Boolean.toString(profile.protectFriends()))).expandCellX();

            WButton activate = table.add(theme.button("Activate")).widget();
            activate.action = () -> apply(profile);
            WButton save = table.add(theme.button("Save current")).widget();
            save.action = () -> {
                captureInto(profile);
                saveAll();
                rebuild();
            };
            WButton copy = table.add(theme.button("Duplicate")).widget();
            copy.action = () -> {
                String newName = profile.name() + "-copy";
                int i = 2;
                while (config.profiles().containsKey(newName)) newName = profile.name() + "-copy" + (i++);
                config.profiles().put(newName, profile.copy(newName));
                core().markDirty();
                rebuild();
            };
            WMinus remove = table.add(theme.minus()).widget();
            remove.action = () -> {
                if (config.deleteProfile(profile.name())) {
                    core().markDirty();
                    rebuild();
                }
            };
            table.row();
        }
    }
}
