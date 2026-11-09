package com.logvex.hunter.command;

import com.logvex.hunter.core.swarm.SwarmPeer;
import com.logvex.hunter.gui.swarm.SwarmScreen;
import com.logvex.hunter.modules.HunterRegistry;
import com.logvex.hunter.modules.swarm.SwarmModule;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import meteordevelopment.meteorclient.commands.Command;
import meteordevelopment.meteorclient.gui.GuiThemes;
import net.minecraft.commands.SharedSuggestionProvider;

/**
 * Controls the in-game swarm: {@code .swarm <host|join|connections|send|broadcast|kick|status|gui>}.
 *
 * <p>The host runs the same verbs on its own client that it sends to workers, so a command that works
 * here works on a worker too. Broadcasts that would arm combat on the whole fleet are refused unless
 * {@code allow-combat-broadcast} is on.
 */
public class SwarmCommand extends Command {
    public SwarmCommand() {
        super("swarm", "Controls other LogVex Hunter clients from one host.", "logvexswarm");
    }

    @Override
    public void build(LiteralArgumentBuilder<SharedSuggestionProvider> builder) {
        builder.executes(context -> {
            status();
            return SINGLE_SUCCESS;
        });

        builder.then(literal("status").executes(context -> {
            status();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("gui").executes(context -> {
            mc.setScreen(new SwarmScreen(GuiThemes.get(), null));
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("host").executes(context -> {
            SwarmModule module = module();
            if (module == null) {
                error("Swarm module is not registered.");
                return SINGLE_SUCCESS;
            }
            module.setMode(SwarmModule.Mode.HOST);
            if (!module.isActive()) module.enable();
            module.start();
            info("Swarm host started on port %d.", module.boundPort());
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("join")
            .then(argument("ip", StringArgumentType.string())
                .then(argument("port", IntegerArgumentType.integer(1, 65535))
                    .executes(context -> {
                        SwarmModule module = module();
                        if (module == null) {
                            error("Swarm module is not registered.");
                            return SINGLE_SUCCESS;
                        }
                        String ip = StringArgumentType.getString(context, "ip");
                        int port = IntegerArgumentType.getInteger(context, "port");
                        core().config().setSwarmWorkerHost(ip);
                        core().config().setSwarmWorkerPort(port);
                        core().markDirty();
                        module.setMode(SwarmModule.Mode.WORKER);
                        if (!module.isActive()) module.enable();
                        module.start();
                        info("Swarm worker connecting to %s:%d.", ip, port);
                        return SINGLE_SUCCESS;
                    })))
        );

        builder.then(literal("stop").executes(context -> {
            SwarmModule module = module();
            if (module == null) return SINGLE_SUCCESS;
            module.stop();
            info("Swarm link stopped.");
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("connections").executes(context -> {
            SwarmModule module = module();
            if (module == null) return SINGLE_SUCCESS;
            info(module.describeRoster());
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("send")
            .then(argument("worker", StringArgumentType.word())
                .then(argument("command", StringArgumentType.greedyString())
                    .executes(context -> {
                        SwarmModule module = module();
                        if (module == null) return SINGLE_SUCCESS;
                        String worker = StringArgumentType.getString(context, "worker");
                        String command = StringArgumentType.getString(context, "command");
                        String error = module.sendTo(worker, command);
                        if (error != null) error("%s", error);
                        return SINGLE_SUCCESS;
                    })))
        );

        builder.then(literal("broadcast")
            .then(argument("command", StringArgumentType.greedyString())
                .executes(context -> {
                    SwarmModule module = module();
                    if (module == null) return SINGLE_SUCCESS;
                    info(module.broadcast(StringArgumentType.getString(context, "command")));
                    return SINGLE_SUCCESS;
                }))
        );

        builder.then(literal("kick")
            .then(argument("worker", StringArgumentType.word())
                .executes(context -> {
                    SwarmModule module = module();
                    if (module == null) return SINGLE_SUCCESS;
                    String worker = StringArgumentType.getString(context, "worker");
                    if (module.kick(worker)) info("Disconnected %s.", worker);
                    else error("No worker matches '%s'.", worker);
                    return SINGLE_SUCCESS;
                }))
        );

        builder.then(literal("token")
            .then(argument("token", StringArgumentType.greedyString())
                .executes(context -> {
                    String token = StringArgumentType.getString(context, "token");
                    core().config().setSwarmHostToken(token);
                    core().markDirty();
                    info("Swarm token set. Workers must present the same token.");
                    return SINGLE_SUCCESS;
                }))
        );

        builder.then(literal("port")
            .then(argument("port", IntegerArgumentType.integer(1, 65535))
                .executes(context -> {
                    int port = IntegerArgumentType.getInteger(context, "port");
                    core().config().setSwarmHostPort(port);
                    core().config().setSwarmWorkerPort(port);
                    core().markDirty();
                    SwarmModule module = module();
                    if (module != null && module.isActive()) module.start();
                    info("Swarm port set to %d.", port);
                    return SINGLE_SUCCESS;
                }))
        );
    }

    private void status() {
        SwarmModule module = module();
        if (module == null) {
            error("Swarm module is not registered.");
            return;
        }
        info("Mode: %s  Active: %s", module.mode().name().toLowerCase(java.util.Locale.ROOT),
            module.isActive() ? "yes" : "no");
        for (String line : module.statusLines()) info("%s", line);
        if (module.mode() == SwarmModule.Mode.HOST) {
            for (SwarmPeer peer : module.roster().peers()) {
                info(" - %s [%s] %s", peer.label(), peer.address(), peer.status());
            }
        }
    }

    private SwarmModule module() {
        return HunterRegistry.swarm();
    }

    private com.logvex.hunter.core.HunterCore core() {
        return com.logvex.hunter.mc.HunterRuntime.get().core();
    }
}
