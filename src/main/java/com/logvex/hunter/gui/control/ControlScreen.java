package com.logvex.hunter.gui.control;

import com.logvex.hunter.core.control.HudView;
import com.logvex.hunter.core.control.ModuleView;
import com.logvex.hunter.core.control.ProfileView;
import com.logvex.hunter.core.control.SettingView;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.companion.MinecraftControlTarget;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.input.WDropdown;
import meteordevelopment.meteorclient.gui.widgets.input.WTextBox;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.gui.widgets.pressable.WCheckbox;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.List;
import java.util.Locale;

/**
 * The Control screen: edit any module's settings and switch profiles without leaving the game.
 *
 * <p>It reads through the same {@link MinecraftControlTarget} the companion HTTP surface uses, so a
 * change made here and a change made from the Fleet Manager are the same operation. Settings are
 * rendered per type: booleans as checkboxes, enums as dropdowns, numbers and strings as text boxes
 * that apply on enter.
 */
public class ControlScreen extends HunterScreen {
    private WDropdown<String> moduleDropdown;
    private WTable settingsTable;
    private WLabel headerLabel;

    private String selectedModule = "player-tracker";

    public ControlScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Control");
    }

    private MinecraftControlTarget control() {
        return new MinecraftControlTarget();
    }

    @Override
    public void initWidgets() {
        add(theme.label("Control centre", true)).expandX();

        var pickRow = add(theme.horizontalList()).expandX().widget();
        pickRow.add(theme.label("Module")).widget();
        List<String> names = moduleNames();
        moduleDropdown = pickRow.add(theme.dropdown(names.toArray(new String[0]), selectedModule)).expandX().widget();
        moduleDropdown.action = () -> {
            selectedModule = moduleDropdown.get();
            rebuildSettings();
        };
        WButton toggle = pickRow.add(theme.button("Toggle")).widget();
        toggle.action = () -> {
            control().setModule(selectedModule, null);
            rebuildSettings();
        };

        headerLabel = add(theme.label("")).expandX().widget();
        headerLabel.color = Color.LIGHT_GRAY;

        add(theme.horizontalSeparator()).expandX();
        settingsTable = add(theme.table()).expandX().widget();
        rebuildSettings();

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Profiles", true)).expandX();
        buildProfiles();

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("HUD elements", true)).expandX();
        buildHud();
    }

    private List<String> moduleNames() {
        List<ModuleView> modules = control().modules(null);
        List<String> names = new java.util.ArrayList<>();
        for (ModuleView module : modules) names.add(module.name());
        if (names.isEmpty()) names.add("player-tracker");
        return names;
    }

    private void rebuildSettings() {
        if (settingsTable == null) return;
        settingsTable.clear();

        ModuleView module = findModule(selectedModule);
        if (module == null) {
            headerLabel.set("Unknown module: " + selectedModule);
            return;
        }
        headerLabel.set(module.name() + "  [" + (module.enabled() ? "on" : "off") + "]  " + module.title());

        for (SettingView setting : module.settings()) {
            settingsTable.add(theme.label(setting.name())).expandCellX();
            addSettingWidget(setting);
            settingsTable.add(theme.label(setting.type())).expandCellX();
            settingsTable.row();
        }
        if (module.settings().isEmpty()) {
            settingsTable.add(theme.label("This module has no settings.")).expandCellX();
            settingsTable.row();
        }
    }

    private void addSettingWidget(SettingView setting) {
        String type = setting.type();
        if (type.equals("boolean")) {
            WCheckbox box = settingsTable.add(theme.checkbox(Boolean.parseBoolean(setting.value()))).widget();
            box.action = () -> {
                control().setSetting(selectedModule, setting.name(), Boolean.toString(box.checked));
                rebuildSettings();
            };
            return;
        }
        if (type.equals("enum") && !setting.suggestions().isEmpty()) {
            WDropdown<String> dropdown = settingsTable.add(
                theme.dropdown(setting.suggestions().toArray(new String[0]), setting.value())).expandCellX().widget();
            dropdown.action = () -> {
                control().setSetting(selectedModule, setting.name(), dropdown.get());
                rebuildSettings();
            };
            return;
        }
        WTextBox box = settingsTable.add(theme.textBox(setting.value())).expandCellX().widget();
        box.action = () -> {
            control().setSetting(selectedModule, setting.name(), box.get());
            rebuildSettings();
        };
    }

    private void buildProfiles() {
        var table = add(theme.table()).expandX().widget();
        for (ProfileView profile : control().profiles()) {
            table.add(theme.label((profile.active() ? "* " : "  ") + profile.name())).expandCellX();
            table.add(theme.label(String.format(Locale.ROOT, "range %.0f", profile.range()))).expandCellX();
            table.add(theme.label(profile.sortMode())).expandCellX();
            WButton use = table.add(theme.button("Use")).widget();
            use.action = () -> {
                control().profile(com.logvex.hunter.core.control.ControlAction.Profile.Kind.USE, profile.name());
                rebuildAll();
            };
            table.row();
        }
        var actions = add(theme.horizontalList()).expandX().widget();
        WTextBox newProfile = actions.add(theme.textBox("", "new profile name")).expandX().widget();
        WButton create = actions.add(theme.button("Create")).widget();
        create.action = () -> {
            String name = newProfile.get().trim();
            if (!name.isEmpty()) {
                control().profile(com.logvex.hunter.core.control.ControlAction.Profile.Kind.CREATE, name);
                rebuildAll();
            }
        };
        WButton save = actions.add(theme.button("Save current")).widget();
        save.action = () -> {
            control().profile(com.logvex.hunter.core.control.ControlAction.Profile.Kind.SAVE, null);
            rebuildAll();
        };
    }

    private void buildHud() {
        var table = add(theme.table()).expandX().widget();
        for (HudView hud : control().hudViews()) {
            table.add(theme.label(hud.name())).expandCellX();
            WCheckbox box = table.add(theme.checkbox(hud.active())).widget();
            box.action = () -> {
                control().hud(hud.name(), false);
                rebuildAll();
            };
            table.row();
        }
    }

    private ModuleView findModule(String name) {
        for (ModuleView module : control().modules(name)) {
            if (module.name().equalsIgnoreCase(name)) return module;
        }
        return null;
    }

    private void rebuildAll() {
        clear();
        initWidgets();
    }
}
