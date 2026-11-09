package com.logvex.hunter.core.control;

import com.logvex.hunter.core.model.TargetCategory;

import java.util.Locale;

/**
 * Parses a plain-text control line into a {@link ControlAction}.
 *
 * <p>The same grammar drives the in-game {@code .hunter}/{@code .target} commands and the companion
 * HTTP {@code command} route, so a script that works from the Fleet Manager works identically from
 * chat. The parser is pure: it never touches game state, which makes every branch unit-testable.
 *
 * <p>Grammar (whitespace separated, case-insensitive verbs):
 * <pre>
 *   start | stop | emergency-stop|estop|panic | clear-stop | pause | resume | save | status
 *   module &lt;name&gt; [on|off|toggle]
 *   settings &lt;module&gt;                (read one module's settings)
 *   settings                          (read every module's settings)
 *   set &lt;module&gt; &lt;setting&gt; &lt;value...&gt;
 *   profile list | profile use|create|delete|save &lt;name&gt;
 *   hud list | hud &lt;element&gt;
 *   focus &lt;player&gt; | clear-target
 *   target add &lt;name&gt; [category] | target remove &lt;name&gt;
 *   target category &lt;name&gt; &lt;category&gt; | target priority &lt;name&gt; &lt;1-10&gt;
 *   target notes &lt;name&gt; &lt;text...&gt;
 *   reload | export
 *   notify &lt;message...&gt;
 * </pre>
 */
public final class ControlParser {
    private ControlParser() {}

    /**
     * Parses a control line.
     *
     * @return the action, or {@code null} when the line is empty or not understood. Callers turn a
     *         null into a usage/error message so an unknown verb is reported rather than ignored.
     */
    public static ControlAction parse(String line) {
        if (line == null) return null;
        String trimmed = line.trim();
        if (trimmed.isEmpty()) return null;
        String[] parts = trimmed.split("\\s+");
        String verb = lower(parts[0]);

        return switch (verb) {
            case "start" -> new ControlAction.Lifecycle(ControlAction.Lifecycle.Kind.START);
            case "stop" -> new ControlAction.Lifecycle(ControlAction.Lifecycle.Kind.STOP);
            case "emergency-stop", "estop", "panic" ->
                new ControlAction.Lifecycle(ControlAction.Lifecycle.Kind.EMERGENCY_STOP);
            case "clear-stop" -> new ControlAction.Lifecycle(ControlAction.Lifecycle.Kind.CLEAR_STOP);
            case "pause" -> new ControlAction.Lifecycle(ControlAction.Lifecycle.Kind.PAUSE);
            case "resume" -> new ControlAction.Lifecycle(ControlAction.Lifecycle.Kind.RESUME);
            case "save" -> new ControlAction.Lifecycle(ControlAction.Lifecycle.Kind.SAVE);
            case "status" -> new ControlAction.Lifecycle(ControlAction.Lifecycle.Kind.STATUS);
            case "module", "toggle" -> module(parts);
            case "settings", "setting" -> settings(parts);
            case "set" -> set(parts, trimmed);
            case "profile", "profiles" -> profile(parts);
            case "hud" -> hud(parts);
            case "focus" -> parts.length >= 2 ? new ControlAction.Focus(parts[parts.length - 1]) : null;
            case "clear-target" -> new ControlAction.Focus(null);
            case "target" -> target(parts, trimmed);
            case "reload" -> new ControlAction.Data(ControlAction.Data.Kind.RELOAD);
            case "export" -> new ControlAction.Data(ControlAction.Data.Kind.EXPORT);
            case "notify" -> notify(parts, trimmed);
            default -> null;
        };
    }

    // ------------------------------------------------------------- sub-parsers

    private static ControlAction module(String[] parts) {
        if (parts.length < 2) return null;
        String name = lower(parts[1]);
        String action = parts.length >= 3 ? lower(parts[2]) : "toggle";
        return switch (action) {
            case "on", "enable", "true" -> new ControlAction.ModuleToggle(name, true);
            case "off", "disable", "false" -> new ControlAction.ModuleToggle(name, false);
            case "toggle" -> new ControlAction.ModuleToggle(name, null);
            default -> null;
        };
    }

    private static ControlAction settings(String[] parts) {
        if (parts.length < 2) return new ControlAction.ModuleGet(null);
        return new ControlAction.ModuleGet(lower(parts[1]));
    }

    private static ControlAction set(String[] parts, String full) {
        // set <module> <setting> <value...>   (value may contain spaces, e.g. a chat message)
        if (parts.length < 4) return null;
        String module = lower(parts[1]);
        String setting = lower(parts[2]);
        String value = afterNthToken(full, 3);
        if (value == null || value.isEmpty()) return null;
        return new ControlAction.SettingSet(module, setting, value);
    }

    private static ControlAction profile(String[] parts) {
        if (parts.length < 2) return new ControlAction.Profile(ControlAction.Profile.Kind.LIST, null);
        String action = lower(parts[1]);
        String name = parts.length >= 3 ? parts[2] : null;
        return switch (action) {
            case "list" -> new ControlAction.Profile(ControlAction.Profile.Kind.LIST, null);
            case "use", "switch", "activate" -> name == null ? null
                : new ControlAction.Profile(ControlAction.Profile.Kind.USE, name);
            case "create", "new" -> name == null ? null
                : new ControlAction.Profile(ControlAction.Profile.Kind.CREATE, name);
            case "delete", "remove", "rm" -> name == null ? null
                : new ControlAction.Profile(ControlAction.Profile.Kind.DELETE, name);
            case "save" -> name == null ? new ControlAction.Profile(ControlAction.Profile.Kind.SAVE, null)
                : new ControlAction.Profile(ControlAction.Profile.Kind.SAVE, name);
            default -> null;
        };
    }

    private static ControlAction hud(String[] parts) {
        if (parts.length < 2 || lower(parts[1]).equals("list")) {
            return new ControlAction.Hud(null, true);
        }
        return new ControlAction.Hud(lower(parts[1]), false);
    }

    private static ControlAction target(String[] parts, String full) {
        if (parts.length < 2) return null;
        String action = lower(parts[1]);
        return switch (action) {
            case "add" -> {
                if (parts.length < 3) yield null;
                String category = parts.length >= 4 ? lower(parts[3]) : "priority";
                yield new ControlAction.Target(ControlAction.Target.Op.ADD, parts[2], category, null, null);
            }
            case "remove", "delete", "rm" -> parts.length < 3 ? null
                : new ControlAction.Target(ControlAction.Target.Op.REMOVE, parts[2], null, null, null);
            case "category", "cat" -> {
                if (parts.length < 4) yield null;
                yield new ControlAction.Target(ControlAction.Target.Op.SET_CATEGORY, parts[2], lower(parts[3]), null, null);
            }
            case "priority", "prio" -> {
                if (parts.length < 4) yield null;
                Integer priority = parseInt(parts[3]);
                if (priority == null) yield null;
                yield new ControlAction.Target(ControlAction.Target.Op.SET_PRIORITY, parts[2], null, priority, null);
            }
            case "notes", "note" -> {
                if (parts.length < 4) yield null;
                String notes = afterNthToken(full, 3);
                if (notes == null) yield null;
                yield new ControlAction.Target(ControlAction.Target.Op.SET_NOTES, parts[2], null, null, notes);
            }
            default -> null;
        };
    }

    private static ControlAction notify(String[] parts, String full) {
        String message = afterNthToken(full, 1);
        return message == null || message.isEmpty() ? null : new ControlAction.Notify(message);
    }

    // -------------------------------------------------------------- helpers

    /** Whether the given category key names a real target category. */
    public static boolean isValidCategory(String key) {
        if (key == null) return false;
        for (TargetCategory category : TargetCategory.values()) {
            if (category.key().equalsIgnoreCase(key)) return true;
        }
        return false;
    }

    private static String afterNthToken(String full, int n) {
        // Returns everything after the first n whitespace-separated tokens, preserving inner spaces.
        int index = 0;
        int tokens = 0;
        int length = full.length();
        while (index < length && tokens < n) {
            while (index < length && Character.isWhitespace(full.charAt(index))) index++;
            while (index < length && !Character.isWhitespace(full.charAt(index))) index++;
            tokens++;
        }
        while (index < length && Character.isWhitespace(full.charAt(index))) index++;
        return index >= length ? "" : full.substring(index).trim();
    }

    private static Integer parseInt(String value) {
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
