package com.logvex.worker.meteor;

import com.logvex.worker.WorkerMod;
import meteordevelopment.meteorclient.addons.MeteorAddon;
import meteordevelopment.meteorclient.systems.modules.Category;
import meteordevelopment.meteorclient.systems.modules.Modules;

/**
 * Meteor entry point for the Logvex Worker.
 *
 * <p>The worker is one mod with two jobs: it dials out to the Fleet Manager host (started by
 * {@link com.logvex.worker.WorkerMod}) and it exposes the same connection through Meteor so an
 * operator can see and drive it from the ClickGUI. This addon registers a single {@code Fleet
 * Manager} category; every control lives in a module in that category, so there is no second
 * configuration system — the modules read and write the one {@link FleetRuntime}.
 */
public class FleetAddon extends MeteorAddon {
    /** The ClickGUI category every Fleet Manager module belongs to. */
    public static final Category CATEGORY = new Category("Fleet Manager");

    @Override
    public void onInitialize() {
        WorkerMod.LOG.info("Initialising Fleet Manager Meteor integration");
        FleetRuntime.get().setLogSink(WorkerMod.LOG::info);
        FleetModules.register();
    }

    @Override
    public void onRegisterCategories() {
        Modules.registerCategory(CATEGORY);
    }

    @Override
    public String getPackage() {
        return "com.logvex.worker";
    }
}
