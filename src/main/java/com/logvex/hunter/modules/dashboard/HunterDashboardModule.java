package com.logvex.hunter.modules.dashboard;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.config.HunterProfile;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import com.logvex.hunter.modules.HunterRegistry;
import meteordevelopment.meteorclient.MeteorClient;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.orbit.EventHandler;

/**
 * The master switch and session driver for the whole addon.
 *
 * <p>Enabling it starts the hunter: it begins a session, keeps an eye on the local player's health
 * and death, and (optionally) turns the companion modules on. Disabling it, or the emergency stop,
 * brings everything down cleanly.
 */
public class HunterDashboardModule extends HunterModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<Boolean> autoEnableModules = sgGeneral.add(new BoolSetting.Builder()
        .name("auto-enable-modules")
        .description("Enable the tracker and coordinator modules when the hunter starts.")
        .defaultValue(true).build());

    private final Setting<Boolean> announceStartStop = sgGeneral.add(new BoolSetting.Builder()
        .name("announce-start-stop").description("Print a chat message when the hunter starts or stops.")
        .defaultValue(true).build());

    private final Setting<Boolean> trackDeaths = sgGeneral.add(new BoolSetting.Builder()
        .name("track-deaths").description("Record the local player's deaths in the statistics.")
        .defaultValue(true).build());

    private final Setting<Integer> deathHealthThreshold = sgGeneral.add(new IntSetting.Builder()
        .name("death-health-threshold").description("Health at or below which a death is assumed.")
        .defaultValue(0).min(0).sliderRange(0, 10).build());

    private final Setting<Boolean> saveOnStop = sgGeneral.add(new BoolSetting.Builder()
        .name("save-on-stop").description("Persist everything when the hunter stops.")
        .defaultValue(true).build());

    private final Setting<Integer> autosaveInterval = sgGeneral.add(new IntSetting.Builder()
        .name("autosave-interval").description("Seconds between automatic saves. 0 disables autosave.")
        .defaultValue(300).min(0).sliderRange(0, 1800).build());

    private boolean deathSeen;
    private long lastAutosave;

    public HunterDashboardModule() {
        super(HunterAddon.CATEGORY, "hunter-dashboard", "Master switch and session driver for the hunter.");
    }

    @EventHandler
    private void onTick(TickEvent.Post event) {
        HunterRuntime runtime = runtime();
        HunterCore core = runtime.core();
        if (!core.running()) return;

        if (core.sessions().current() == null && runtime.connected()) {
            core.sessions().start(Long.toString(runtime.now(), 36), runtime.now(),
                core.serverAddress(), core.dimension());
        }

        if (trackDeaths.get() && runtime.connected()) {
            if (runtime.localHealth() <= deathHealthThreshold.get()) {
                if (!deathSeen) {
                    deathSeen = true;
                    core.recordDeath();
                    core.publish(new HunterEvents.LocalPlayerDied("health reached zero"));
                }
            } else if (runtime.localHealth() > deathHealthThreshold.get() + 2) {
                deathSeen = false;
            }
        }

        if (autosaveInterval.get() > 0 && runtime.now() - lastAutosave >= autosaveInterval.get() * 1000L) {
            lastAutosave = runtime.now();
            core.saveAll();
        }
    }

    @EventHandler
    private void onTargetEliminated(HunterEvents.TargetEliminated event) {
        if (event.snapshot() == null) return;
        core().recordKill(event.snapshot().name());
    }

    /** Starts the hunter: begins a session and optionally enables the companion modules. */
    public void start() {
        HunterCore core = core();
        core.config().setEnabled(true);
        core.config().setEmergencyStop(false);
        if (core.sessions().current() == null) {
            core.sessions().start(Long.toString(runtime().now(), 36), runtime().now(),
                core.serverAddress(), core.dimension());
        }
        if (autoEnableModules.get()) {
            enableCompanion("player-tracker");
            enableCompanion("notifications");
            enableCompanion("equipment-manager");
            enableCompanion("defensive-stasis");
        }
        core.recordEvent(CombatEvent.Kind.INFO, "Hunter started", core.serverAddress());
        core.markDirty();
        if (announceStartStop.get()) HunterChat.info("Hunter started. Session " + core.sessions().current().id);
    }

    /** Stops the hunter: ends the session and disables the companion modules. */
    public void stop() {
        HunterCore core = core();
        core.config().setEnabled(false);
        var closed = core.sessions().stop(runtime().now());
        if (closed != null) core.statistics().addSession(closed);
        disableCompanion("player-tracker");
        disableCompanion("notifications");
        disableCompanion("equipment-manager");
        disableCompanion("defensive-stasis");
        disableCompanion("combat-coordinator");
        disableCompanion("instance-manager");
        core.recordEvent(CombatEvent.Kind.INFO, "Hunter stopped", "");
        if (saveOnStop.get()) core.saveAll();
        if (announceStartStop.get()) HunterChat.info("Hunter stopped.");
    }

    /** Emergency stop: immediately stop and disable every module of the addon. */
    public void emergencyStop() {
        HunterCore core = core();
        core.config().setEmergencyStop(true);
        for (var module : HunterRegistry.hunterModules()) {
            if (module.isActive()) module.disable();
        }
        core.sessions().stop(runtime().now());
        core.saveAll();
        HunterChat.error("EMERGENCY STOP: all hunter modules disabled.");
    }

    /** Clears the emergency stop so the hunter can be started again. */
    public void clearEmergencyStop() {
        core().config().setEmergencyStop(false);
        core().markDirty();
        HunterChat.info("Emergency stop cleared.");
    }

    private void enableCompanion(String name) {
        var module = HunterRegistry.find(name);
        if (module != null && !module.isActive()) module.enable();
    }

    private void disableCompanion(String name) {
        var module = HunterRegistry.find(name);
        if (module != null && module.isActive()) module.disable();
    }

    public HunterProfile activeProfile() {
        return core().config().activeProfile();
    }

    public PlayerSnapshot currentTargetSnapshot() {
        TargetCandidate target = core().currentTarget();
        return target == null ? null : target.snapshot;
    }

    @Override
    public void onActivate() {
        core().statistics().recordModuleActivation(name);
        lastAutosave = runtime().now();
    }

    @Override
    public void onDeactivate() {
        if (saveOnStop.get()) core().saveAll();
    }
}
