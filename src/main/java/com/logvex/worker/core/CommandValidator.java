package com.logvex.worker.core;

import java.util.Locale;
import java.util.Set;

/**
 * Validates a chat line or command before it is handed to the client.
 *
 * <p>The worker only ever sends a string to the server through the client's own command path; it
 * never builds packets itself. This validator blocks the two ways that could still go wrong: a
 * newline (which could smuggle a second line into a protocol that only expected one) and a command
 * whose verb is not on the allowlist.
 */
public final class CommandValidator {
    private CommandValidator() {}

    /** Verbs that may be sent as {@code /verb ...}. */
    private static final Set<String> ALLOWED_COMMANDS = Set.of(
        "help", "list", "msg", "tell", "w", "r", "reply", "me", "say",
        "spawn", "home", "sethome", "delhome", "tpa", "tpaccept", "tpdeny", "tpahere",
        "back", "sit", "lay", "ptime", "pweather", "near", "ping", "tps", "who", "seen",
        "kit", "kits", "warp", "warps", "balance", "bal", "pay", "money", "baltop",
        "shop", "ah", "auction", "mail", "ignore", "unignore", "friend", "party", "team",
        "clan", "guild", "vote", "reward", "daily", "claim", "sell", "buy", "craft",
        "ec", "enderchest", "pv", "workbench", "anvil", "repair", "hat", "nick",
        "island", "plot", "pvp", "wild", "rtp", "trust", "untrust"
    );

    /** Characters that must never appear: they would let one line become two. */
    private static boolean hasControlChars(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\n' || c == '\r' || c == '\u0000') return true;
        }
        return false;
    }

    public static boolean isValidChat(String message) {
        if (message == null || message.isBlank()) return false;
        if (message.length() > 256) return false;
        return !hasControlChars(message);
    }

    /**
     * Validates a server command.
     *
     * @param command the text after the leading slash, e.g. {@code spawn}
     */
    public static boolean isValidCommand(String command) {
        if (command == null || command.isBlank()) return false;
        if (command.length() > 256) return false;
        if (hasControlChars(command)) return false;
        String verb = command.trim().split("\\s+")[0].toLowerCase(Locale.ROOT);
        return ALLOWED_COMMANDS.contains(verb);
    }

    /** The allowlist, reported to the host so its UI can offer only valid verbs. */
    public static Set<String> allowedCommands() {
        return ALLOWED_COMMANDS;
    }
}
