package com.logvex.worker.meteor;

import com.logvex.worker.WorkerMod;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import meteordevelopment.meteorclient.MeteorClient;
import meteordevelopment.meteorclient.systems.modules.Modules;

/**
 * Registers the Fleet Manager modules.
 *
 * <p>Kept as a list so the registry can answer "which modules are mine" without reflecting over the
 * category, which the ticker and commands need.
 */
public final class FleetModules {
    private static final List<FleetModule> MODULES = new ArrayList<>();

    private FleetModules() {}

    public static synchronized void register() {
        if (!MODULES.isEmpty()) return;
        FleetRuntime runtime = FleetRuntime.get();
        MeteorClient.EVENT_BUS.subscribe(new FleetTicker());

        add(runtime, new WorkerConnectionModule());
        add(runtime, new RemoteControlModule());
        add(runtime, new InventoryMonitorModule());
        add(runtime, new ItemCounterModule());
        add(runtime, new EquipmentManagerModule());
        add(runtime, new RegearManagerModule());
        add(runtime, new EflyControllerModule());
        add(runtime, new TaskStatusModule());
        add(runtime, new WorkerInformationModule());

        WorkerMod.LOG.info("Registered {} Fleet Manager modules", MODULES.size());
    }

    private static <T extends FleetModule> void add(FleetRuntime runtime, T module) {
        Modules.get().add(module);
        MODULES.add(module);
    }

    public static List<FleetModule> all() {
        return Collections.unmodifiableList(MODULES);
    }
}
