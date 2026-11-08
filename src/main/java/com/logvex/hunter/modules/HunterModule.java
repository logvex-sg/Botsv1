package com.logvex.hunter.modules;

import com.logvex.hunter.core.HunterCore;
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

    /** Called on emergency stop: every module must be able to release whatever it holds. */
    public void onEmergencyStop() {
        if (isActive()) disable();
    }
}
