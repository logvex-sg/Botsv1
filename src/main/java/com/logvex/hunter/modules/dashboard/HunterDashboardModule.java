package com.logvex.hunter.modules.dashboard;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.config.HunterProfile;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.stats.EliminationLog;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import com.logvex.hunter.modules.HunterRegistry;
import meteordevelopment.meteorclient.MeteorClient;
import meteordevelopment.meteorclient.events.entity.player.AttackEntityEvent;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.orbit.EventHandler;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

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

    private final Setting<Boolean> detectEliminations = sgGeneral.add(new BoolSetting.Builder()
        .name("detect-eliminations")
        .description("Record a kill when a player you recently struck and left at low health vanishes.")
        .defaultValue(true).build());

    private final Setting<Integer> eliminationWindow = sgGeneral.add(new IntSetting.Builder()
        .name("elimination-window")
        .description("Seconds after your last hit within which a vanishing player still counts.")
        .defaultValue(8).min(1).sliderRange(1, 30).visible(detectEliminations::get).build());

    private boolean deathSeen;
    private long lastAutosave;
    private EliminationLog eliminations = new EliminationLog();

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

    /**
     * Remembers which player the local player just struck, so a later disappearance can be judged.
     *
     * <p>Only player entities count; hitting a mob is not an elimination of a tracked player.
     */
    @EventHandler
    private void onAttackEntity(AttackEntityEvent event) {
        if (!detectEliminations.get() || !core().running()) return;
        Entity target = event.entity;
        if (!(target instanceof Player player)) return;
        if (MeteorClient.mc != null && player == MeteorClient.mc.player) return;
        eliminations.noteAttack(player.getUUID().toString().toLowerCase(java.util.Locale.ROOT),
            player.getScoreboardName(), runtime().now());
    }

    /**
     * Judges a vanished player: a kill only when they were recently struck and left at low health.
     *
     * <p>This is the honest detector. Walking out of render distance is not a kill, so a plain
     * disappearance records nothing.
     */
    @EventHandler
    private void onTargetLost(HunterEvents.TargetLost event) {
        if (!detectEliminations.get() || !core().running()) return;
        PlayerSnapshot snapshot = event.snapshot();
        if (snapshot == null) return;
        String key = snapshot.uuid() == null
            ? "name:" + snapshot.name().toLowerCase(java.util.Locale.ROOT)
            : snapshot.uuid().toString().toLowerCase(java.util.Locale.ROOT);
        eliminations.noteHealth(key, snapshot.health(), runtime().now());
        if (eliminations.confirm(key, runtime().now())) {
            core().recordElimination(snapshot, event.entry(), runtime().localWeapon());
        }
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
        if (core.config().companionEnabled()) {
            enableCompanion("companion");
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
        super.onActivate();
        core().statistics().recordModuleActivation(name);
        lastAutosave = runtime().now();
    }

    @Override
    public void onDeactivate() {
        super.onDeactivate();
        if (saveOnStop.get()) core().saveAll();
    }
}
