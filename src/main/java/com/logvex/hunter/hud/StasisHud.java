package com.logvex.hunter.hud;

import com.logvex.hunter.core.stasis.StasisLevel;
import com.logvex.hunter.core.stasis.StasisMonitor;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.stasis.DefensiveStasisModule;
import meteordevelopment.meteorclient.systems.hud.Hud;
import meteordevelopment.meteorclient.systems.hud.HudElementInfo;
import meteordevelopment.meteorclient.systems.hud.HudRenderer;
import meteordevelopment.meteorclient.utils.render.color.Color;

import java.util.ArrayList;
import java.util.List;

/** Shows the defensive stasis level, readiness score and the reasons behind them. */
public class StasisHud extends HunterHudElement {
    public static final HudElementInfo<StasisHud> INFO = new HudElementInfo<>(
        Hud.GROUP, "logvex-stasis", "Logvex Stasis", "Shows defensive readiness and danger reasons.",
        StasisHud::new);

    public StasisHud() {
        super(INFO);
    }

    @Override
    public void render(HudRenderer renderer) {
        DefensiveStasisModule module = HunterRegistry.stasis();
        beginBlock();
        if (module == null || !module.isActive()) {
            if (isInEditor()) renderBlock(renderer, "Stasis", List.of("module disabled"), Color.GRAY);
            return;
        }

        StasisMonitor.Assessment assessment = module.assess();
        lines.add("Readiness: " + module.readiness() + "%");
        for (String reason : assessment.reasons()) lines.add("- " + reason);

        Color titleColor = switch (assessment.level()) {
            case SAFE -> Color.GREEN;
            case CAUTION -> Color.YELLOW;
            case DANGER -> Color.ORANGE;
            case CRITICAL -> Color.RED;
        };
        renderBlock(renderer, "Stasis: " + assessment.level().displayName(), lines, titleColor);
    }
}
