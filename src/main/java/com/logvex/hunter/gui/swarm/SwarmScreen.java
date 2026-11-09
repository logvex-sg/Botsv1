package com.logvex.hunter.gui.swarm;

import com.logvex.hunter.core.swarm.SwarmPeer;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.swarm.SwarmModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.input.WTextBox;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.orbit.EventHandler;

/**
 * The in-game swarm control panel.
 *
 * <p>Shows the mode, the live hunter roster and lets the host broadcast a command or target one
 * hunter. It is a thin view over {@link SwarmModule}: every button calls a real module method, and
 * nothing here re-implements the transport.
 */
public class SwarmScreen extends HunterScreen {
    private WLabel stateLabel;
    private WLabel modeLabel;
    private WTable rosterTable;
    private WTextBox commandBox;
    private WLabel hintLabel;
    private String lastRosterSignature = "";

    public SwarmScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Swarm");
    }

    @Override
    public void initWidgets() {
        add(theme.label("LogVex Swarm", true)).expandX().centerX();
        modeLabel = add(theme.label("")).expandX().widget();
        stateLabel = add(theme.label("")).expandX().widget();

        add(theme.horizontalSeparator()).expandX();

        var modeButtons = add(theme.horizontalList()).expandX().widget();
        WButton hostButton = modeButtons.add(theme.button("Become host")).expandX().widget();
        hostButton.action = () -> {
            SwarmModule module = module();
            if (module == null) return;
            module.setMode(SwarmModule.Mode.HOST);
            if (!module.isActive()) module.enable();
            module.start();
            rebuild();
        };
        WButton hunterButton = modeButtons.add(theme.button("Become hunter")).expandX().widget();
        hunterButton.action = () -> {
            SwarmModule module = module();
            if (module == null) return;
            module.setMode(SwarmModule.Mode.HUNTER);
            if (!module.isActive()) module.enable();
            module.start();
            rebuild();
        };
        WButton stopButton = modeButtons.add(theme.button("Stop")).expandX().widget();
        stopButton.action = () -> {
            SwarmModule module = module();
            if (module == null) return;
            module.stop();
            rebuild();
        };

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Hunters", true)).expandX();
        rosterTable = add(theme.table()).expandX().widget();

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Broadcast a command to every hunter", true)).expandX();
        var row = add(theme.horizontalList()).expandX().widget();
        commandBox = row.add(theme.textBox("", "e.g. status, target list, hud list")).expandX().widget();
        WButton send = row.add(theme.button("Broadcast")).widget();
        send.action = () -> {
            SwarmModule module = module();
            if (module == null) return;
            String result = module.broadcast(commandBox.get());
            hintLabel.set(result);
            hintLabel.color = result.startsWith("refused") ? Color.RED : Color.LIGHT_GRAY;
        };
        enterAction = send.action;

        hintLabel = add(theme.label("")).expandX().widget();
        hintLabel.color = Color.LIGHT_GRAY;
        add(theme.label("Combat-changing broadcasts need allow-combat-broadcast (module setting).")
            ).expandX().widget().color = Color.GRAY;

        rebuild();
    }

    @EventHandler
    private void onTick(meteordevelopment.meteorclient.events.world.TickEvent.Post event) {
        rebuild();
    }

    private void rebuild() {
        if (stateLabel == null) return;
        SwarmModule module = module();
        if (module == null) {
            modeLabel.set("The swarm module is not registered.");
            stateLabel.set("");
            return;
        }

        boolean host = module.mode() == SwarmModule.Mode.HOST;
        modeLabel.set("Mode: " + (host ? "Host" : "Hunter") + "    Active: " + (module.isActive() ? "yes" : "no"));

        if (host) {
            stateLabel.set(module.isHosting()
                ? "Listening on port " + module.boundPort() + " (" + module.roster().summary() + ")"
                : "Host is not running.");
            stateLabel.color = module.isHosting() ? Color.GREEN : Color.GRAY;
        } else {
            stateLabel.set("Hunter: " + module.hunterStatus());
            stateLabel.color = module.isHunterConnected() ? Color.GREEN : Color.YELLOW;
        }

        rebuildRoster(module, host);
    }

    private void rebuildRoster(SwarmModule module, boolean host) {
        if (rosterTable == null) return;
        String signature = host ? rosterSignature(module) : "hunter";
        if (signature.equals(lastRosterSignature)) return;
        lastRosterSignature = signature;
        rosterTable.clear();
        if (!host) {
            rosterTable.add(theme.label("This client is a hunter; the host drives it.")).expandCellX();
            rosterTable.row();
            return;
        }
        if (module.roster().isEmpty()) {
            rosterTable.add(theme.label("No hunters connected yet.")).expandCellX();
            rosterTable.row();
            return;
        }

        rosterTable.add(theme.label("Hunter")).expandCellX();
        rosterTable.add(theme.label("Address")).expandCellX();
        rosterTable.add(theme.label("Status")).expandCellX();
        rosterTable.add(theme.label("Latency")).expandCellX();
        rosterTable.add(theme.label("Sent")).expandCellX();
        rosterTable.add(theme.label("Replies")).expandCellX();
        rosterTable.add(theme.label("Kick")).expandCellX();
        rosterTable.row();

        for (SwarmPeer peer : module.roster().peers()) {
            rosterTable.add(theme.label(peer.label())).expandCellX();
            rosterTable.add(theme.label(peer.address())).expandCellX();
            WLabel status = rosterTable.add(theme.label(peer.status())).expandCellX().widget();
            status.color = "connected".equalsIgnoreCase(peer.status()) ? Color.GREEN : Color.LIGHT_GRAY;
            rosterTable.add(theme.label(peer.lastLatencyMillis() < 0 ? "-" : peer.lastLatencyMillis() + "ms")).expandCellX();
            rosterTable.add(theme.label(Long.toString(peer.commandsSent()))).expandCellX();
            rosterTable.add(theme.label(Long.toString(peer.resultsReceived()))).expandCellX();

            WButton kick = rosterTable.add(theme.button("Kick")).widget();
            kick.action = () -> {
                if (module.kick(peer.id())) HunterChat.warn("Disconnected " + peer.label() + ".");
                rebuild();
            };
            rosterTable.row();
        }
    }

    private SwarmModule module() {
        return HunterRegistry.swarm();
    }

    /** A cheap fingerprint of the roster so the table is only rebuilt when something changed. */
    private static String rosterSignature(SwarmModule module) {
        StringBuilder sb = new StringBuilder();
        for (SwarmPeer peer : module.roster().peers()) {
            sb.append(peer.id()).append(':').append(peer.status()).append(':')
                .append(peer.lastLatencyMillis()).append(':').append(peer.commandsSent()).append(':')
                .append(peer.resultsReceived()).append(';');
        }
        return sb.toString();
    }
}
