package com.logvex.hunter.core.control;

import java.util.List;

/**
 * The operations the control layer can perform on the running client.
 *
 * <p>{@link ControlService} parses a line into a {@link ControlAction} and dispatches it here. The
 * interface is deliberately narrow and Minecraft-free so the whole dispatch table can be unit-tested
 * with a stub, while the game layer supplies the real implementation (which reads and mutates Meteor
 * state on the client thread).
 *
 * <p>Implementations must never throw for an ordinary user mistake: return a human-readable message
 * describing what happened instead.
 */
public interface ControlTarget {
    /** Runs a lifecycle transition (start/stop/emergency stop/clear/pause/resume/save/status). */
    String lifecycle(ControlAction.Lifecycle.Kind kind);

    /** Enables, disables or (when {@code enable} is null) toggles a module. */
    String setModule(String module, Boolean enable);

    /** Reads a module's settings, or every module's settings when {@code module} is null. */
    List<ModuleView> modules(String module);

    /** Changes one setting of one module. */
    String setSetting(String module, String setting, String value);

    /** Lists profiles, or performs a profile operation. */
    String profile(ControlAction.Profile.Kind kind, String name);

    /** Lists profiles as views (used by the HTTP surface). */
    List<ProfileView> profiles();

    /** Lists HUD elements, or toggles one when {@code element} is non-null. */
    String hud(String element, boolean list);

    /** Lists HUD elements as views. */
    List<HudView> hudViews();

    /** Focuses a visible player, or clears the current target when {@code player} is null. */
    String focus(String player);

    /** Applies a target-list edit. */
    String target(ControlAction.Target action);

    /** Lists the targets in one category (or the default category when {@code category} is null). */
    String listTargets(String category);

    /** Reloads state from disk, or exports it. */
    String data(ControlAction.Data.Kind kind);

    /** Shows a local notification. */
    void notify(String message);
}
