package com.logvex.worker.mc;

import com.logvex.worker.core.CommandValidator;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.chat.Component;

/**
 * Sends a chat line or command through the client's own connection.
 *
 * <p>Nothing here builds packets: it calls {@code sendChat}/{@code sendCommand}, which is exactly
 * what typing in the chat box does, so server-side permission checks, anti-cheat and chat filters
 * all still apply. The input is validated first; a refused line is reported back rather than sent.
 */
public final class CommandSender {
    private CommandSender() {}

    /** Sends a {@code /command}. Returns null on success, or a reason it was refused. */
    public static String sendCommand(String command) {
        if (!CommandValidator.isValidCommand(command)) {
            return "command not allowed: '" + command + "'";
        }
        ClientPacketListener listener = connection();
        if (listener == null) return "not connected to a server";
        listener.sendCommand(command.trim());
        return null;
    }

    /** Sends a chat message. Returns null on success, or a reason it was refused. */
    public static String sendChat(String message) {
        if (!CommandValidator.isValidChat(message)) {
            return "message not allowed (empty, too long, or contains control characters)";
        }
        ClientPacketListener listener = connection();
        if (listener == null) return "not connected to a server";
        listener.sendChat(message.trim());
        return null;
    }

    /** Shows a local message in the client's chat, prefixed so the operator can tell it apart. */
    public static void localMessage(String text) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft == null || minecraft.gui == null) return;
        minecraft.gui.getChat().addMessage(Component.literal("[Logvex Worker] " + text));
    }

    private static ClientPacketListener connection() {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft == null || minecraft.player == null) return null;
        return minecraft.getConnection();
    }
}
