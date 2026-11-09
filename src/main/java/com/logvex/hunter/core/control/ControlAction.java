package com.logvex.hunter.core.control;

/**
 * A parsed control instruction, independent of both the chat command layer and the HTTP layer.
 *
 * <p>Both surfaces funnel through {@link ControlParser} so an action means exactly the same thing
 * whether it arrived as {@code .hunter set player-tracker range 96} or as a JSON request. Keeping
 * the vocabulary here (Minecraft-free) means it is fully unit-testable.
 */
public sealed interface ControlAction {
    /** Hunter lifecycle: start, stop, emergency stop, clear, pause, resume, save. */
    record Lifecycle(Kind kind) implements ControlAction {
        public enum Kind { START, STOP, EMERGENCY_STOP, CLEAR_STOP, PAUSE, RESUME, SAVE, STATUS }
    }

    /** Enable, disable or toggle a module by name; {@code enable} is null to toggle. */
    record ModuleToggle(String module, Boolean enable) implements ControlAction {}

    /** Read a module's settings, or the settings of every module when {@code module} is null. */
    record ModuleGet(String module) implements ControlAction {}

    /** Change one setting of a module. */
    record SettingSet(String module, String setting, String value) implements ControlAction {}

    /** List profiles, switch to one, or create/delete one. */
    record Profile(Kind kind, String name) implements ControlAction {
        public enum Kind { LIST, USE, CREATE, DELETE, SAVE }
    }

    /** List HUD elements or toggle one. */
    record Hud(String element, boolean list) implements ControlAction {}

    /** Focus a visible player, or clear the current target. */
    record Focus(String player) implements ControlAction {}

    /** Add, remove or re-tag a target; {@code priority} and {@code notes} are optional. */
    record Target(Op op, String name, String category, Integer priority, String notes) implements ControlAction {
        public enum Op { ADD, REMOVE, SET_CATEGORY, SET_PRIORITY, SET_NOTES }
    }

    /** Reload state from disk, or export it. */
    record Data(Kind kind) implements ControlAction {
        public enum Kind { RELOAD, EXPORT }
    }

    /** Show a local notification (used by the HTTP notify route). */
    record Notify(String message) implements ControlAction {}
}
