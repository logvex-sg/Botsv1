package com.logvex.worker.meteor;

import com.logvex.worker.core.WorkerConfig;
import com.logvex.worker.core.WorkerSnapshot;
import java.util.List;
import java.util.Locale;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.WWidget;
import meteordevelopment.meteorclient.gui.widgets.containers.WVerticalList;

/**
 * Identity and live state of this worker, plus the in-game event log.
 *
 * <p>Everything the host shows about a worker is visible here too: id, name, server, coordinates,
 * health, connection state, and the recent event lines the runtime has recorded.
 */
public class WorkerInformationModule extends FleetModule {
    private WLabel identityLabel;
    private WLabel stateLabel;
    private WLabel positionLabel;
    private WLabel healthLabel;
    private WLabel logLabel;

    public WorkerInformationModule() {
        super("worker-information", "Shows this worker's identity, live state and recent events.");
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        WVerticalList list = theme.verticalList();
        identityLabel = list.add(theme.label("Worker: -")).expandX().widget();
        stateLabel = list.add(theme.label("State: -")).expandX().widget();
        positionLabel = list.add(theme.label("Position: -")).expandX().widget();
        healthLabel = list.add(theme.label("Health: -")).expandX().widget();
        logLabel = list.add(theme.label("No events yet.")).expandX().widget();
        update();
        return list;
    }

    @Override
    public void refresh() {
        update();
    }

    private void update() {
        WorkerConfig config = runtime().config();
        WorkerSnapshot snapshot = snapshot();

        String id = config == null || config.workerId.isBlank() ? "(derived)" : config.workerId;
        String name = config == null || config.label.isBlank() ? snapshot.username : config.label;
        if (identityLabel != null) {
            identityLabel.set("Worker: " + name + "  [" + id + "]");
        }
        if (stateLabel != null) {
            stateLabel.set("State: " + connectionLabel()
                + (snapshot.serverAddress.isEmpty() ? "" : "  @ " + snapshot.serverAddress));
        }
        if (positionLabel != null) {
            positionLabel.set(snapshot.inWorld
                ? String.format(Locale.ROOT, "Position: %.0f %.0f %.0f (%s)", snapshot.x, snapshot.y, snapshot.z, snapshot.dimension)
                : "Position: not in a world");
        }
        if (healthLabel != null) {
            healthLabel.set(snapshot.inWorld
                ? String.format(Locale.ROOT, "Health: %.0f/%.0f  Food: %d  Totems: %d  Free slots: %d",
                    snapshot.health, snapshot.maxHealth, snapshot.food, snapshot.totems, snapshot.freeSlots)
                : "Health: -");
        }
        if (logLabel != null) {
            List<String> events = runtime().recentEvents();
            int from = Math.max(0, events.size() - 5);
            StringBuilder text = new StringBuilder();
            for (int i = from; i < events.size(); i++) {
                if (text.length() > 0) text.append('\n');
                text.append(events.get(i));
            }
            logLabel.set(text.length() == 0 ? "No events yet." : text.toString());
        }
    }

    @Override
    public String getInfoString() {
        WorkerSnapshot snapshot = snapshot();
        return snapshot.inWorld ? snapshot.username : connectionLabel();
    }
}
