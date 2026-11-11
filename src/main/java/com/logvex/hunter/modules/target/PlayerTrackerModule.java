package com.logvex.hunter.modules.target;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.config.HunterProfile;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.target.SortMode;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.core.target.TargetFilterSettings;
import com.logvex.hunter.core.target.TargetTracker;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.DoubleSetting;
import meteordevelopment.meteorclient.settings.EnumSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;

import meteordevelopment.orbit.EventHandler;

import java.util.List;
import java.util.Locale;

/**
 * Detects nearby players, keeps the target lists in sync and chooses a current target.
 *
 * <p>The selection logic itself lives in the Minecraft-free core ({@link TargetTracker},
 * {@link com.logvex.hunter.core.target.TargetSelector}); this module only samples the world, feeds
 * the core and republishes the resulting events.
 */
public class PlayerTrackerModule extends HunterModule {
    private final SettingGroup sgDetection = settings.getDefaultGroup();
    private final SettingGroup sgTracking = settings.createGroup("Tracking");
    private final SettingGroup sgFilters = settings.createGroup("Filters");

    private final Setting<Double> range = sgDetection.add(new DoubleSetting.Builder()
        .name("range")
        .description("Maximum distance at which a player is considered.")
        .defaultValue(64).min(1).sliderRange(8, 256).build());

    private final Setting<Integer> scanInterval = sgDetection.add(new IntSetting.Builder()
        .name("scan-interval")
        .description("Ticks between scans. Higher values reduce per-tick work.")
        .defaultValue(10).min(1).sliderRange(1, 40).build());

    private final Setting<Double> closeRange = sgDetection.add(new DoubleSetting.Builder()
        .name("close-range")
        .description("Distance considered 'close' for entered-range alerts.")
        .defaultValue(16).min(1).sliderRange(4, 64).build());

    private final Setting<SortMode> sortMode = sgTracking.add(new EnumSetting.Builder<SortMode>()
        .name("sort-mode")
        .description("How candidates are ordered when picking a target.")
        .defaultValue(SortMode.PRIORITY).build());

    private final Setting<Boolean> autoSelect = sgTracking.add(new BoolSetting.Builder()
        .name("auto-select")
        .description("Automatically pick and switch to the best candidate.")
        .defaultValue(true).build());

    private final Setting<Integer> maxCandidates = sgTracking.add(new IntSetting.Builder()
        .name("max-candidates")
        .description("How many candidates to keep after sorting.")
        .defaultValue(8).min(1).sliderRange(1, 32).build());

    private final Setting<Integer> switchCooldown = sgTracking.add(new IntSetting.Builder()
        .name("switch-cooldown")
        .description("Seconds between automatic target switches.")
        .defaultValue(3).min(0).sliderRange(0, 30).build());

    private final Setting<Boolean> protectFriends = sgFilters.add(new BoolSetting.Builder()
        .name("protect-friends")
        .description("Never select Meteor friends as targets.")
        .defaultValue(true).build());

    private final Setting<Boolean> protectIgnored = sgFilters.add(new BoolSetting.Builder()
        .name("protect-ignored")
        .description("Never select players on the ignore list.")
        .defaultValue(true).build());

    private final Setting<Boolean> ignoreNaked = sgFilters.add(new BoolSetting.Builder()
        .name("ignore-naked")
        .description("Skip players below the armour threshold.")
        .defaultValue(false).build());

    private final Setting<Integer> nakedArmorThreshold = sgFilters.add(new IntSetting.Builder()
        .name("naked-armor-threshold")
        .description("Armour points below which a player counts as naked.")
        .defaultValue(0).min(0).sliderRange(0, 20).visible(ignoreNaked::get).build());

    private final Setting<Boolean> requireWeapon = sgFilters.add(new BoolSetting.Builder()
        .name("require-weapon")
        .description("Only track players holding a weapon.")
        .defaultValue(false).build());

    private final Setting<Boolean> ignoreInvisible = sgFilters.add(new BoolSetting.Builder()
        .name("ignore-invisible")
        .description("Skip invisible players.")
        .defaultValue(true).build());

    private final Setting<Boolean> ignoreCreative = sgFilters.add(new BoolSetting.Builder()
        .name("ignore-creative")
        .description("Skip creative and spectator players.")
        .defaultValue(true).build());

    private final Setting<Boolean> onlyTracked = sgFilters.add(new BoolSetting.Builder()
        .name("only-tracked")
        .description("Only consider players that are already on one of the target lists.")
        .defaultValue(false).build());

    private final Setting<Boolean> autoAddTemporary = sgFilters.add(new BoolSetting.Builder()
        .name("auto-add-temporary")
        .description("Remember newly seen players on the temporary list.")
        .defaultValue(false).build());

    private int tickCounter;

    public PlayerTrackerModule() {
        super(HunterAddon.CATEGORY, "player-tracker", "Detects nearby players and selects a target.");
    }

    public HunterCore core() {
        return HunterRuntime.get().core();
    }

    public List<TargetCandidate> candidates() {
        return core().candidates();
    }

    public TargetCandidate currentTarget() {
        return core().currentTarget();
    }

    // ------------------------------------------------------------------ tick

    @EventHandler
    private void onTick(TickEvent.Post event) {
        HunterRuntime runtime = HunterRuntime.get();
        HunterCore core = runtime.core();
        if (!core.running()) return;

        if (tickCounter++ < scanInterval.get()) return;
        tickCounter = 0;

        if (!runtime.connected()) {
            core.resetSessionState();
            return;
        }

        long now = runtime.now();
        TargetTracker tracker = core.tracker();
        tracker.setCloseRange(closeRange.get());

        TargetTracker.ScanResult result = tracker.update(
            runtime.localPosition(),
            runtime.players(),
            core.targets(),
            filterSettings(),
            sortMode.get(),
            maxCandidates.get(),
            autoSelect.get(),
            switchCooldown.get() * 1000,
            now);

        core.setCandidates(result.candidates());

        for (TargetTracker.Appearance appearance : result.appeared()) {
            if (appearance.snapshot() == null) continue;
            if (autoAddTemporary.get() && appearance.entry() == null) {
                core.targets().putByUuid(appearance.snapshot().uuid(), TargetCategory.TEMPORARY, appearance.snapshot().name());
            }
            core.recordEncounter(appearance.snapshot(), appearance.distance(), now);
            if (appearance.reappeared()) {
                core.publish(new HunterEvents.TargetReappeared(appearance.snapshot(), appearance.entry(), appearance.distance(), appearance.awayMillis()));
            } else {
                core.publish(new HunterEvents.TargetDetected(appearance.snapshot(), appearance.entry(), appearance.distance()));
            }
        }

        for (TargetTracker.Disappearance disappearance : result.disappeared()) {
            core.publish(new HunterEvents.TargetLost(disappearance.snapshot(), disappearance.entry(), disappearance.lastSeen()));
        }

        for (TargetTracker.EnteredRange entered : result.enteredRange()) {
            core.publish(new HunterEvents.TargetEnteredRange(entered.snapshot(), entered.entry(), entered.distance()));
        }

        PlayerSnapshot previous = core.currentTarget() == null ? null : core.currentTarget().snapshot;
        if (result.switched()) {
            TargetCandidate current = result.current();
            core.setCurrentTarget(current);
            core.publish(new HunterEvents.TargetSwitched(previous, current == null ? null : current.snapshot, false));
            if (current != null) {
                core.recordEvent(CombatEvent.Kind.TARGET_SWITCH, "Target: " + current.name(),
                    String.format(Locale.ROOT, "%.1fm", current.distance));
            }
        } else if (result.current() != null) {
            core.setCurrentTarget(result.current());
        }

        if (result.hasChanges()) {
            core.publish(new HunterEvents.ScanCompleted(now, result.candidates().size(), tracker.visibleCount()));
        }
    }

    @Override
    public void onActivate() {
        super.onActivate();
        tickCounter = scanInterval.get();
        core().statistics().recordModuleActivation(name);
    }

    @Override
    public void onDeactivate() {
        super.onDeactivate();
        core().resetSessionState();
    }

    // ------------------------------------------------------------- selection

    /** Selects a specific visible player by name. Returns true when the player was visible. */
    public boolean selectByName(String name) {
        HunterCore core = core();
        for (TargetCandidate candidate : core.candidates()) {
            if (candidate.name().equalsIgnoreCase(name)) {
                PlayerSnapshot previous = core.currentTarget() == null ? null : core.currentTarget().snapshot;
                TargetCandidate selected = core.tracker().select(candidate.snapshot.identityKey(), core.candidates(), HunterRuntime.get().now());
                core.setCurrentTarget(selected);
                core.statistics().addManualSwitch();
                core.publish(new HunterEvents.TargetSwitched(previous, candidate.snapshot, true));
                return true;
            }
        }
        return false;
    }

    public void clearTarget() {
        HunterCore core = core();
        PlayerSnapshot previous = core.currentTarget() == null ? null : core.currentTarget().snapshot;
        core.tracker().clearSelection();
        core.setCurrentTarget(null);
        core.publish(new HunterEvents.TargetSwitched(previous, null, true));
    }

    public boolean addTarget(String name, TargetCategory category) {
        HunterCore core = core();
        TargetEntry existing = core.targets().byName(name);
        if (existing != null) {
            existing.setCategory(category);
            core.markDirty();
            return true;
        }
        TargetEntry entry = new TargetEntry(category, name);
        entry.setLastSeen(HunterRuntime.get().now());
        core.targets().add(entry);
        core.statistics().addTrackedTarget();
        core.markDirty();
        return true;
    }

    public boolean removeTarget(String name) {
        HunterCore core = core();
        TargetEntry entry = core.targets().byName(name);
        if (entry == null) return false;
        core.targets().remove(entry.identityKey());
        core.markDirty();
        return true;
    }

    public TargetFilterSettings filterSettings() {
        TargetFilterSettings filters = new TargetFilterSettings();
        filters.range = range.get();
        filters.ignoreNaked = ignoreNaked.get();
        filters.nakedArmorThreshold = nakedArmorThreshold.get();
        filters.requireWeapon = requireWeapon.get();
        filters.ignoreInvisible = ignoreInvisible.get();
        filters.ignoreCreative = ignoreCreative.get();
        filters.onlyTracked = onlyTracked.get();
        filters.protectFriends = protectFriends.get();
        filters.protectIgnored = protectIgnored.get();
        return filters;
    }

    // -------------------------------------------------------------- profiles

    /** Applies a stored profile to this module's settings. */
    public void applyProfile(HunterProfile profile) {
        if (profile == null) return;
        range.set(profile.range());
        scanInterval.set(profile.scanIntervalTicks());
        sortMode.set(profile.sortMode());
        autoSelect.set(profile.autoSelect());
        maxCandidates.set(profile.maxCandidates());
        switchCooldown.set(profile.switchCooldownSeconds());
        protectFriends.set(profile.protectFriends());
        protectIgnored.set(profile.protectIgnored());
        ignoreNaked.set(profile.ignoreNaked());
        nakedArmorThreshold.set(profile.nakedArmorThreshold());
        requireWeapon.set(profile.requireWeapon());
        ignoreInvisible.set(profile.ignoreInvisible());
        ignoreCreative.set(profile.ignoreCreative());
        onlyTracked.set(profile.onlyTracked());
    }

    /** Copies the current module settings into a profile. */
    public void captureProfile(HunterProfile profile) {
        if (profile == null) return;
        profile.setRange(range.get());
        profile.setScanIntervalTicks(scanInterval.get());
        profile.setSortMode(sortMode.get());
        profile.setAutoSelect(autoSelect.get());
        profile.setMaxCandidates(maxCandidates.get());
        profile.setSwitchCooldownSeconds(switchCooldown.get());
        profile.setProtectFriends(protectFriends.get());
        profile.setProtectIgnored(protectIgnored.get());
        profile.setIgnoreNaked(ignoreNaked.get());
        profile.setNakedArmorThreshold(nakedArmorThreshold.get());
        profile.setRequireWeapon(requireWeapon.get());
        profile.setIgnoreInvisible(ignoreInvisible.get());
        profile.setIgnoreCreative(ignoreCreative.get());
        profile.setOnlyTracked(onlyTracked.get());
    }

    @Override
    public String getInfoString() {
        TargetCandidate target = currentTarget();
        if (target == null) return null;
        return target.name() + " " + String.format(Locale.ROOT, "%.0fm", target.distance);
    }
}
