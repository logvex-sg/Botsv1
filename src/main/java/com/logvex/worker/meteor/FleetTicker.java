package com.logvex.worker.meteor;

import com.logvex.worker.mc.EflyExecutor;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.orbit.EventHandler;

/**
 * Keeps the shared snapshot warm.
 *
 * <p>Every Fleet Manager HUD and widget reads {@link FleetRuntime#snapshot()} instead of querying the
 * game, so exactly one place has to touch the client per refresh. This ticks that refresh at a slow
 * cadence (twice a second) rather than once per frame, which is what keeps the modules cheap: the
 * cost of the status read is paid at a fixed low rate no matter how many views are open.
 */
public final class FleetTicker {
    private static final int REFRESH_INTERVAL_TICKS = 10;

    private int ticks;

    @EventHandler
    private void onTick(TickEvent.Post event) {
        EflyExecutor.samplePosition();
        if (++ticks >= REFRESH_INTERVAL_TICKS) {
            ticks = 0;
            FleetRuntime.get().refreshSnapshot();
            for (FleetModule module : FleetModules.all()) {
                if (module.isActive()) module.refresh();
            }
        }
    }
}
