package com.logvex.hunter.modules;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.mc.HunterRuntime;
import meteordevelopment.meteorclient.systems.modules.Category;
import meteordevelopment.meteorclient.systems.modules.Module;

/** Base class for the addon's modules. Provides the shared runtime and core accessors. */
public abstract class HunterModule extends Module {
    protected HunterModule(Category category, String name, String description, String... aliases) {
        super(category, name, description, aliases);
    }

    protected HunterRuntime runtime() {
        return HunterRuntime.get();
    }

    protected HunterCore core() {
        return HunterRuntime.get().core();
    }

    /**
     * Announces this module's own state change on the core bus.
     *
     * <p>Subclasses that override the lifecycle must call {@code super.onActivate()} /
     * {@code super.onDeactivate()} so the change is reported once, in one place. The core forwards it
     * to Meteor's bus for any listener that cares.
     */
    @Override
    public void onActivate() {
        HunterRuntime.get().core().publish(new HunterEvents.ModuleStateChanged(name, true, false));
    }

    @Override
    public void onDeactivate() {
        HunterRuntime.get().core().publish(new HunterEvents.ModuleStateChanged(name, false, false));
    }

    /** Called on emergency stop: every module must be able to release whatever it holds. */
    public void onEmergencyStop() {
        if (isActive()) disable();
    }
}
