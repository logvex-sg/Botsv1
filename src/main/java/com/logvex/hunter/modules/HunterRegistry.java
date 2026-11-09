package com.logvex.hunter.modules;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.combat.CombatCoordinatorModule;
import com.logvex.hunter.modules.dashboard.HunterDashboardModule;
import com.logvex.hunter.modules.equipment.EquipmentManagerModule;
import com.logvex.hunter.modules.instances.CompanionModule;
import com.logvex.hunter.modules.instances.InstanceManagerModule;
import com.logvex.hunter.modules.messages.NotificationModule;
import com.logvex.hunter.modules.stasis.DefensiveStasisModule;
import com.logvex.hunter.modules.stats.StatisticsModule;
import com.logvex.hunter.modules.swarm.SwarmModule;
import com.logvex.hunter.modules.target.PlayerTrackerModule;
import meteordevelopment.meteorclient.systems.modules.Modules;

import java.util.ArrayList;
import java.util.List;

/** Holds the addon's module instances and registers them with Meteor. */
public final class HunterRegistry {
    private static final List<HunterModule> MODULES = new ArrayList<>();

    private static HunterDashboardModule dashboard;
    private static PlayerTrackerModule tracker;
    private static CombatCoordinatorModule combat;
    private static EquipmentManagerModule equipment;
    private static DefensiveStasisModule stasis;
    private static NotificationModule notifications;
    private static InstanceManagerModule instances;
    private static CompanionModule companion;
    private static SwarmModule swarm;
    private static StatisticsModule statistics;

    private HunterRegistry() {}

    public static void register() {
        if (!MODULES.isEmpty()) return;

        dashboard = add(new HunterDashboardModule());
        tracker = add(new PlayerTrackerModule());
        combat = add(new CombatCoordinatorModule());
        equipment = add(new EquipmentManagerModule());
        stasis = add(new DefensiveStasisModule());
        notifications = add(new NotificationModule());
        instances = add(new InstanceManagerModule());
        companion = add(new CompanionModule());
        swarm = add(new SwarmModule());
        statistics = add(new StatisticsModule());

        HunterRuntime.get().core().setActiveModuleCountSupplier(HunterRegistry::activeCount);
    }

    private static <T extends HunterModule> T add(T module) {
        Modules.get().add(module);
        MODULES.add(module);
        return module;
    }

    public static List<HunterModule> hunterModules() {
        return new ArrayList<>(MODULES);
    }

    public static HunterModule find(String name) {
        for (HunterModule module : MODULES) {
            if (module.name.equals(name)) return module;
        }
        return null;
    }

    public static <T extends HunterModule> T get(Class<T> type) {
        for (HunterModule module : MODULES) {
            if (type.isInstance(module)) return type.cast(module);
        }
        return null;
    }

    public static int activeCount() {
        int count = 0;
        for (HunterModule module : MODULES) {
            if (module.isActive()) count++;
        }
        return count;
    }

    public static HunterDashboardModule dashboard() {
        return dashboard;
    }

    public static PlayerTrackerModule tracker() {
        return tracker;
    }

    public static CombatCoordinatorModule combat() {
        return combat;
    }

    public static EquipmentManagerModule equipment() {
        return equipment;
    }

    public static DefensiveStasisModule stasis() {
        return stasis;
    }

    public static NotificationModule notifications() {
        return notifications;
    }

    public static InstanceManagerModule instances() {
        return instances;
    }

    public static CompanionModule companion() {
        return companion;
    }

    public static SwarmModule swarm() {
        return swarm;
    }

    public static StatisticsModule statistics() {
        return statistics;
    }

    /** Disables every module of the addon. Used by the emergency stop. */
    public static void disableAll() {
        for (HunterModule module : MODULES) {
            if (module.isActive()) module.disable();
        }
    }

    public static HunterCore core() {
        return HunterRuntime.get().core();
    }
}
