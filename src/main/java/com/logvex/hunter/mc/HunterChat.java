package com.logvex.hunter.mc;

import meteordevelopment.meteorclient.utils.player.ChatUtils;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

/**
 * All chat output for the addon goes through here.
 *
 * <p>Messages are local by default. When {@code sendToServer} is enabled they are also typed into
 * the server chat, which is what "respect server chat restrictions" guards: a server that mutes or
 * rate-limits chat never sees the notification unless the user explicitly asked for it.
 */
public final class HunterChat {
    private static final Minecraft mc = Minecraft.getInstance();

    private HunterChat() {}

    public static void info(String text) {
        ChatUtils.sendMsg(Component.literal("[Logvex] ").withStyle(ChatFormatting.LIGHT_PURPLE)
            .append(Component.literal(text).withStyle(ChatFormatting.GRAY)));
    }

    public static void warn(String text) {
        ChatUtils.sendMsg(Component.literal("[Logvex] ").withStyle(ChatFormatting.GOLD)
            .append(Component.literal(text).withStyle(ChatFormatting.YELLOW)));
    }

    public static void error(String text) {
        ChatUtils.sendMsg(Component.literal("[Logvex] ").withStyle(ChatFormatting.DARK_RED)
            .append(Component.literal(text).withStyle(ChatFormatting.RED)));
    }

    /** Sends a user-configured message locally, and optionally to the server. */
    public static void send(String text, boolean toServer) {
        if (text == null || text.isBlank()) return;
        info(text);
        if (toServer && mc.player != null && mc.getConnection() != null) {
            mc.getConnection().sendChat(text);
        }
    }
}
