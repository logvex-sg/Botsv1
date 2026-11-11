package com.logvex.hunter.modules.stasis;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.core.stasis.StasisLevel;
import com.logvex.hunter.core.stasis.StasisMonitor;
import com.logvex.hunter.core.stasis.StasisSettings;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.DoubleSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.orbit.EventHandler;

/**
 * Watches the local player's defensive readiness: health, totems, food, armour and connection.
 *
 * <p>It is a monitoring system only. It never attacks and never moves items; the emergency controls
 * it exposes are the user's own (disconnect, disable, stop the hunt). This keeps the addon inside
 * the "controlled environment" contract.
 */
public class DefensiveStasisModule extends HunterModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<Double> dangerHealth = sgGeneral.add(new DoubleSetting.Builder()
        .name("danger-health").description("Health at or below which stasis is DANGER.").defaultValue(8)
        .min(1).sliderRange(1, 20).build());

    private final Setting<Double> criticalHealth = sgGeneral.add(new DoubleSetting.Builder()
        .name("critical-health").description("Health at or below which stasis is CRITICAL.").defaultValue(4)
        .min(1).sliderRange(1, 20).build());

    private final Setting<Integer> minTotems = sgGeneral.add(new IntSetting.Builder()
        .name("min-totems").description("Totems below which stasis is not SAFE.").defaultValue(1)
        .min(0).sliderRange(0, 10).build());

    private final Setting<Integer> minFood = sgGeneral.add(new IntSetting.Builder()
        .name("min-food").description("Food below which stasis is CAUTION.").defaultValue(4)
        .min(0).sliderRange(0, 32).build());

    private final Setting<Integer> minArmorPieces = sgGeneral.add(new IntSetting.Builder()
        .name("min-armor-pieces").description("Equipped armour below which stasis is not SAFE.").defaultValue(4)
        .min(0).sliderRange(0, 4).build());

    private final Setting<Integer> lowDurability = sgGeneral.add(new IntSetting.Builder()
        .name("low-durability-percent").description("Durability percentage that lowers stasis.").defaultValue(15)
        .min(1).sliderRange(1, 60).build());

    private final Setting<Boolean> disconnectIsDanger = sgGeneral.add(new BoolSetting.Builder()
        .name("disconnect-is-danger").description("Treat a lost connection as DANGER.").defaultValue(true).build());

    private final Setting<Boolean> warnFullInventory = sgGeneral.add(new BoolSetting.Builder()
        .name("warn-full-inventory").description("Treat a full inventory as CAUTION.").defaultValue(true).build());

    private final Setting<Boolean> announce = sgGeneral.add(new BoolSetting.Builder()
        .name("announce").description("Announce stasis changes in chat.").defaultValue(true).build());

    private final Setting<Boolean> autoDisconnect = sgGeneral.add(new BoolSetting.Builder()
        .name("auto-disconnect-on-critical")
        .description("Disconnect when stasis reaches CRITICAL. Manual emergency control.")
        .defaultValue(false).build());

    private StasisLevel lastLevel = StasisLevel.SAFE;
    private int assessedTick = -1;
    private StasisMonitor.Assessment cachedAssessment;
    private int cachedReadiness;

    public DefensiveStasisModule() {
        super(HunterAddon.CATEGORY, "defensive-stasis", "Monitors defensive readiness and danger thresholds.");
    }

    public StasisSettings settings() {
        StasisSettings s = new StasisSettings();
        s.dangerHealth = dangerHealth.get();
        s.criticalHealth = Math.min(criticalHealth.get(), dangerHealth.get());
        s.minTotems = minTotems.get();
        s.minFood = minFood.get();
        s.minArmorPieces = minArmorPieces.get();
        s.lowDurabilityPercent = lowDurability.get();
        s.treatDisconnectAsDanger = disconnectIsDanger.get();
        s.warnOnFullInventory = warnFullInventory.get();
        return s;
    }

    public StasisMonitor.Assessment assess() {
        // Called from the HUD every frame and from the tick handler; one evaluation per tick is
        // plenty, so reuse the cached result within a tick instead of re-allocating the reason list.
        if (assessedTick == runtime().tickId() && cachedAssessment != null) return cachedAssessment;
        assessedTick = runtime().tickId();
        cachedAssessment = StasisMonitor.assess(runtime().equipment(), runtime().inventory(),
            runtime().localHealth(), runtime().connected(), settings());
        return cachedAssessment;
    }

    public StasisLevel level() {
        return lastLevel;
    }

    public int readiness() {
        if (assessedTick == runtime().tickId()) return cachedReadiness;
        assess();
        cachedReadiness = StasisMonitor.readinessScore(runtime().equipment(), runtime().inventory(),
            core().config().activeProfile().equipmentProfile());
        return cachedReadiness;
    }

    @EventHandler
    private void onTick(TickEvent.Post event) {
        HunterRuntime runtime = runtime();
        if (!core().running()) return;

        StasisMonitor.Assessment assessment = assess();
        if (assessment.level() != lastLevel) {
            StasisLevel previous = lastLevel;
            lastLevel = assessment.level();
            core().publish(new HunterEvents.StasisChanged(previous, lastLevel, assessment.reasons()));
            core().recordEvent(com.logvex.hunter.core.stats.CombatEvent.Kind.STASIS,
                "Stasis: " + lastLevel.displayName(), String.join("; ", assessment.reasons()));
            if (announce.get() && lastLevel.atLeast(StasisLevel.DANGER)) {
                HunterChat.warn("Stasis " + lastLevel.displayName() + ": " + String.join("; ", assessment.reasons()));
            }
        }

        if (autoDisconnect.get() && lastLevel == StasisLevel.CRITICAL && runtime.connected()) {
            HunterChat.error("Stasis CRITICAL - disconnecting (auto-disconnect).");
            emergencyDisconnect();
        }
    }

    /** Manual emergency control: leave the server immediately. */
    public void emergencyDisconnect() {
        var mc = net.minecraft.client.Minecraft.getInstance();
        if (mc.getConnection() != null) {
            mc.getConnection().getConnection().disconnect(
                net.minecraft.network.chat.Component.literal("Logvex Hunter: emergency disconnect"));
        }
    }

    @Override
    public void onActivate() {
        super.onActivate();
        core().statistics().recordModuleActivation(name);
        lastLevel = StasisLevel.SAFE;
    }

    @Override
    public void onDeactivate() {
        super.onDeactivate();
        lastLevel = StasisLevel.SAFE;
    }
}
