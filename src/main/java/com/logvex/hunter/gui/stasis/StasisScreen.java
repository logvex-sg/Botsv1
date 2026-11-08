package com.logvex.hunter.gui.stasis;

import com.logvex.hunter.core.stasis.StasisLevel;
import com.logvex.hunter.core.stasis.StasisMonitor;
import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.stasis.DefensiveStasisModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.containers.WTable;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.orbit.EventHandler;

/** Defensive stasis dashboard: readiness, reasons and the manual emergency controls. */
public class StasisScreen extends HunterScreen {
    private WLabel levelLabel;
    private WLabel readinessLabel;
    private WTable reasonsTable;

    public StasisScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Defensive Stasis");
    }

    @Override
    public void initWidgets() {
        add(theme.label("Readiness", true)).expandX();
        levelLabel = add(theme.label("")).expandX().widget();
        readinessLabel = add(theme.label("")).expandX().widget();
        readinessLabel.color = Color.LIGHT_GRAY;

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Reasons", true)).expandX();
        reasonsTable = add(theme.table()).expandX().widget();

        add(theme.horizontalSeparator()).expandX();
        var actions = add(theme.horizontalList()).expandX().widget();
        WButton disconnect = actions.add(theme.button("Emergency disconnect")).widget();
        disconnect.action = () -> {
            DefensiveStasisModule module = HunterRegistry.stasis();
            if (module != null) module.emergencyDisconnect();
        };
        WButton stopHunt = actions.add(theme.button("Emergency stop hunter")).widget();
        stopHunt.action = () -> {
            HunterRegistry.dashboard().emergencyStop();
            rebuild();
        };
        WButton clear = actions.add(theme.button("Clear stop")).widget();
        clear.action = () -> {
            HunterRegistry.dashboard().clearEmergencyStop();
            rebuild();
        };

        add(theme.label("Stasis is a monitoring system: it never attacks and never moves items.")
            ).expandX().widget().color = Color.GRAY;

        rebuild();
    }

    @EventHandler
    private void onTick(meteordevelopment.meteorclient.events.world.TickEvent.Post event) {
        rebuild();
    }

    private void rebuild() {
        if (levelLabel == null) return;
        DefensiveStasisModule module = HunterRegistry.stasis();
        if (module == null || !module.isActive()) {
            levelLabel.set("Module disabled");
            levelLabel.color = Color.GRAY;
            readinessLabel.set("");
            reasonsTable.clear();
            return;
        }

        StasisMonitor.Assessment assessment = module.assess();
        levelLabel.set("Level: " + assessment.level().displayName());
        levelLabel.color = switch (assessment.level()) {
            case SAFE -> Color.GREEN;
            case CAUTION -> Color.YELLOW;
            case DANGER -> Color.ORANGE;
            case CRITICAL -> Color.RED;
        };
        readinessLabel.set("Readiness score: " + module.readiness() + "%");

        reasonsTable.clear();
        if (assessment.reasons().isEmpty()) {
            reasonsTable.add(theme.label("No issues detected.")).expandCellX();
            reasonsTable.row();
            return;
        }
        for (String reason : assessment.reasons()) {
            reasonsTable.add(theme.label("- " + reason)).expandCellX();
            reasonsTable.row();
        }
    }
}
