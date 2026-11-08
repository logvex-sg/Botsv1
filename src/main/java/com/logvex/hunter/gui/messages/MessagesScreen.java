package com.logvex.hunter.gui.messages;

import com.logvex.hunter.core.message.MessageEvent;
import com.logvex.hunter.core.message.MessageManager;
import com.logvex.hunter.core.message.MessageProfile;
import com.logvex.hunter.core.message.MessageTemplate;
import com.logvex.hunter.core.message.Placeholders;
import com.logvex.hunter.gui.HunterScreen;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WSection;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.containers.WVerticalList;
import meteordevelopment.meteorclient.gui.widgets.input.WDropdown;
import meteordevelopment.meteorclient.gui.widgets.input.WTextBox;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.gui.widgets.pressable.WCheckbox;
import meteordevelopment.meteorclient.gui.widgets.pressable.WMinus;
import meteordevelopment.meteorclient.gui.widgets.pressable.WPlus;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Editor for the configurable chat messages and their profiles. */
public class MessagesScreen extends HunterScreen {
    private WDropdown<String> profileDropdown;
    private WVerticalList eventList;

    public MessagesScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Messages");
    }

    @Override
    public void initWidgets() {
        MessageManager messages = core().messages();

        var profileRow = add(theme.horizontalList()).expandX().widget();
        profileRow.add(theme.label("Profile")).widget();
        List<String> names = messages.profileNames();
        profileDropdown = profileRow.add(theme.dropdown(names.toArray(new String[0]), messages.activeProfileName())).expandX().widget();
        profileDropdown.action = () -> {
            messages.setActiveProfile(profileDropdown.get());
            core().markDirty();
            rebuildEvents();
        };
        WTextBox newProfile = profileRow.add(theme.textBox("", "new profile")).widget();
        WButton create = profileRow.add(theme.button("Create")).widget();
        create.action = () -> {
            String name = newProfile.get().trim();
            if (name.isEmpty()) return;
            messages.createProfile(name, true);
            newProfile.set("");
            reloadAll();
        };
        WButton delete = profileRow.add(theme.button("Delete")).widget();
        delete.action = () -> {
            messages.deleteProfile(profileDropdown.get());
            reloadAll();
        };

        add(theme.horizontalSeparator()).expandX();

        var tools = add(theme.horizontalList()).expandX().widget();
        WButton previewAll = tools.add(theme.button("Preview all")).widget();
        previewAll.action = this::previewAll;
        WButton resetCooldowns = tools.add(theme.button("Reset cooldowns")).widget();
        resetCooldowns.action = () -> {
            messages.resetCooldowns();
            info("Message cooldowns reset.");
        };
        WButton save = tools.add(theme.button("Save")).widget();
        save.action = this::saveAll;

        add(theme.label("Placeholders: {player} {username} {health} {weapon} {server} {coordinates} {time}")
            ).expandX().widget().color = Color.GRAY;

        add(theme.horizontalSeparator()).expandX();

        eventList = add(theme.verticalList()).expandX().widget();
        rebuildEvents();
    }

    private void reloadAll() {
        clear();
        initWidgets();
    }

    private void rebuildEvents() {
        if (eventList == null) return;
        eventList.clear();
        MessageProfile profile = core().messages().active();

        for (MessageEvent event : MessageEvent.values()) {
            WSection section = eventList.add(theme.section(event.displayName(), false)).expandX().widget();
            section.spacing = 0;

            List<MessageTemplate> templates = new ArrayList<>(profile.templates(event));
            WTable table = section.add(theme.table()).expandX().widget();

            if (templates.isEmpty()) {
                table.add(theme.label("(no messages)")).expandCellX();
                table.row();
            }

            for (MessageTemplate template : templates) {
                WCheckbox enabled = table.add(theme.checkbox(template.enabled())).widget();
                enabled.action = () -> {
                    template.setEnabled(enabled.checked);
                    core().markDirty();
                };

                WTextBox text = table.add(theme.textBox(template.text())).expandCellX().widget();
                text.action = () -> {
                    template.setText(text.get());
                    core().markDirty();
                };
                text.actionOnUnfocused = text.action;

                table.add(theme.label("cd")).widget();
                var cooldown = table.add(theme.intEdit(template.cooldownSeconds(), 0, 600, 0, 600)).widget();
                cooldown.action = () -> {
                    template.setCooldownSeconds(cooldown.get());
                    core().markDirty();
                };

                WButton preview = table.add(theme.button("Preview")).widget();
                preview.action = () -> preview(event, template);

                WMinus remove = table.add(theme.minus()).widget();
                remove.action = () -> {
                    templates.remove(template);
                    profile.set(event, templates);
                    core().markDirty();
                    rebuildEvents();
                };
                table.row();
            }

            var addRow = section.add(theme.horizontalList()).expandX().widget();
            WTextBox newText = addRow.add(theme.textBox("", "new message")).expandX().widget();
            WPlus add = addRow.add(theme.plus()).widget();
            add.action = () -> {
                String value = newText.get().trim();
                if (value.isEmpty()) return;
                templates.add(new MessageTemplate(value));
                profile.set(event, templates);
                core().markDirty();
                rebuildEvents();
            };
        }
    }

    private void previewAll() {
        MessageManager messages = core().messages();
        Map<String, String> values = Placeholders.build("Steve", 12.5, 18);
        values.put("username", "you");
        values.put("weapon", "netherite_sword");
        values.put("server", core().serverAddress().isBlank() ? "play.example.com" : core().serverAddress());
        values.put("coordinates", "120 64 -340");
        values.put("time", com.logvex.hunter.core.util.Time.clock(System.currentTimeMillis()));
        for (MessageEvent event : MessageEvent.values()) {
            List<String> lines = messages.preview(event, values);
            for (String line : lines) {
                info("[" + event.displayName() + "] " + line);
            }
        }
    }

    private void preview(MessageEvent event, MessageTemplate template) {
        Map<String, String> values = Placeholders.build("Steve", 12.5, 18);
        values.put("username", "you");
        values.put("weapon", "netherite_sword");
        values.put("server", core().serverAddress().isBlank() ? "play.example.com" : core().serverAddress());
        values.put("coordinates", "120 64 -340");
        values.put("time", com.logvex.hunter.core.util.Time.clock(System.currentTimeMillis()));
        String text = com.logvex.hunter.core.util.Text.applyPlaceholders(template.text(), values);
        info(event.displayName() + ": " + text);
    }

    private void info(String message) {
        com.logvex.hunter.mc.HunterChat.info(message);
    }
}
