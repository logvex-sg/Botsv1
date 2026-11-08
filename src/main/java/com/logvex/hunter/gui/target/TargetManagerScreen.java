package com.logvex.hunter.gui.target;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.util.Time;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.target.PlayerTrackerModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.input.WDropdown;
import meteordevelopment.meteorclient.gui.widgets.input.WTextBox;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.gui.widgets.pressable.WMinus;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.List;
import java.util.Locale;

/**
 * The Target Manager: the independent lists (Priority Targets, Bot Accounts, Known Opponents,
 * Ignore List, Friends, Temporary Targets) with search, filtering and editing.
 */
public class TargetManagerScreen extends HunterScreen {
    private final net.minecraft.client.gui.screens.Screen parent;

    private WDropdown<TargetCategory> categoryDropdown;
    private WTextBox searchBox;
    private WTextBox nameBox;
    private WTable table;
    private WLabel summaryLabel;

    private TargetCategory selected = TargetCategory.PRIORITY;
    private String query = "";

    public TargetManagerScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Target Manager");
        this.parent = parent;
    }

    @Override
    public void initWidgets() {
        // Add row
        var addRow = add(theme.horizontalList()).expandX().widget();
        categoryDropdown = addRow.add(theme.dropdown(TargetCategory.values(), selected)).widget();
        categoryDropdown.action = () -> {
            selected = categoryDropdown.get();
            rebuild();
        };
        nameBox = addRow.add(theme.textBox("", "player name")).expandX().widget();
        WButton addButton = addRow.add(theme.button("Add")).widget();
        addButton.action = this::addEntry;
        enterAction = addButton.action;

        // Search row
        var searchRow = add(theme.horizontalList()).expandX().widget();
        searchBox = searchRow.add(theme.textBox("", "search all lists")).expandX().widget();
        searchBox.action = () -> {
            query = searchBox.get().trim();
            rebuild();
        };
        WButton clear = searchRow.add(theme.button("Clear")).widget();
        clear.action = () -> {
            searchBox.set("");
            query = "";
            rebuild();
        };
        WButton exportCsv = searchRow.add(theme.button("Export CSV")).widget();
        exportCsv.action = this::exportCsv;

        summaryLabel = add(theme.label("")).expandX().widget();
        summaryLabel.color = Color.LIGHT_GRAY;

        add(theme.horizontalSeparator()).expandX();

        table = add(theme.table()).expandX().widget();
        rebuild();
    }

    private void addEntry() {
        String name = nameBox.get().trim();
        if (name.isEmpty()) {
            HunterChat.warn("Enter a player name first.");
            return;
        }
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) {
            tracker.addTarget(name, selected);
        } else {
            HunterCore core = core();
            TargetEntry entry = core.targets().byName(name);
            if (entry == null) {
                entry = new TargetEntry(selected, name);
                core.targets().add(entry);
            } else {
                entry.setCategory(selected);
            }
            core.markDirty();
        }
        nameBox.set("");
        rebuild();
    }

    private void rebuild() {
        if (table == null) return;
        HunterCore core = core();
        table.clear();

        List<TargetEntry> entries = query.isEmpty()
            ? core.targets().byCategory(selected)
            : core.targets().search(query);

        summaryLabel.set(String.format(Locale.ROOT,
            "Showing %d entries    total lists: %d    protected: %d    ignored: %d",
            entries.size(), core.targets().size(), core.targets().countProtected(),
            core.targets().byCategory(TargetCategory.IGNORE).size()));

        if (entries.isEmpty()) {
            table.add(theme.label(query.isEmpty() ? "No entries in this list." : "No matches.")).expandCellX();
            table.row();
            return;
        }

        for (TargetEntry entry : entries) {
            addEntryRow(entry);
            table.row();
        }
    }

    private void addEntryRow(TargetEntry entry) {
        HunterCore core = core();
        table.add(theme.label(entry.effectiveName())).expandCellX();

        WDropdown<TargetCategory> category = table.add(theme.dropdown(TargetCategory.values(), entry.category())).widget();
        category.action = () -> {
            entry.setCategory(category.get());
            core.markDirty();
            rebuild();
        };

        table.add(theme.label(entry.encounterCount() + " enc")).expandCellX();
        table.add(theme.label(entry.killCount() + "K/" + entry.deathCount() + "D")).expandCellX();
        table.add(theme.label(entry.lastSeen() == 0 ? "never" : Time.ago(entry.lastSeen()))).expandCellX();
        table.add(theme.label(entry.isProtected() ? "protected" : "")).expandCellX();

        var priorityRow = table.add(theme.horizontalList()).expandCellX().widget();
        priorityRow.add(theme.label("prio"));
        var priority = priorityRow.add(theme.intEdit(entry.priority(), 0, 100, 0, 100)).widget();
        priority.action = () -> {
            entry.setPriority(priority.get());
            core.markDirty();
        };

        WButton locate = table.add(theme.button("Locate")).widget();
        locate.action = () -> locate(entry);

        WButton focus = table.add(theme.button("Focus")).widget();
        focus.action = () -> focus(entry);

        WMinus remove = table.add(theme.minus()).widget();
        remove.action = () -> {
            core.targets().remove(entry.identityKey());
            core.markDirty();
            rebuild();
        };
    }

    private void locate(TargetEntry entry) {
        var pos = entry.lastKnownPosition();
        if (pos == null) {
            HunterChat.warn("No known position for " + entry.effectiveName() + ".");
            return;
        }
        HunterChat.info(String.format(Locale.ROOT, "%s last seen at %.0f %.0f %.0f in %s (%s)",
            entry.effectiveName(), pos.x, pos.y, pos.z,
            entry.lastDimension().isBlank() ? "unknown" : entry.lastDimension(), Time.ago(entry.lastSeen())));
    }

    private void focus(TargetEntry entry) {
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker == null) return;
        if (!tracker.selectByName(entry.effectiveName())) {
            HunterChat.warn(entry.effectiveName() + " is not currently visible.");
            return;
        }
        HunterChat.info("Focused " + entry.effectiveName() + ".");
    }

    private void exportCsv() {
        HunterCore core = core();
        List<TargetEntry> entries = query.isEmpty() ? core.targets().all() : core.targets().search(query);
        try {
            var path = core.paths().root().resolve("targets-export.csv");
            com.logvex.hunter.core.store.AtomicFiles.ensureDirectory(core.paths().root());
            com.logvex.hunter.core.store.AtomicFiles.write(path, com.logvex.hunter.core.target.TargetStore.toCsv(entries));
            HunterChat.info("Exported " + entries.size() + " targets to " + path);
        } catch (java.io.IOException e) {
            HunterChat.error("Export failed: " + e.getMessage());
        }
    }
}
