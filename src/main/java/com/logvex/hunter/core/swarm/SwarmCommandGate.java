package com.logvex.hunter.core.swarm;

import com.logvex.hunter.core.control.ControlAction;
import com.logvex.hunter.core.control.ControlParser;

import java.util.Locale;
import java.util.Set;

/**
 * Decides whether a command may be broadcast to every hunter.
 *
 * <p>A broadcast reaches every client at once, so one typo can do the same thing fifty times. This
 * gate is the guard rail: read-only and cosmetic commands pass, but lifecycle changes and anything
 * that would arm combat on the whole fleet are refused unless the operator explicitly opted in with
 * {@code allow-combat-broadcast}. The check is pure and unit-tested, so the rule cannot drift from
 * what the command surface actually does.
 */
public final class SwarmCommandGate {
    private SwarmCommandGate() {}

    /** Modules whose toggling or reconfiguration arms combat, and so is gated. */
    private static final Set<String> COMBAT_MODULES = Set.of(
        // Meteor's combat modules.
        "kill-aura", "auto-weapon", "auto-totem", "auto-armor", "auto-eat", "mace-aura",
        "crystal-aura", "anchor-aura", "bed-aura", "anti-anchor", "anti-bed", "anti-anvil",
        "auto-trap", "self-trap", "auto-anvil", "self-anvil", "auto-web", "self-web",
        "surround", "burrow", "offhand", "criticals", "bow-aimbot", "bow-spam", "quiver",
        "auto-exp", "auto-city", "hole-filler", "hitboxes", "arrow-dodge", "attribute-swap",
        "auto-log", "anti-void",
        // The addon's own combat coordination.
        "combat-coordinator");

    /** Settings that change who may be attacked. Gated even on a non-combat module. */
    private static final Set<String> COMBAT_SETTINGS = Set.of(
        "auto-enable-modules", "protect-friends", "protect-ignored", "friend-protection");

    /** Verbs that are safe to send to the whole fleet: they read, annotate or retune, not act. */
    private static final Set<String> BROADCAST_VERBS = Set.of(
        "status", "save", "settings", "setting", "set", "profile", "hud",
        "focus", "clear-target", "target", "notify");

    /** Verbs that always run on the whole fleet, because stopping everything is never the danger. */
    private static final Set<String> ALWAYS_ALLOWED = Set.of("emergency-stop", "estop", "panic");

    /** The result of inspecting a command. */
    public record Verdict(boolean allowed, String reason) {
        public static Verdict allow() {
            return new Verdict(true, "");
        }

        public static Verdict deny(String reason) {
            return new Verdict(false, reason);
        }
    }

    /**
     * Inspects a broadcast command.
     *
     * @param line                  the raw command line
     * @param allowCombatBroadcast  whether the operator has opted into fleet-wide combat changes
     * @return whether it may be broadcast, and why not when it may not
     */
    public static Verdict inspect(String line, boolean allowCombatBroadcast) {
        if (line == null || line.isBlank()) return Verdict.deny("empty command");
        String verb = firstWord(line);
        if (ALWAYS_ALLOWED.contains(verb)) return Verdict.allow();
        if (allowCombatBroadcast) return Verdict.allow();

        if (isCombatChange(verb, line)) {
            return Verdict.deny("'" + verb + "' can arm combat; enable allow-combat-broadcast to send it to the fleet");
        }
        if (BROADCAST_VERBS.contains(verb)) return Verdict.allow();
        if (verb.equals("start") || verb.equals("stop") || verb.equals("pause") || verb.equals("resume")) {
            return Verdict.deny("lifecycle changes must be sent to one hunter at a time (use 'send')");
        }
        if (verb.equals("reload") || verb.equals("export")) {
            return Verdict.deny("'" + verb + "' must be sent to one hunter at a time (use 'send')");
        }
        return Verdict.deny("'" + verb + "' is not in the broadcast allowlist");
    }

    /** Whether a single command targets a combat module or a combat-relevant setting. */
    public static boolean isCombatChange(String verb, String line) {
        String[] parts = line.trim().split("\\s+");
        if (verb.equals("module") || verb.equals("toggle")) {
            return parts.length >= 2 && COMBAT_MODULES.contains(parts[1].toLowerCase(Locale.ROOT));
        }
        if (verb.equals("set") || verb.equals("settings") || verb.equals("setting")) {
            if (parts.length >= 2 && COMBAT_MODULES.contains(parts[1].toLowerCase(Locale.ROOT))) return true;
            return parts.length >= 3 && COMBAT_SETTINGS.contains(parts[2].toLowerCase(Locale.ROOT));
        }
        // "bot <action>" is the legacy alias for the lifecycle verbs.
        if (verb.equals("bot")) {
            return parts.length >= 2 && !parts[1].equalsIgnoreCase("status");
        }
        return false;
    }

    /** Whether the parsed command would arm combat, used to warn before a single-hunter send too. */
    public static boolean armsCombat(String line) {
        ControlAction action = ControlParser.parse(line);
        if (action instanceof ControlAction.ModuleToggle toggle) {
            return toggle.enable() != Boolean.FALSE && COMBAT_MODULES.contains(toggle.module());
        }
        if (action instanceof ControlAction.SettingSet set) {
            return COMBAT_MODULES.contains(set.module()) || COMBAT_SETTINGS.contains(set.setting());
        }
        return false;
    }

    private static String firstWord(String line) {
        String trimmed = line.trim();
        int space = trimmed.indexOf(' ');
        return (space < 0 ? trimmed : trimmed.substring(0, space)).toLowerCase(Locale.ROOT);
    }
}
