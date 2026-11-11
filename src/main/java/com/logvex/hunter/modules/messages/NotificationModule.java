package com.logvex.hunter.modules.messages;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.event.EventBus;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.core.message.MessageEvent;
import com.logvex.hunter.core.message.MessageManager;
import com.logvex.hunter.core.message.Placeholders;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.settings.StringSetting;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Turns core events into configurable chat messages.
 *
 * <p>Message bodies and cooldowns are configured per event in {@code messages.json}; this module
 * only decides which events to react to and whether the text is echoed to the server.
 */
public class NotificationModule extends HunterModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<Boolean> notifyDetect = sgGeneral.add(new BoolSetting.Builder()
        .name("notify-detect").description("Announce a newly detected player.").defaultValue(true).build());

    private final Setting<Boolean> notifyDisappear = sgGeneral.add(new BoolSetting.Builder()
        .name("notify-disappear").description("Announce a player leaving range.").defaultValue(true).build());

    private final Setting<Boolean> notifyReappear = sgGeneral.add(new BoolSetting.Builder()
        .name("notify-reappear").description("Announce a player coming back.").defaultValue(true).build());

    private final Setting<Boolean> notifyEnteredRange = sgGeneral.add(new BoolSetting.Builder()
        .name("notify-entered-range").description("Announce a player moving close.").defaultValue(true).build());

    private final Setting<Boolean> notifyStasis = sgGeneral.add(new BoolSetting.Builder()
        .name("notify-stasis").description("Announce defensive stasis changes.").defaultValue(true).build());

    private final Setting<Boolean> notifyConnection = sgGeneral.add(new BoolSetting.Builder()
        .name("notify-connection").description("Announce connection loss.").defaultValue(true).build());

    private final Setting<Boolean> notifyEliminated = sgGeneral.add(new BoolSetting.Builder()
        .name("notify-eliminated")
        .description("Announce a confirmed controlled-session elimination.")
        .defaultValue(true).build());

    private final Setting<Boolean> sendToServer = sgGeneral.add(new BoolSetting.Builder()
        .name("send-to-server")
        .description("Also type the message into server chat. Respects server chat restrictions.")
        .defaultValue(false).build());

    private final Setting<String> prefix = sgGeneral.add(new StringSetting.Builder()
        .name("prefix").description("Prefix shown before local messages.").defaultValue("").build());

    private final List<EventBus.Subscription> subscriptions = new ArrayList<>();

    public NotificationModule() {
        super(HunterAddon.CATEGORY, "notifications", "Sends configurable chat messages for hunter events.");
    }

    private MessageManager messages() {
        return core().messages();
    }

    private void emit(MessageEvent event, Map<String, String> placeholders) {
        long now = runtime().now();
        MessageManager.Rendered rendered = messages().render(event, placeholders, now);
        if (rendered == null) return;
        String text = prefix.get() + rendered.text();
        HunterChat.send(text, sendToServer.get());
    }

    private Map<String, String> base(PlayerSnapshot snapshot, TargetEntry entry, double distance) {
        Map<String, String> values = Placeholders.of(snapshot, entry, distance, runtime().serverAddress());
        values.put("weapon", runtime().localWeapon());
        return values;
    }

    @Override
    public void onActivate() {
        super.onActivate();
        core().statistics().recordModuleActivation(name);
        HunterCore core = core();
        EventBus bus = core.bus();
        subscriptions.clear();

        subscriptions.add(bus.subscribe(HunterEvents.TargetDetected.class, e -> {
            if (notifyDetect.get()) emit(MessageEvent.TARGET_DETECTED, base(e.snapshot(), e.entry(), e.distance()));
        }));
        subscriptions.add(bus.subscribe(HunterEvents.TargetLost.class, e -> {
            if (notifyDisappear.get()) emit(MessageEvent.TARGET_DISAPPEARED, base(e.snapshot(), e.entry(), 0));
        }));
        subscriptions.add(bus.subscribe(HunterEvents.TargetReappeared.class, e -> {
            if (notifyReappear.get()) emit(MessageEvent.TARGET_REAPPEARED, base(e.snapshot(), e.entry(), e.distance()));
        }));
        subscriptions.add(bus.subscribe(HunterEvents.TargetEnteredRange.class, e -> {
            if (notifyEnteredRange.get()) emit(MessageEvent.TARGET_ENTERED_RANGE, base(e.snapshot(), e.entry(), e.distance()));
        }));
        subscriptions.add(bus.subscribe(HunterEvents.StasisChanged.class, e -> {
            if (!notifyStasis.get()) return;
            if (e.current().atLeast(com.logvex.hunter.core.stasis.StasisLevel.DANGER)) {
                Map<String, String> values = Placeholders.build();
                values.put("health", String.format(Locale.ROOT, "%.0f", runtime().localHealth()));
                values.put("reasons", String.join("; ", e.reasons()));
                emit(MessageEvent.STASIS_DANGER, values);
            } else if (e.current() == com.logvex.hunter.core.stasis.StasisLevel.SAFE
                && e.previous().atLeast(com.logvex.hunter.core.stasis.StasisLevel.CAUTION)) {
                Map<String, String> values = Placeholders.build();
                values.put("health", String.format(Locale.ROOT, "%.0f", runtime().localHealth()));
                emit(MessageEvent.STASIS_RECOVERED, values);
            }
        }));
        subscriptions.add(bus.subscribe(HunterEvents.ConnectionChanged.class, e -> {
            if (!e.connected() && notifyConnection.get()) {
                Map<String, String> values = Placeholders.build();
                values.put("server", e.serverAddress());
                emit(MessageEvent.CONNECTION_LOST, values);
            }
        }));
        subscriptions.add(bus.subscribe(HunterEvents.TargetEliminated.class, e -> {
            if (!notifyEliminated.get()) return;
            Map<String, String> values = base(e.snapshot(), e.entry(), 0);
            values.put("weapon", e.weapon() == null || e.weapon().isBlank() ? "none" : e.weapon());
            emit(MessageEvent.TARGET_ELIMINATED, values);
        }));
    }

    @Override
    public void onDeactivate() {
        super.onDeactivate();
        for (EventBus.Subscription subscription : subscriptions) subscription.close();
        subscriptions.clear();
    }
}
