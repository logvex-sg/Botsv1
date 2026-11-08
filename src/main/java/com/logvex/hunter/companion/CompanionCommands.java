package com.logvex.hunter.companion;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.target.PlayerTrackerModule;

import java.util.Locale;

/**
 * The administrative commands the companion endpoint can invoke.
 *
 * <p>Every command runs on the client thread (the caller marshals it there) and only touches the
 * addon's own state: it never sends chat to the server, never attacks and never moves the player.
 * This is what keeps a remote dashboard from turning into unattended automation.
 */
final class CompanionCommands {
    private CompanionCommands() {}

    static String run(String command) {
        String[] parts = command.trim().split("\\s+");
        if (parts.length == 0 || parts[0].isBlank()) return "empty command";
        String verb = parts[0].toLowerCase(Locale.ROOT);
        return switch (verb) {
            case "status" -> status();
            case "start" -> start();
            case "stop" -> stop();
            case "emergency-stop", "estop", "panic" -> emergencyStop();
            case "clear-stop" -> clearStop();
            case "target" -> target(parts);
            case "module", "toggle" -> module(parts);
            case "focus" -> focus(parts);
            case "clear-target" -> clearTarget();
            case "save" -> save();
            case "bot" -> bot(parts);
            default -> "unknown command: " + verb;
        };
    }

    private static String status() {
        HunterCore core = HunterRuntime.get().core();
        var stats = core.statistics();
        var target = core.currentTarget();
        return "state=" + state(core)
            + " server=" + (core.serverAddress().isBlank() ? "-" : core.serverAddress())
            + " kills=" + stats.totalKills() + " deaths=" + stats.totalDeaths()
            + " tracked=" + core.targets().size()
            + " target=" + (target == null ? "none" : target.name());
    }

    private static String start() {
        HunterRegistry.dashboard().start();
        return "hunter started";
    }

    private static String stop() {
        HunterRegistry.dashboard().stop();
        return "hunter stopped";
    }

    private static String emergencyStop() {
        HunterRegistry.dashboard().emergencyStop();
        return "emergency stop engaged";
    }

    private static String clearStop() {
        HunterRegistry.dashboard().clearEmergencyStop();
        return "emergency stop cleared";
    }

    private static String save() {
        String error = HunterRuntime.get().core().saveAll();
        return error == null ? "saved" : error;
    }

    private static String target(String[] parts) {
        if (parts.length < 2) return "usage: target <add|remove|list|focus> <name> [category]";
        String action = parts[1].toLowerCase(Locale.ROOT);
        return switch (action) {
            case "add" -> {
                if (parts.length < 3) yield "usage: target add <name> [category]";
                String category = parts.length >= 4 ? parts[3] : "priority";
                yield addTarget(parts[2], category);
            }
            case "remove", "delete" -> parts.length < 3 ? "usage: target remove <name>"
                : removeTarget(parts[2]);
            case "list" -> listTargets(parts.length >= 3 ? parts[2] : "priority");
            case "focus" -> parts.length < 3 ? "usage: target focus <name>" : focus(parts);
            default -> "unknown target action: " + action;
        };
    }

    private static String listTargets(String categoryKey) {
        HunterCore core = HunterRuntime.get().core();
        TargetCategory category = TargetCategory.fromKey(categoryKey);
        var entries = core.targets().byCategory(category);
        if (entries.isEmpty()) return category.displayName() + ": empty";
        StringBuilder sb = new StringBuilder(category.displayName()).append(" (").append(entries.size()).append("): ");
        for (TargetEntry entry : entries) {
            sb.append(entry.effectiveName()).append("(prio ").append(entry.priority()).append(") ");
        }
        return sb.toString().trim();
    }

    private static String focus(String[] parts) {
        if (parts.length < 2) return "usage: focus <name>";
        String name = parts[parts.length - 1];
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null && tracker.selectByName(name)) return "focused " + name;
        return name + " is not currently visible";
    }

    private static String clearTarget() {
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) tracker.clearTarget();
        return "target cleared";
    }

    private static String module(String[] parts) {
        if (parts.length < 3) return "usage: module <name> <on|off|toggle>";
        String name = parts[1].toLowerCase(Locale.ROOT);
        String action = parts[2].toLowerCase(Locale.ROOT);
        HunterModule module = HunterRegistry.find(name);
        if (module == null) return "unknown module: " + name;
        switch (action) {
            case "on", "enable" -> module.enable();
            case "off", "disable" -> module.disable();
            case "toggle" -> module.toggle();
            default -> {
                return "unknown action: " + action;
            }
        }
        return name + " is now " + (module.isActive() ? "on" : "off");
    }

    private static String bot(String[] parts) {
        if (parts.length < 2) return "usage: bot <status|pause|resume|stop>";
        String action = parts[1].toLowerCase(Locale.ROOT);
        return switch (action) {
            case "status" -> status();
            case "pause" -> {
                HunterRuntime.get().core().config().setEnabled(false);
                HunterRuntime.get().core().markDirty();
                yield "paused";
            }
            case "resume" -> start();
            case "stop", "emergency-stop" -> emergencyStop();
            default -> "unknown bot action: " + action;
        };
    }

    private static String addTarget(String name, String categoryKey) {
        TargetCategory category = TargetCategory.fromKey(categoryKey);
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) {
            tracker.addTarget(name, category);
        } else {
            HunterCore core = HunterRuntime.get().core();
            TargetEntry entry = core.targets().byName(name);
            if (entry == null) core.targets().add(new TargetEntry(category, name));
            else entry.setCategory(category);
            core.markDirty();
        }
        record("Added target " + name + " (" + category.key() + ")");
        return "added " + name + " to " + category.displayName();
    }

    private static String removeTarget(String name) {
        HunterCore core = HunterRuntime.get().core();
        TargetEntry entry = core.targets().byName(name);
        if (entry == null) return name + " is not on any list";
        core.targets().remove(entry.identityKey());
        core.markDirty();
        record("Removed target " + name);
        return "removed " + name;
    }

    private static String state(HunterCore core) {
        if (core.config().emergencyStop()) return "emergency-stop";
        return core.running() ? "running" : "stopped";
    }

    static void record(String message) {
        HunterRuntime.get().core().recordEvent(CombatEvent.Kind.INFO, message, "remote");
    }
}
