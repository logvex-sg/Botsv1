package com.logvex.hunter.core.message;

import com.logvex.hunter.core.util.Json;
import com.logvex.hunter.core.util.Text;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * The configurable message system.
 *
 * <p>Holds several {@link MessageProfile}s, picks one template per event at random among the
 * enabled ones, applies placeholders, and enforces per-template cooldowns. It is entirely
 * Minecraft-free so the selection and cooldown rules are unit-tested.
 */
public final class MessageManager {
    public static final int SCHEMA_VERSION = 1;

    private final Map<String, MessageProfile> profiles = new LinkedHashMap<>();
    private String activeProfile = "default";
    private final Map<String, Long> lastSent = new LinkedHashMap<>();
    private final Random random;
    /** When true, cooldowns are ignored (used by previews). */
    private boolean bypassCooldown;

    public MessageManager() {
        this(new Random());
    }

    public MessageManager(Random random) {
        this.random = random;
        installDefaults();
    }

    // ------------------------------------------------------------- profiles

    public MessageProfile profile(String name) {
        return profiles.get(name);
    }

    public MessageProfile active() {
        MessageProfile profile = profiles.get(activeProfile);
        if (profile == null) {
            profile = profiles.values().stream().findFirst().orElseGet(() -> {
                MessageProfile created = new MessageProfile("default");
                profiles.put("default", created);
                activeProfile = "default";
                return created;
            });
        }
        return profile;
    }

    public String activeProfileName() {
        return activeProfile;
    }

    public void setActiveProfile(String name) {
        if (profiles.containsKey(name)) activeProfile = name;
    }

    public List<String> profileNames() {
        return new ArrayList<>(profiles.keySet());
    }

    public MessageProfile createProfile(String name, boolean copyActive) {
        if (name == null || name.isBlank()) return null;
        MessageProfile profile = copyActive ? active().copy(name) : new MessageProfile(name);
        profiles.put(name, profile);
        return profile;
    }

    public boolean deleteProfile(String name) {
        if (profiles.size() <= 1) return false;
        if (!profiles.containsKey(name)) return false;
        profiles.remove(name);
        if (activeProfile.equals(name)) activeProfile = profiles.keySet().iterator().next();
        return true;
    }

    public void put(MessageProfile profile) {
        profiles.put(profile.name(), profile);
    }

    // -------------------------------------------------------------- sending

    /** A rendered message plus the cooldown key used to track it. */
    public record Rendered(String text, String cooldownKey) {}

    /**
     * Renders the message for an event, or returns {@code null} when nothing should be sent
     * (no enabled template, or every template is still cooling down).
     */
    public Rendered render(MessageEvent event, Map<String, String> placeholders, long now) {
        MessageProfile profile = active();
        List<MessageTemplate> candidates = profile.templates(event);
        if (candidates.isEmpty()) return null;

        List<MessageTemplate> usable = new ArrayList<>();
        for (MessageTemplate template : candidates) {
            if (!template.enabled()) continue;
            if (!bypassCooldown && isCoolingDown(template, now)) continue;
            usable.add(template);
        }
        if (usable.isEmpty()) return null;

        MessageTemplate chosen = usable.get(random.nextInt(usable.size()));
        String text = Text.applyPlaceholders(chosen.text(), placeholders);
        String key = cooldownKey(chosen.text());
        if (chosen.cooldownSeconds() > 0) lastSent.put(key, now);
        return new Rendered(text, key);
    }

    private boolean isCoolingDown(MessageTemplate template, long now) {
        if (template.cooldownSeconds() <= 0) return false;
        Long last = lastSent.get(cooldownKey(template.text()));
        if (last == null) return false;
        return now - last < template.cooldownSeconds() * 1000L;
    }

    private String cooldownKey(String text) {
        return text;
    }

    /** Renders every enabled template for an event, for the GUI preview and command output. */
    public List<String> preview(MessageEvent event, Map<String, String> placeholders) {
        List<String> out = new ArrayList<>();
        boolean previous = bypassCooldown;
        bypassCooldown = true;
        try {
            for (MessageTemplate template : active().templates(event)) {
                if (!template.enabled()) continue;
                out.add(Text.applyPlaceholders(template.text(), placeholders));
            }
        } finally {
            bypassCooldown = previous;
        }
        return out;
    }

    public void resetCooldowns() {
        lastSent.clear();
    }

    // --------------------------------------------------------- persistence

    public Map<String, Object> toJson() {
        Map<String, Object> root = Json.object();
        root.put("schema", SCHEMA_VERSION);
        root.put("active", activeProfile);
        Map<String, Object> profileMap = Json.object();
        for (Map.Entry<String, MessageProfile> entry : profiles.entrySet()) {
            profileMap.put(entry.getKey(), entry.getValue().toJson());
        }
        root.put("profiles", profileMap);
        return root;
    }

    public static MessageManager fromJson(Map<String, Object> root) {
        MessageManager manager = new MessageManager();
        manager.profiles.clear();
        Map<String, Object> profileMap = Json.getObject(root, "profiles");
        for (Map.Entry<String, Object> entry : profileMap.entrySet()) {
            if (entry.getValue() instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> profileJson = (Map<String, Object>) map;
                MessageProfile profile = MessageProfile.fromJson(profileJson);
                if (profile.name() == null || profile.name().isBlank()) profile.setName(entry.getKey());
                manager.profiles.put(profile.name(), profile);
            }
        }
        if (manager.profiles.isEmpty()) manager.installDefaults();
        String active = Json.getString(root, "active", "default");
        manager.activeProfile = manager.profiles.containsKey(active) ? active : manager.profiles.keySet().iterator().next();
        return manager;
    }

    public String toJsonText() {
        return Json.writePretty(toJson());
    }

    // ------------------------------------------------------------ defaults

    private void installDefaults() {
        profiles.clear();
        MessageProfile profile = new MessageProfile("default");

        profile.add(MessageEvent.TARGET_DETECTED, new MessageTemplate("Target detected: {player} at {distance}m"));
        profile.add(MessageEvent.TARGET_DETECTED, new MessageTemplate("{player} appeared ({health} hp)"));
        profile.add(MessageEvent.TARGET_DISAPPEARED, new MessageTemplate("Target disappeared: {player}"));
        profile.add(MessageEvent.TARGET_REAPPEARED, new MessageTemplate("{player} reappeared at {distance}m"));
        profile.add(MessageEvent.TARGET_ENTERED_RANGE, new MessageTemplate("{player} entered range ({distance}m)"));
        profile.add(MessageEvent.TARGET_ELIMINATED, new MessageTemplate("{player} eliminated in a controlled session"));
        profile.add(MessageEvent.TARGET_LOST_HEALTH, new MessageTemplate("{player} is low on health ({health} hp)"));
        profile.add(MessageEvent.STASIS_DANGER, new MessageTemplate("Stasis danger: health {health}, check totems"));
        profile.add(MessageEvent.STASIS_RECOVERED, new MessageTemplate("Stasis recovered, health {health}"));
        profile.add(MessageEvent.CONNECTION_LOST, new MessageTemplate("Connection lost at {time}"));

        profiles.put("default", profile);
        activeProfile = "default";
    }
}
