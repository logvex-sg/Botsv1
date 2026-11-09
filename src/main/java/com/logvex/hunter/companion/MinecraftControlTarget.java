package com.logvex.hunter.companion;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.control.ControlAction;
import com.logvex.hunter.core.control.ControlParser;
import com.logvex.hunter.core.control.ControlTarget;
import com.logvex.hunter.core.control.HudView;
import com.logvex.hunter.core.control.ModuleView;
import com.logvex.hunter.core.control.ProfileView;
import com.logvex.hunter.core.control.SettingView;
import com.logvex.hunter.core.config.HunterProfile;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.store.AtomicFiles;
import com.logvex.hunter.core.target.TargetStore;
import com.logvex.hunter.core.util.Text;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.target.PlayerTrackerModule;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.DoubleSetting;
import meteordevelopment.meteorclient.settings.EnumSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.settings.StringSetting;
import meteordevelopment.meteorclient.systems.hud.Hud;
import meteordevelopment.meteorclient.systems.hud.HudElement;
import meteordevelopment.meteorclient.systems.modules.Module;
import meteordevelopment.meteorclient.systems.modules.Modules;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The game-layer implementation of the {@link ControlTarget} surface.
 *
 * <p>Every method runs on the client thread (the caller marshals it there) and only touches Meteor
 * and addon state: it never sends chat to the server, never attacks and never moves the player. This
 * is what keeps a remote dashboard from turning into unattended automation.
 */
public final class MinecraftControlTarget implements ControlTarget {
    @Override
    public String lifecycle(ControlAction.Lifecycle.Kind kind) {
        var dashboard = HunterRegistry.dashboard();
        return switch (kind) {
            case START -> {
                dashboard.start();
                yield "hunter started";
            }
            case STOP -> {
                dashboard.stop();
                yield "hunter stopped";
            }
            case EMERGENCY_STOP -> {
                dashboard.emergencyStop();
                yield "emergency stop engaged";
            }
            case CLEAR_STOP -> {
                dashboard.clearEmergencyStop();
                yield "emergency stop cleared";
            }
            case PAUSE -> {
                core().config().setEnabled(false);
                core().markDirty();
                yield "paused";
            }
            case RESUME -> {
                dashboard.start();
                yield "resumed";
            }
            case SAVE -> {
                String error = core().saveAll();
                yield error == null ? "saved" : error;
            }
            case STATUS -> status();
        };
    }

    @Override
    public String setModule(String module, Boolean enable) {
        Module found = findModule(module);
        if (found == null) return "unknown module: " + module;
        boolean target = enable == null ? !found.isActive() : enable;
        if (target && !found.isActive()) found.enable();
        else if (!target && found.isActive()) found.disable();
        return found.name + " is now " + (found.isActive() ? "on" : "off");
    }

    @Override
    public List<ModuleView> modules(String module) {
        List<ModuleView> list = new ArrayList<>();
        if (module != null) {
            Module found = findModule(module);
            if (found != null) list.add(viewOf(found));
            return list;
        }
        for (HunterModule hunter : HunterRegistry.hunterModules()) list.add(viewOf(hunter));
        for (Module meteor : Modules.get().getAll()) {
            if (meteor.category == com.logvex.hunter.HunterAddon.CATEGORY) continue;
            if (isHunterModule(meteor)) continue;
            list.add(viewOf(meteor));
        }
        return list;
    }

    @Override
    public String setSetting(String module, String setting, String value) {
        Module found = findModule(module);
        if (found == null) return "unknown module: " + module;
        Setting<?> s = found.settings.get(setting);
        if (s == null) return "unknown setting '" + setting + "' on " + found.name;
        if (!s.parse(value)) {
            return "could not set " + found.name + "." + setting + " to '" + value + "'";
        }
        core().markDirty();
        return found.name + "." + setting + " = " + s.get();
    }

    @Override
    public String profile(ControlAction.Profile.Kind kind, String name) {
        HunterCore core = core();
        return switch (kind) {
            case LIST -> listProfiles();
            case USE -> {
                if (name == null || core.config().profile(name) == null) {
                    yield "no such profile: " + name;
                }
                core.config().setActiveProfile(name);
                applyProfile(core.config().activeProfile());
                core.markDirty();
                yield "active profile is now " + name;
            }
            case CREATE -> {
                HunterProfile created = core.config().createProfile(name, true);
                if (created == null) yield "profile already exists or the name is invalid: " + name;
                core.markDirty();
                yield "created profile " + name + " (copied from the active one)";
            }
            case DELETE -> {
                boolean removed = core.config().deleteProfile(name);
                core.markDirty();
                yield removed ? "deleted profile " + name : "cannot delete the last profile or no such profile: " + name;
            }
            case SAVE -> {
                captureActiveProfile();
                core.markDirty();
                core.saveAll();
                yield "saved the active profile from the current settings";
            }
        };
    }

    @Override
    public List<ProfileView> profiles() {
        HunterCore core = core();
        String active = core.config().activeProfileName();
        List<ProfileView> list = new ArrayList<>();
        for (HunterProfile profile : core.config().profiles().values()) {
            list.add(new ProfileView(profile.name(), profile.name().equals(active), profile.range(),
                profile.scanIntervalTicks(), profile.sortMode().name().toLowerCase(Locale.ROOT),
                profile.autoSelect(), profile.protectFriends(), profile.protectIgnored()));
        }
        return list;
    }

    @Override
    public String hud(String element, boolean list) {
        if (list || element == null) return listHud();
        HudElement found = findHud(element);
        if (found == null) return "unknown hud element: " + element;
        found.toggle();
        return found.info.name + " is now " + (found.isActive() ? "on" : "off");
    }

    @Override
    public List<HudView> hudViews() {
        List<HudView> list = new ArrayList<>();
        for (HudElement el : Hud.get()) {
            list.add(new HudView(el.info.name, el.info.title, el.info.group.title(), el.isActive(),
                isHunterElement(el)));
        }
        return list;
    }

    @Override
    public String focus(String player) {
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker == null) return "player tracker is not registered";
        if (player == null) {
            tracker.clearTarget();
            return "target cleared";
        }
        return tracker.selectByName(player) ? "focused " + player : player + " is not currently visible";
    }

    @Override
    public String target(ControlAction.Target action) {
        HunterCore core = core();
        return switch (action.op()) {
            case ADD -> addTarget(action.name(), action.category());
            case REMOVE -> {
                TargetEntry entry = core.targets().byName(action.name());
                if (entry == null) yield action.name() + " is not on any list";
                core.targets().remove(entry.identityKey());
                core.markDirty();
                record("Removed target " + action.name());
                yield "removed " + action.name();
            }
            case SET_CATEGORY -> {
                if (!ControlParser.isValidCategory(action.category())) {
                    yield "unknown category: " + action.category();
                }
                TargetEntry entry = core.targets().byName(action.name());
                if (entry == null) yield action.name() + " is not on any list";
                entry.setCategory(TargetCategory.fromKey(action.category()));
                core.markDirty();
                yield action.name() + " moved to " + entry.category().displayName();
            }
            case SET_PRIORITY -> {
                TargetEntry entry = core.targets().byName(action.name());
                if (entry == null) yield action.name() + " is not on any list";
                entry.setPriority(action.priority());
                core.markDirty();
                yield action.name() + " priority is now " + entry.priority();
            }
            case SET_NOTES -> {
                TargetEntry entry = core.targets().byName(action.name());
                if (entry == null) yield action.name() + " is not on any list";
                entry.setNotes(action.notes());
                core.markDirty();
                yield "notes updated for " + action.name();
            }
        };
    }

    @Override
    public String listTargets(String categoryKey) {
        HunterCore core = core();
        TargetCategory category = TargetCategory.fromKey(categoryKey);
        var entries = core.targets().byCategory(category);
        if (entries.isEmpty()) return category.displayName() + ": empty";
        StringBuilder sb = new StringBuilder(category.displayName()).append(" (")
            .append(entries.size()).append("): ");
        for (TargetEntry entry : entries) {
            sb.append(entry.effectiveName()).append("(prio ").append(entry.priority()).append(") ");
        }
        return sb.toString().trim();
    }

    @Override
    public String data(ControlAction.Data.Kind kind) {
        return switch (kind) {
            case RELOAD -> {
                core().load();
                yield "reloaded from disk";
            }
            case EXPORT -> export();
        };
    }

    @Override
    public void notify(String message) {
        HunterChat.info(message);
        core().recordEvent(CombatEvent.Kind.INFO, "Remote: " + message, "");
    }

    // -------------------------------------------------------------- helpers

    private String addTarget(String name, String categoryKey) {
        TargetCategory category = ControlParser.isValidCategory(categoryKey)
            ? TargetCategory.fromKey(categoryKey) : TargetCategory.PRIORITY;
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) {
            tracker.addTarget(name, category);
        } else {
            HunterCore core = core();
            TargetEntry entry = core.targets().byName(name);
            if (entry == null) core.targets().add(new TargetEntry(category, name));
            else entry.setCategory(category);
            core.markDirty();
        }
        record("Added target " + name + " (" + category.key() + ")");
        return "added " + name + " to " + category.displayName();
    }

    private String export() {
        HunterCore core = core();
        try {
            AtomicFiles.ensureDirectory(core.paths().root());
            var targets = core.paths().root().resolve("targets-export.csv");
            AtomicFiles.write(targets, TargetStore.toCsv(core.targets().all()));
            var stats = core.paths().root().resolve("statistics-export.json");
            AtomicFiles.write(stats, core.statistics().toJsonText());
            return "exported " + core.targets().size() + " targets to " + targets.getFileName()
                + " and statistics to " + stats.getFileName();
        } catch (java.io.IOException e) {
            return "export failed: " + e.getMessage();
        }
    }

    private String listProfiles() {
        HunterCore core = core();
        StringBuilder sb = new StringBuilder("profiles: ");
        String active = core.config().activeProfileName();
        for (String name : core.config().profiles().keySet()) {
            sb.append(name.equals(active) ? "*" : "").append(name).append(' ');
        }
        return sb.toString().trim();
    }

    private String listHud() {
        StringBuilder sb = new StringBuilder("hud: ");
        for (HudElement el : Hud.get()) {
            sb.append(el.info.name).append('=').append(el.isActive() ? "on" : "off").append(' ');
        }
        return sb.toString().trim();
    }

    private String status() {
        HunterCore core = core();
        var stats = core.statistics();
        var target = core.currentTarget();
        return "state=" + (core.config().emergencyStop() ? "emergency-stop" : core.running() ? "running" : "stopped")
            + " server=" + (core.serverAddress().isBlank() ? "-" : core.serverAddress())
            + " kills=" + stats.totalKills() + " deaths=" + stats.totalDeaths()
            + " tracked=" + core.targets().size()
            + " target=" + (target == null ? "none" : target.name());
    }

    private void applyProfile(HunterProfile profile) {
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) tracker.applyProfile(profile);
    }

    private void captureActiveProfile() {
        PlayerTrackerModule tracker = HunterRegistry.tracker();
        if (tracker != null) tracker.captureProfile(core().config().activeProfile());
    }

    private ModuleView viewOf(Module module) {
        boolean hunter = isHunterModule(module);
        List<SettingView> settings = new ArrayList<>();
        for (SettingGroup group : module.settings) {
            for (Setting<?> setting : group) settings.add(settingView(setting));
        }
        return new ModuleView(module.name, module.title, module.description, module.category.name,
            module.isActive(), hunter, settings);
    }

    private SettingView settingView(Setting<?> setting) {
        String type = typeOf(setting);
        String value = String.valueOf(setting.get());
        String defaultValue = String.valueOf(setting.getDefaultValue());
        double min = Double.NEGATIVE_INFINITY;
        double max = Double.POSITIVE_INFINITY;
        if (setting instanceof IntSetting intSetting) {
            min = intSetting.min;
            max = intSetting.max;
        } else if (setting instanceof DoubleSetting doubleSetting) {
            min = doubleSetting.min;
            max = doubleSetting.max;
        }
        List<String> suggestions = new ArrayList<>();
        for (String suggestion : setting.getSuggestions()) suggestions.add(suggestion);
        return new SettingView(setting.name, setting.title, setting.description, type, value,
            defaultValue, setting.wasChanged(), min, max, suggestions);
    }

    private static String typeOf(Setting<?> setting) {
        if (setting instanceof BoolSetting) return "boolean";
        if (setting instanceof IntSetting) return "integer";
        if (setting instanceof DoubleSetting) return "double";
        if (setting instanceof EnumSetting<?>) return "enum";
        if (setting instanceof StringSetting) return "string";
        return "other";
    }

    private Module findModule(String name) {
        if (name == null || name.isBlank()) return null;
        HunterModule hunter = HunterRegistry.find(name.toLowerCase(Locale.ROOT));
        if (hunter != null) return hunter;
        Module module = Modules.get().get(name);
        return module;
    }

    private HudElement findHud(String name) {
        if (name == null) return null;
        for (HudElement el : Hud.get()) {
            if (el.info.name.equalsIgnoreCase(name)) return el;
        }
        return null;
    }

    private static boolean isHunterModule(Module module) {
        for (HunterModule hunter : HunterRegistry.hunterModules()) {
            if (hunter == module) return true;
        }
        return false;
    }

    private static boolean isHunterElement(HudElement element) {
        return element.info.name.startsWith("logvex-");
    }

    private HunterCore core() {
        return HunterRuntime.get().core();
    }

    private static void record(String message) {
        HunterRuntime.get().core().recordEvent(CombatEvent.Kind.INFO, message, "remote");
    }

    /** Utility retained for symmetry with the text surface. */
    static String blankToDash(String value) {
        return Text.isBlank(value) ? "-" : value;
    }
}
