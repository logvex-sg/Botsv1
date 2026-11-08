package com.logvex.hunter.modules.combat;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.config.HunterProfile;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.systems.modules.Module;
import meteordevelopment.meteorclient.systems.modules.Modules;
import meteordevelopment.meteorclient.systems.modules.combat.AutoArmor;
import meteordevelopment.meteorclient.systems.modules.combat.AutoTotem;
import meteordevelopment.meteorclient.systems.modules.combat.AutoWeapon;
import meteordevelopment.meteorclient.systems.modules.combat.KillAura;
import meteordevelopment.meteorclient.systems.modules.player.AutoEat;
import meteordevelopment.orbit.EventHandler;

import java.util.ArrayList;
import java.util.List;

/**
 * Coordinates the existing Meteor combat modules instead of duplicating them.
 *
 * <p>It watches KillAura, AutoWeapon, AutoTotem, AutoArmor and AutoEat, and can bring the ones the
 * user selected in line with the current target: enable them when a valid target is present and
 * disable them when it is gone. It never attacks anything itself - it only toggles the modules that
 * do, which keeps friend and ignore-list protection in one place.
 */
public class CombatCoordinatorModule extends HunterModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<Boolean> manageKillAura = sgGeneral.add(new BoolSetting.Builder()
        .name("manage-kill-aura").description("Enable KillAura while a target is present.").defaultValue(true).build());

    private final Setting<Boolean> manageAutoWeapon = sgGeneral.add(new BoolSetting.Builder()
        .name("manage-auto-weapon").description("Enable AutoWeapon while a target is present.").defaultValue(true).build());

    private final Setting<Boolean> manageAutoTotem = sgGeneral.add(new BoolSetting.Builder()
        .name("manage-auto-totem").description("Keep AutoTotem enabled while running.").defaultValue(true).build());

    private final Setting<Boolean> manageAutoArmor = sgGeneral.add(new BoolSetting.Builder()
        .name("manage-auto-armor").description("Keep AutoArmor enabled while running.").defaultValue(true).build());

    private final Setting<Boolean> manageAutoEat = sgGeneral.add(new BoolSetting.Builder()
        .name("manage-auto-eat").description("Keep AutoEat enabled while running.").defaultValue(true).build());

    private final Setting<Boolean> avoidConflicts = sgGeneral.add(new BoolSetting.Builder()
        .name("avoid-conflicts")
        .description("Disable CrystalAura and AnchorAura while a melee target is selected.")
        .defaultValue(true).build());

    private final Setting<Boolean> disableOnDeath = sgGeneral.add(new BoolSetting.Builder()
        .name("disable-on-death")
        .description("Disable the managed combat modules when the local player dies.")
        .defaultValue(false).build());

    private final Setting<Boolean> onlyWhenTarget = sgGeneral.add(new BoolSetting.Builder()
        .name("only-with-target")
        .description("Only keep the modules enabled while a target is selected.")
        .defaultValue(true).build());

    private final List<Module> managed = new ArrayList<>();
    private boolean applied;

    public CombatCoordinatorModule() {
        super(HunterAddon.CATEGORY, "combat-coordinator", "Coordinates Meteor's combat modules around the current target.");
    }

    private KillAura killAura() {
        return Modules.get().get(KillAura.class);
    }

    private AutoWeapon autoWeapon() {
        return Modules.get().get(AutoWeapon.class);
    }

    private AutoTotem autoTotem() {
        return Modules.get().get(AutoTotem.class);
    }

    private AutoArmor autoArmor() {
        return Modules.get().get(AutoArmor.class);
    }

    private AutoEat autoEat() {
        return Modules.get().get(AutoEat.class);
    }

    @EventHandler
    private void onTick(TickEvent.Post event) {
        HunterRuntime runtime = runtime();
        HunterCore core = runtime.core();
        if (!core.running()) {
            if (applied) releaseManaged();
            return;
        }

        boolean hasTarget = core.currentTarget() != null;
        boolean engage = hasTarget || !onlyWhenTarget.get();

        if (manageAutoTotem.get()) setEnabled(autoTotem(), engage || hasTarget);
        if (manageAutoArmor.get()) setEnabled(autoArmor(), engage || hasTarget);
        if (manageAutoEat.get()) setEnabled(autoEat(), engage || hasTarget);

        boolean auraOn = hasTarget && manageKillAura.get();
        setEnabled(killAura(), auraOn);
        if (manageAutoWeapon.get()) setEnabled(autoWeapon(), auraOn);

        if (avoidConflicts.get() && hasTarget) {
            setEnabled(Modules.get().get(meteordevelopment.meteorclient.systems.modules.combat.CrystalAura.class), false);
            setEnabled(Modules.get().get(meteordevelopment.meteorclient.systems.modules.combat.AnchorAura.class), false);
        }
        applied = true;
    }

    @EventHandler
    private void onTargetSwitched(HunterEvents.TargetSwitched event) {
        if (!event.manual() || event.current() == null) return;
        HunterCore core = core();
        TargetCandidate current = core.currentTarget();
        if (current != null) {
            core.recordEvent(com.logvex.hunter.core.stats.CombatEvent.Kind.TARGET_SWITCH,
                "Engaging " + current.name(), String.format(java.util.Locale.ROOT, "%.1fm", current.distance));
        }
    }

    @EventHandler
    private void onLocalDeath(HunterEvents.LocalPlayerDied event) {
        if (disableOnDeath.get()) releaseManaged();
    }

    private void setEnabled(Module module, boolean enable) {
        if (module == null) return;
        if (enable && !module.isActive()) {
            module.enable();
            if (!managed.contains(module)) managed.add(module);
        } else if (!enable && module.isActive()) {
            module.disable();
        }
    }

    /** Disables every module this coordinator turned on, leaving user-enabled ones alone where possible. */
    public void releaseManaged() {
        applied = false;
        for (Module module : managed) {
            if (module.isActive()) module.disable();
        }
        managed.clear();
    }

    /** Emergency stop: turn the managed combat modules off immediately. */
    public void emergencyStop() {
        releaseManaged();
        setEnabled(killAura(), false);
        setEnabled(autoWeapon(), false);
        HunterChat.warn("Combat coordinator emergency stop: managed combat modules disabled.");
    }

    @Override
    public void onActivate() {
        core().statistics().recordModuleActivation(name);
        applied = false;
    }

    @Override
    public void onDeactivate() {
        releaseManaged();
    }

    @Override
    public void onEmergencyStop() {
        emergencyStop();
        super.onEmergencyStop();
    }

    /** Applies the combat-compatibility part of a profile. */
    public void applyProfile(HunterProfile profile) {
        if (profile == null) return;
        manageKillAura.set(profile.manageKillAura());
        manageAutoWeapon.set(profile.manageAutoWeapon());
        manageAutoTotem.set(profile.manageAutoTotem());
        manageAutoArmor.set(profile.manageAutoArmor());
        manageAutoEat.set(profile.manageAutoEat());
        avoidConflicts.set(profile.avoidConflicts());
        disableOnDeath.set(profile.emergencyDisableOnDeath());
    }

    public void captureProfile(HunterProfile profile) {
        if (profile == null) return;
        profile.setManageKillAura(manageKillAura.get());
        profile.setManageAutoWeapon(manageAutoWeapon.get());
        profile.setManageAutoTotem(manageAutoTotem.get());
        profile.setManageAutoArmor(manageAutoArmor.get());
        profile.setManageAutoEat(manageAutoEat.get());
        profile.setAvoidConflicts(avoidConflicts.get());
        profile.setEmergencyDisableOnDeath(disableOnDeath.get());
    }

    public boolean isManaged(Class<? extends Module> type) {
        for (Module module : managed) {
            if (type.isInstance(module)) return true;
        }
        return false;
    }

    public List<Module> managedModules() {
        return new ArrayList<>(managed);
    }
}
