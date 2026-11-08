package com.logvex.hunter.gui.instances;

import com.logvex.hunter.gui.HunterScreen;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.instances.CompanionModule;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.widgets.WLabel;
import meteordevelopment.meteorclient.gui.widgets.pressable.WButton;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.orbit.EventHandler;

/** Companion endpoint dashboard: state, token, connection details and manual controls. */
public class CompanionScreen extends HunterScreen {
    private WLabel stateLabel;
    private WLabel endpointLabel;
    private WLabel tokenLabel;

    public CompanionScreen(GuiTheme theme, net.minecraft.client.gui.screens.Screen parent) {
        super(theme, "Companion");
    }

    @Override
    public void initWidgets() {
        add(theme.label("Companion endpoint", true)).expandX();
        stateLabel = add(theme.label("")).expandX().widget();
        endpointLabel = add(theme.label("")).expandX().widget();
        endpointLabel.color = Color.LIGHT_GRAY;

        add(theme.horizontalSeparator()).expandX();
        add(theme.label("Fleet Manager connection", true)).expandX();
        add(theme.label("Endpoint")).expandX();
        tokenLabel = add(theme.label("")).expandX().widget();
        tokenLabel.color = Color.YELLOW;

        add(theme.horizontalSeparator()).expandX();
        var controls = add(theme.horizontalList()).expandX().widget();
        WButton enable = controls.add(theme.button("Enable")).widget();
        enable.action = () -> {
            CompanionModule module = HunterRegistry.companion();
            if (module != null && !module.isActive()) module.enable();
            rebuild();
        };
        WButton disable = controls.add(theme.button("Disable")).widget();
        disable.action = () -> {
            CompanionModule module = HunterRegistry.companion();
            if (module != null && module.isActive()) module.disable();
            rebuild();
        };
        WButton regenerate = controls.add(theme.button("Regenerate token")).widget();
        regenerate.action = () -> {
            CompanionModule module = HunterRegistry.companion();
            if (module != null) module.regenerateToken();
            rebuild();
        };

        add(theme.label("Serves read-only state and the same commands as .hunter, only while running.")
            ).expandX().widget().color = Color.GRAY;
        add(theme.label("The socket stays on loopback unless remote access is enabled.")
            ).expandX().widget().color = Color.GRAY;

        rebuild();
    }

    @EventHandler
    private void onTick(meteordevelopment.meteorclient.events.world.TickEvent.Post event) {
        rebuild();
    }

    private void rebuild() {
        if (stateLabel == null) return;
        CompanionModule module = HunterRegistry.companion();
        boolean active = module != null && module.isActive();
        boolean listening = module != null && module.running();

        stateLabel.set(listening ? "Listening" : active ? "Enabled (waiting for hunter)" : "Disabled");
        stateLabel.color = listening ? Color.GREEN : active ? Color.YELLOW : Color.GRAY;

        int port = core().config().companionPort();
        String host = core().config().companionAllowRemote() ? "<this-machine-ip>" : "127.0.0.1";
        String endpoint = "http://" + host + ":" + port;
        endpointLabel.set(endpoint
            + (core().config().companionAllowRemote() ? "  (remote access enabled)" : "  (loopback only)"));

        String token = core().config().companionToken();
        tokenLabel.set("Token: " + (token.isBlank() ? "(generated when the endpoint starts)" : token));
    }
}
