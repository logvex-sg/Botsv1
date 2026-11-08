package com.logvex.hunter.modules.equipment;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.equipment.EquipmentAdvisor;
import com.logvex.hunter.core.equipment.EquipmentProfile;
import com.logvex.hunter.core.equipment.EquipmentSnapshot;
import com.logvex.hunter.core.equipment.InventoryStatus;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.orbit.EventHandler;

import java.util.List;

/**
 * Monitors armour, durability, totems, food and weapons, and reports what is missing.
 *
 * <p>It is read-only: it never moves items. Recommendations feed the dashboard and the optional
 * chat warnings, so the user stays in control of the inventory.
 */
public class EquipmentManagerModule extends HunterModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<Boolean> warnLowDurability = sgGeneral.add(new BoolSetting.Builder()
        .name("warn-low-durability").description("Warn when a piece of gear is nearly broken.").defaultValue(true).build());

    private final Setting<Integer> lowDurability = sgGeneral.add(new IntSetting.Builder()
        .name("low-durability-percent").description("Durability percentage considered low.").defaultValue(15)
        .min(1).sliderRange(1, 60).visible(warnLowDurability::get).build());

    private final Setting<Integer> minArmorPieces = sgGeneral.add(new IntSetting.Builder()
        .name("min-armor-pieces").description("Warn below this many equipped armour pieces.").defaultValue(4)
        .min(0).sliderRange(0, 4).build());

    private final Setting<Integer> minTotems = sgGeneral.add(new IntSetting.Builder()
        .name("min-totems").description("Warn below this many totems carried.").defaultValue(1)
        .min(0).sliderRange(0, 10).build());

    private final Setting<Integer> minFood = sgGeneral.add(new IntSetting.Builder()
        .name("min-food").description("Warn below this many food items carried.").defaultValue(4)
        .min(0).sliderRange(0, 32).build());

    private final Setting<Boolean> warnMissingWeapon = sgGeneral.add(new BoolSetting.Builder()
        .name("warn-missing-weapon").description("Warn when no weapon is carried.").defaultValue(true).build());

    private final Setting<Boolean> warnFullInventory = sgGeneral.add(new BoolSetting.Builder()
        .name("warn-full-inventory").description("Warn when the inventory has no free slot.").defaultValue(true).build());

    private final Setting<Boolean> announce = sgGeneral.add(new BoolSetting.Builder()
        .name("announce-warnings").description("Send warnings to chat as they appear.").defaultValue(true).build());

    private final Setting<Integer> announceCooldown = sgGeneral.add(new IntSetting.Builder()
        .name("announce-cooldown").description("Seconds between identical warnings.").defaultValue(30)
        .min(1).sliderRange(5, 300).build());

    private long lastAnnounce;
    private String lastWarning = "";

    public EquipmentManagerModule() {
        super(HunterAddon.CATEGORY, "equipment-manager", "Monitors armour, durability, totems, food and weapons.");
    }

    /** The equipment profile from the active hunter profile, with this module's overrides applied. */
    public EquipmentProfile effectiveProfile() {
        HunterCore core = core();
        EquipmentProfile profile = core.config().activeProfile().equipmentProfile();
        if (profile == null) profile = EquipmentProfile.defaults("default");
        profile.setLowDurabilityPercent(lowDurability.get());
        profile.setMinArmorPieces(minArmorPieces.get());
        profile.setMinTotems(minTotems.get());
        profile.setMinFood(minFood.get());
        return profile;
    }

    public EquipmentSnapshot snapshot() {
        return runtime().equipment();
    }

    public InventoryStatus inventory() {
        return runtime().inventory();
    }

    public List<EquipmentAdvisor.Warning> warnings() {
        return EquipmentAdvisor.evaluate(snapshot(), inventory(), effectiveProfile());
    }

    @EventHandler
    private void onTick(TickEvent.Post event) {
        HunterRuntime runtime = runtime();
        if (!core().running() || !runtime.connected()) return;

        List<EquipmentAdvisor.Warning> warnings = warnings();
        for (EquipmentAdvisor.Warning warning : warnings) {
            if (!warnLowDurability.get() && warning.message().toLowerCase(java.util.Locale.ROOT).contains("durability")) continue;
            if (!warnMissingWeapon.get() && warning.message().contains("weapon")) continue;
            if (!warnFullInventory.get() && warning.message().contains("Inventory full")) continue;

            if (warning.severity() == EquipmentAdvisor.Severity.CRITICAL) {
                core().recordEvent(CombatEvent.Kind.INFO, "Equipment: " + warning.message(), "");
            }
            if (announce.get()) announceOnce(warning);
        }
    }

    private void announceOnce(EquipmentAdvisor.Warning warning) {
        long now = runtime().now();
        if (warning.message().equals(lastWarning) && now - lastAnnounce < announceCooldown.get() * 1000L) return;
        lastWarning = warning.message();
        lastAnnounce = now;
        if (warning.severity() == EquipmentAdvisor.Severity.CRITICAL) {
            HunterChat.warn(warning.message());
        } else {
            HunterChat.info(warning.message());
        }
    }

    public String recommendedWeapon() {
        return EquipmentAdvisor.recommendWeapon(inventory(), effectiveProfile());
    }

    @Override
    public void onActivate() {
        core().statistics().recordModuleActivation(name);
        lastAnnounce = 0;
        lastWarning = "";
    }
}
