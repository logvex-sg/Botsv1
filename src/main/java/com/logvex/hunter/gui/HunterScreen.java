package com.logvex.hunter.gui;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import meteordevelopment.meteorclient.gui.GuiTheme;
import meteordevelopment.meteorclient.gui.WindowScreen;

/** Base class for the addon's secondary screens. Gives access to the core and a common helper set. */
public abstract class HunterScreen extends WindowScreen {
    protected static final net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();

    protected HunterScreen(GuiTheme theme, String title) {
        super(theme, title);
    }

    protected HunterCore core() {
        return HunterRuntime.get().core();
    }

    /** Saves everything and reports the outcome in chat. */
    protected void saveAll() {
        String error = core().saveAll();
        if (error != null) HunterChat.error(error);
        else HunterChat.info("Saved.");
    }
}
