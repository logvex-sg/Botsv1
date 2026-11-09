package com.logvex.hunter.core.control;

import java.util.List;

/**
 * Parses a control line and dispatches it to a {@link ControlTarget}.
 *
 * <p>This is the single entry point both the in-game {@code .hunter} command and the companion HTTP
 * {@code command} route call, which guarantees a remote client and the local player can do exactly
 * the same things. The class is Minecraft-free; the game layer supplies the target.
 */
public final class ControlService {
    private final ControlTarget target;

    public ControlService(ControlTarget target) {
        this.target = target;
    }

    /** Parses and runs a control line, returning a human-readable result (never null). */
    public String run(String line) {
        ControlAction action = ControlParser.parse(line);
        if (action == null) {
            return "unrecognised command: " + (line == null ? "" : line.trim());
        }
        return execute(action);
    }

    /** Runs an already-parsed action. */
    public String execute(ControlAction action) {
        return switch (action) {
            case ControlAction.Lifecycle lifecycle -> target.lifecycle(lifecycle.kind());
            case ControlAction.ModuleToggle toggle -> target.setModule(toggle.module(), toggle.enable());
            case ControlAction.ModuleGet get -> describeModules(target.modules(get.module()));
            case ControlAction.SettingSet set -> target.setSetting(set.module(), set.setting(), set.value());
            case ControlAction.Profile profile -> target.profile(profile.kind(), profile.name());
            case ControlAction.Hud hud -> target.hud(hud.element(), hud.list());
            case ControlAction.Focus focus -> target.focus(focus.player());
            case ControlAction.Target t -> target.target(t);
            case ControlAction.TargetList list -> target.listTargets(list.category());
            case ControlAction.Data data -> target.data(data.kind());
            case ControlAction.Notify notify -> {
                target.notify(notify.message());
                yield "notified";
            }
        };
    }

    /** Renders module views as compact text lines (used by the chat command). */
    private static String describeModules(List<ModuleView> modules) {
        if (modules == null || modules.isEmpty()) return "no matching modules";
        StringBuilder sb = new StringBuilder();
        for (ModuleView module : modules) {
            sb.append(module.name()).append(' ').append(module.enabled() ? "on" : "off")
                .append(" (").append(module.settings().size()).append(" settings): ");
            for (SettingView setting : module.settings()) {
                sb.append(setting.name()).append('=').append(setting.value()).append(' ');
            }
            sb.append('\n');
        }
        return sb.toString().trim();
    }
}
