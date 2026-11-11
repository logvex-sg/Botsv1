package com.logvex.worker.meteor;

import com.logvex.worker.core.WorkerSnapshot;
import java.util.Locale;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.WWidget;
import meteordevelopment.meteorclient.gui.widgets.containers.WVerticalList;

/**
 * Shows what this worker is doing right now and what it last did.
 *
 * <p>Purely a read-out of the shared snapshot: the current task, the last activity and its time, any
 * last error, and live EFly progress. Nothing here sends anything.
 */
public class TaskStatusModule extends FleetModule {
    private WLabel taskLabel;
    private WLabel activityLabel;
    private WLabel errorLabel;
    private WLabel eflyLabel;

    public TaskStatusModule() {
        super("task-status", "Shows the current task, last activity and any error for this worker.");
    }

    @Override
    public WWidget getWidget(GuiTheme theme) {
        WVerticalList list = theme.verticalList();
        taskLabel = list.add(theme.label("Task: idle")).expandX().widget();
        activityLabel = list.add(theme.label("Last activity: none")).expandX().widget();
        eflyLabel = list.add(theme.label("EFly: idle")).expandX().widget();
        errorLabel = list.add(theme.label("Last error: none")).expandX().widget();
        update();
        return list;
    }

    @Override
    public void refresh() {
        update();
    }

    private void update() {
        WorkerSnapshot snapshot = snapshot();
        if (taskLabel != null) {
            taskLabel.set("Task: " + (snapshot.currentTask.isEmpty() ? "idle" : snapshot.currentTask));
        }
        if (activityLabel != null) {
            activityLabel.set("Last activity: " + (snapshot.lastActivity.isEmpty() ? "none" : snapshot.lastActivity)
                + (snapshot.lastActivityAt > 0 ? " (" + age(snapshot.lastActivityAt) + " ago)" : ""));
        }
        if (eflyLabel != null) {
            eflyLabel.set("EFly: " + (snapshot.eflyActive ? snapshot.taskProgress : "idle"));
        }
        if (errorLabel != null) {
            errorLabel.set("Last error: " + (snapshot.lastError.isEmpty() ? "none" : snapshot.lastError));
        }
    }

    private static String age(long timestamp) {
        long seconds = Math.max(0, (System.currentTimeMillis() - timestamp) / 1000);
        if (seconds < 60) return seconds + "s";
        return String.format(Locale.ROOT, "%dm", seconds / 60);
    }

    @Override
    public String getInfoString() {
        String task = snapshot().currentTask;
        return task.isEmpty() ? "idle" : task;
    }
}
