package com.logvex.hunter.companion;

import com.logvex.hunter.core.control.ControlService;

/**
 * The administrative commands the companion endpoint can invoke.
 *
 * <p>This is now a thin wrapper: it builds a {@link ControlService} over the game-layer
 * {@link MinecraftControlTarget} and runs the line through it. The chat command surface uses the
 * same service, so the two can never drift apart.
 *
 * <p>Every command runs on the client thread (the caller marshals it there) and only touches the
 * addon's own state: it never sends chat to the server, never attacks and never moves the player.
 * This is what keeps a remote dashboard from turning into unattended automation.
 */
public final class CompanionCommands {
    private CompanionCommands() {}

    public static String run(String command) {
        return new ControlService(new MinecraftControlTarget()).run(command);
    }
}
