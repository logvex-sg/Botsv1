package com.logvex.hunter.gui;

import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.tabs.Tab;
import meteordevelopment.meteorclient.gui.tabs.TabScreen;
import net.minecraft.client.gui.screens.Screen;

/** The addon's tab in Meteor's ClickGUI, opening the Hunter Dashboard. */
public class HunterTab extends Tab {
    public HunterTab() {
        super("Logvex Hunter");
    }

    @Override
    public TabScreen createScreen(GuiTheme theme) {
        return new DashboardScreen(theme, this);
    }

    @Override
    public boolean isScreen(Screen screen) {
        return screen instanceof DashboardScreen;
    }
}
