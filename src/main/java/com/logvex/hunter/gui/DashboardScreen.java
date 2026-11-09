package com.logvex.hunter.gui;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.core.util.Time;
import com.logvex.hunter.gui.combat.CombatScreen;
import com.logvex.hunter.gui.equipment.EquipmentScreen;
import com.logvex.hunter.gui.instances.InstancesScreen;
import com.logvex.hunter.gui.messages.MessagesScreen;
import com.logvex.hunter.gui.profiles.ProfilesScreen;
import com.logvex.hunter.gui.stasis.StasisScreen;
import com.logvex.hunter.gui.stats.StatisticsScreen;
import com.logvex.hunter.gui.target.TargetManagerScreen;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import com.logvex.hunter.modules.HunterRegistry;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.tabs.TabScreen;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.input.WDropdown;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.gui.widgets.pressable.WCheckbox;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.orbit.EventHandler;

import java.util.List;
import java.util.Locale;

/** The Hunter Dashboard: live status, controls, module toggles and the entry point to every screen. */
public class DashboardScreen extends TabScreen {
    private static final net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();

    private WLabel statusLabel;
    private WLabel targetLabel;
    private WLabel sessionLabel;
    private WLabel countersLabel;
    private WButton startButton;
    private WButton stopButton;
    private WTable eventsTable;
    private WTable modulesTable;
    private long lastEventsRevision = -1;

    public DashboardScreen(GuiTheme theme, meteordevelopment.meteorclient.gui.tabs.Tab tab) {
        super(theme, tab == null ? new com.logvex.hunter.gui.HunterTab() : tab);
    }

    @Override
    public void initWidgets() {
        add(theme.label("Logvex Hunter Dashboard", true)).expandX().centerX();
        add(theme.horizontalSeparator()).expandX();

        // Status
        var status = add(theme.section("Status", true)).expandX().widget();
        statusLabel = status.add(theme.label("")).expandX().widget();
        statusLabel.color = Color.WHITE;
        targetLabel = status.add(theme.label("")).expandX().widget();
        targetLabel.color = Color.RED;
        sessionLabel = status.add(theme.label("")).expandX().widget();
        sessionLabel.color = Color.LIGHT_GRAY;
        countersLabel = status.add(theme.label("")).expandX().widget();
        countersLabel.color = Color.LIGHT_GRAY;

        // Controls
        var controls = add(theme.section("Controls", true)).expandX().widget();
        var buttons = controls.add(theme.horizontalList()).expandX().widget();
        startButton = buttons.add(theme.button("Start")).widget();
        startButton.action = this::start;
        stopButton = buttons.add(theme.button("Stop")).widget();
        stopButton.action = this::stop;
        WButton emergency = buttons.add(theme.button("EMERGENCY STOP")).widget();
        emergency.action = this::emergencyStop;
        WButton clear = buttons.add(theme.button("Clear stop")).widget();
        clear.action = () -> {
            HunterRegistry.dashboard().clearEmergencyStop();
            refresh();
        };

        var nav = controls.add(theme.horizontalList()).expandX().widget();
        navButton(nav, "Target Manager", () -> mc.setScreen(new TargetManagerScreen(theme, this)));
        navButton(nav, "Combat", () -> mc.setScreen(new CombatScreen(theme, this)));
        navButton(nav, "Equipment", () -> mc.setScreen(new EquipmentScreen(theme, this)));
        navButton(nav, "Stasis", () -> mc.setScreen(new StasisScreen(theme, this)));
        navButton(nav, "Messages", () -> mc.setScreen(new MessagesScreen(theme, this)));

        var nav2 = controls.add(theme.horizontalList()).expandX().widget();
        navButton(nav2, "Control", () -> mc.setScreen(new com.logvex.hunter.gui.control.ControlScreen(theme, this)));
        navButton(nav2, "Instances", () -> mc.setScreen(new InstancesScreen(theme, this)));
        navButton(nav2, "Swarm", () -> mc.setScreen(new com.logvex.hunter.gui.swarm.SwarmScreen(theme, this)));
        navButton(nav2, "Companion", () -> mc.setScreen(new com.logvex.hunter.gui.instances.CompanionScreen(theme, this)));
        navButton(nav2, "Statistics", () -> mc.setScreen(new StatisticsScreen(theme, this)));
        navButton(nav2, "Profiles", () -> mc.setScreen(new ProfilesScreen(theme, this)));
        WButton save = nav2.add(theme.button("Save all")).widget();
        save.action = this::saveAll;

        // Quick control: profile switcher and one-tap emergency tools, mirrored from the control layer.
        var quick = controls.add(theme.horizontalList()).expandX().widget();
        quick.add(theme.label("Profile")).widget();
        WDropdown<String> profileDropdown = quick.add(
            theme.dropdown(core().config().profiles().keySet().toArray(new String[0]),
                core().config().activeProfileName())).expandX().widget();
        profileDropdown.action = () -> {
            new com.logvex.hunter.companion.MinecraftControlTarget().profile(
                com.logvex.hunter.core.control.ControlAction.Profile.Kind.USE, profileDropdown.get());
            refresh();
        };
        WButton saveProfile = quick.add(theme.button("Save profile")).widget();
        saveProfile.action = () -> {
            new com.logvex.hunter.companion.MinecraftControlTarget().profile(
                com.logvex.hunter.core.control.ControlAction.Profile.Kind.SAVE, null);
            refresh();
        };
        WButton reload = quick.add(theme.button("Reload")).widget();
        reload.action = () -> {
            new com.logvex.hunter.companion.MinecraftControlTarget().data(
                com.logvex.hunter.core.control.ControlAction.Data.Kind.RELOAD);
            refresh();
        };

        // Modules
        var modules = add(theme.section("Modules", true)).expandX().widget();
        modulesTable = modules.add(theme.table()).expandX().widget();
        buildModules();

        // Events
        var events = add(theme.section("Recent combat events", true)).expandX().widget();
        eventsTable = events.add(theme.table()).expandX().widget();

        refresh();
    }

    private void navButton(meteordevelopment.meteorclient.gui.widgets.containers.WHorizontalList list, String text, Runnable action) {
        WButton button = list.add(theme.button(text)).widget();
        button.action = action;
    }

    private void buildModules() {
        modulesTable.clear();
        for (HunterModule module : HunterRegistry.hunterModules()) {
            modulesTable.add(theme.label(module.title)).expandCellX();
            WCheckbox box = modulesTable.add(theme.checkbox(module.isActive())).widget();
            box.action = () -> {
                if (box.checked) module.enable();
                else module.disable();
            };
            WButton settings = modulesTable.add(theme.button("Settings")).widget();
            settings.action = () -> mc.setScreen(theme.moduleScreen(module));
            modulesTable.row();
        }
    }

    private void start() {
        HunterRegistry.dashboard().start();
        refresh();
    }

    private void stop() {
        HunterRegistry.dashboard().stop();
        refresh();
    }

    private void emergencyStop() {
        HunterRegistry.dashboard().emergencyStop();
        buildModules();
        refresh();
    }

    @EventHandler
    private void onTick(meteordevelopment.meteorclient.events.world.TickEvent.Post event) {
        refresh();
    }

    private HunterCore core() {
        return HunterRuntime.get().core();
    }

    private void refresh() {
        HunterCore core = core();
        HunterRuntime runtime = HunterRuntime.get();

        String state = core.config().emergencyStop() ? "EMERGENCY STOP"
            : core.running() ? "RUNNING" : "STOPPED";
        statusLabel.set("State: " + state + "    Profile: " + core.config().activeProfileName());
        statusLabel.color = core.config().emergencyStop() ? Color.RED : core.running() ? Color.GREEN : Color.GRAY;

        TargetCandidate target = core.currentTarget();
        if (target == null) {
            targetLabel.set("Target: none    (visible: " + core.tracker().visibleCount() + ")");
        } else {
            PlayerSnapshot snapshot = target.snapshot;
            targetLabel.set(String.format(Locale.ROOT, "Target: %s  %.1fm  hp %.1f/%.1f  armor %d  [%s]",
                target.name(), target.distance, snapshot.health(), snapshot.maxHealth(), snapshot.armorPoints(),
                target.category.displayName()));
        }

        var session = core.sessions().current();
        String server = core.serverAddress().isBlank() ? "-" : core.serverAddress();
        if (session == null) {
            sessionLabel.set("Session: idle    Server: " + server);
        } else {
            sessionLabel.set("Session: " + Time.duration(runtime.now() - session.startedAt)
                + "    Server: " + server + "    Dimension: " + core.dimension());
        }

        var stats = core.statistics();
        countersLabel.set(String.format(Locale.ROOT,
            "Kills: %d  Deaths: %d  K/D: %.2f  Encounters: %d  Tracked: %d  Modules: %d/%d",
            stats.totalKills(), stats.totalDeaths(), stats.kdRatio(), stats.playerEncounters(),
            core.targets().size(), HunterRegistry.activeCount(), HunterRegistry.hunterModules().size()));

        startButton.visible = !core.running();
        stopButton.visible = core.running();

        refreshEvents(core);
        refreshModuleChecks();
    }

    private void refreshModuleChecks() {
        int i = 0;
        for (HunterModule module : HunterRegistry.hunterModules()) {
            var cell = modulesTable.getRow(i);
            if (cell != null && cell.size() >= 2 && cell.get(1).widget() instanceof WCheckbox box) {
                box.checked = module.isActive();
            }
            i++;
        }
    }

    private void refreshEvents(HunterCore core) {
        if (eventsTable == null) return;
        // Rebuilding a WTable every tick discards and recreates its widgets, which drops clicks and
        // churns allocations. The core bumps a revision whenever an event is recorded, so only
        // rebuild when that changes.
        long revision = core.statistics().eventRevision();
        if (revision == lastEventsRevision) return;
        lastEventsRevision = revision;
        eventsTable.clear();
        List<CombatEvent> events = core.statistics().recentEvents(10);
        if (events.isEmpty()) {
            eventsTable.add(theme.label("No events recorded yet.")).expandCellX();
            eventsTable.row();
            return;
        }
        for (CombatEvent event : events) {
            eventsTable.add(theme.label(Time.clock(event.timestamp))).expandCellX();
            eventsTable.add(theme.label(event.kind.key())).expandCellX();
            eventsTable.add(theme.label(event.message + (event.detail.isBlank() ? "" : " - " + event.detail))).expandCellX();
            eventsTable.row();
        }
    }

    private void saveAll() {
        String error = core().saveAll();
        if (error != null) HunterChat.error(error);
        else HunterChat.info("Saved.");
    }
}
