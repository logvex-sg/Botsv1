package com.logvex.hunter.gui.instances;

import com.logvex.hunter.core.instances.InstanceRecord;
import com.logvex.hunter.core.instances.InstanceStatus;
import com.logvex.hunter.core.instances.InstanceTransport;
import com.logvex.hunter.core.util.Time;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.instances.InstanceManagerModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.input.WDropdown;
import meteordevelopment.meteorclient.gui.widgets.input.WTextBox;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.gui.widgets.pressable.WCheckbox;
import meteordevelopment.meteorclient.gui.widgets.pressable.WMinus;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.orbit.EventHandler;

import java.util.Locale;

/**
 * Manages the other client instances: registration, status, per-instance emergency stop.
 *
 * <p>Instances are reached only through their own authenticated endpoint; no world state is shared
 * implicitly.
 */
public class InstancesScreen extends HunterScreen {
    private WTable table;
    private WTextBox labelBox;
    private WTextBox hostBox;
    private WTextBox portBox;
    private WTextBox tokenBox;
    private WDropdown<InstanceTransport> transportDropdown;
    private long lastSignature = -1;

    public InstancesScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Instances");
    }

    @Override
    public void initWidgets() {
        add(theme.label("Registered instances", true)).expandX();
        table = add(theme.table()).expandX().widget();

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Register a new instance", true)).expandX();

        var row1 = add(theme.horizontalList()).expandX().widget();
        labelBox = row1.add(theme.textBox("", "label")).expandX().widget();
        hostBox = row1.add(theme.textBox("127.0.0.1", "host")).expandX().widget();
        portBox = row1.add(theme.textBox("", "port")).widget();
        portBox.minWidth = 60;

        var row2 = add(theme.horizontalList()).expandX().widget();
        tokenBox = row2.add(theme.textBox("", "shared token")).expandX().widget();
        transportDropdown = row2.add(theme.dropdown(InstanceTransport.values(), InstanceTransport.READ_ONLY)).widget();

        WButton add = row2.add(theme.button("Register")).widget();
        add.action = this::register;
        enterAction = add.action;

        add(theme.label("Read only: statistics are read. HTTP: the instance accepts authenticated commands.")
            ).expandX().widget().color = Color.GRAY;

        var selfRow = add(theme.horizontalList()).expandX().widget();
        WButton selfStats = selfRow.add(theme.button("This instance's statistics")).widget();
        selfStats.action = () -> {
            InstanceManagerModule module = HunterRegistry.instances();
            if (module == null) return;
            var stats = module.selfStats();
            for (String line : stats.summaryLines()) info(line);
        };

        rebuild();
    }

    private void register() {
        InstanceManagerModule module = HunterRegistry.instances();
        if (module == null) return;
        String label = labelBox.get().trim();
        String host = hostBox.get().trim();
        int port;
        try {
            port = Integer.parseInt(portBox.get().trim());
        } catch (NumberFormatException e) {
            HunterChat.error("Port must be a number.");
            return;
        }
        if (label.isEmpty()) {
            HunterChat.error("Enter a label.");
            return;
        }
        module.addInstance(label, host, port, tokenBox.get().trim(),
            transportDropdown.get() == InstanceTransport.HTTP);
        labelBox.set("");
        portBox.set("");
        tokenBox.set("");
        rebuild();
    }

    @EventHandler
    private void onTick(meteordevelopment.meteorclient.events.world.TickEvent.Post event) {
        rebuild();
    }

    private void rebuild() {
        if (table == null) return;
        InstanceManagerModule module = HunterRegistry.instances();
        if (module == null) {
            if (lastSignature != 0) {
                lastSignature = 0;
                table.clear();
            }
            return;
        }

        var registry = core().instances();
        // The table holds live checkboxes and buttons; rebuilding it every tick would discard the
        // widget under the cursor and drop clicks. Rebuild only when the rendered rows change.
        long signature = instancesSignature(registry);
        if (signature == lastSignature) return;
        lastSignature = signature;
        table.clear();

        if (registry.size() == 0) {
            table.add(theme.label("No instances registered yet.")).expandCellX();
            table.row();
            return;
        }

        table.add(theme.label("Label")).expandCellX();
        table.add(theme.label("Endpoint")).expandCellX();
        table.add(theme.label("Status")).expandCellX();
        table.add(theme.label("Latency")).expandCellX();
        table.add(theme.label("Kills")).expandCellX();
        table.add(theme.label("Last seen")).expandCellX();
        table.add(theme.label("Enabled")).expandCellX();
        table.row();

        for (InstanceRecord record : registry.all()) {
            table.add(theme.label(record.label())).expandCellX();
            table.add(theme.label(record.endpoint())).expandCellX();

            WLabel status = table.add(theme.label(record.status().displayName())).expandCellX().widget();
            status.color = switch (record.status()) {
                case ONLINE -> Color.GREEN;
                case OFFLINE -> Color.RED;
                case DISABLED -> Color.GRAY;
                case UNKNOWN -> Color.YELLOW;
            };

            table.add(theme.label(record.lastLatencyMillis() < 0 ? "-" : record.lastLatencyMillis() + "ms")).expandCellX();
            Object kills = record.lastStats().get("kills");
            table.add(theme.label(kills == null ? "-" : kills.toString())).expandCellX();
            table.add(theme.label(record.lastSeen() == 0 ? "never" : Time.ago(record.lastSeen()))).expandCellX();

            WCheckbox enabled = table.add(theme.checkbox(record.enabled())).widget();
            enabled.action = () -> {
                record.setEnabled(enabled.checked);
                if (!enabled.checked) record.setStatus(InstanceStatus.DISABLED);
                core().markDirty();
            };

            WButton stop = table.add(theme.button("Stop")).widget();
            stop.action = () -> {
                String error = module.emergencyStop(record.id());
                if (error != null) HunterChat.error("Emergency stop failed: " + error);
                else HunterChat.warn("Emergency stop sent to " + record.label() + ".");
            };

            WMinus remove = table.add(theme.minus()).widget();
            remove.action = () -> {
                module.removeInstance(record.id());
                rebuild();
            };

            table.row();
        }
    }

    /** Cheap change detector over the columns the table renders. */
    private static long instancesSignature(com.logvex.hunter.core.instances.InstanceRegistry registry) {
        long signature = registry.size();
        for (InstanceRecord record : registry.all()) {
            signature = signature * 31 + record.id().hashCode();
            signature = signature * 31 + record.status().ordinal();
            signature = signature * 31 + (record.enabled() ? 1 : 0);
            signature = signature * 31 + record.lastLatencyMillis();
            signature = signature * 31 + record.lastSeen();
            Object kills = record.lastStats().get("kills");
            signature = signature * 31 + (kills == null ? 0 : kills.hashCode());
        }
        return signature;
    }

    private void info(String message) {
        HunterChat.info(message);
    }
}
