package com.logvex.hunter.command;

import com.logvex.hunter.companion.MinecraftControlTarget;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.control.ControlAction;
import com.logvex.hunter.core.control.ModuleView;
import com.logvex.hunter.core.control.SettingView;
import com.logvex.hunter.core.util.Time;
import com.logvex.hunter.gui.DashboardScreen;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import com.logvex.hunter.modules.HunterRegistry;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import meteordevelopment.meteorclient.commands.Command;
import meteordevelopment.meteorclient.commands.arguments.ModuleArgumentType;
import meteordevelopment.meteorclient.gui.GuiThemes;
import meteordevelopment.meteorclient.systems.modules.Module;
import net.minecraft.commands.SharedSuggestionProvider;


/** The main addon command: {@code .hunter <status|start|stop|...>}. */
public class HunterCommand extends Command {
    public HunterCommand() {
        super("hunter", "Controls the Logvex Hunter addon.", "logvex");
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

        builder.then(literal("start").executes(context -> {
            HunterRegistry.dashboard().start();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("stop").executes(context -> {
            HunterRegistry.dashboard().stop();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("emergency-stop").executes(context -> {
            HunterRegistry.dashboard().emergencyStop();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("clear-stop").executes(context -> {
            HunterRegistry.dashboard().clearEmergencyStop();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("pause").executes(context -> {
            info(control().lifecycle(ControlAction.Lifecycle.Kind.PAUSE));
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("resume").executes(context -> {
            info(control().lifecycle(ControlAction.Lifecycle.Kind.RESUME));
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("gui").executes(context -> {
            mc.setScreen(new DashboardScreen(GuiThemes.get(), null));
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("control").executes(context -> {
            mc.setScreen(new com.logvex.hunter.gui.control.ControlScreen(GuiThemes.get(), null));
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("save").executes(context -> {
            String error = core().saveAll();
            if (error != null) error("Save failed: %s", error);
            else info("Saved.");
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("modules").executes(context -> {
            for (HunterModule module : HunterRegistry.hunterModules()) {
                info("%s: %s", module.title, module.isActive() ? "on" : "off");
            }
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("toggle")
            .then(argument("module", ModuleArgumentType.create()).executes(context -> {
                Module module = ModuleArgumentType.get(context);
                module.toggle();
                info("%s is now %s.", module.title, module.isActive() ? "on" : "off");
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("profile").executes(context -> {
            info("Active profile: %s", core().config().activeProfileName());
            for (String name : core().config().profiles().keySet()) info(" - %s", name);
            return SINGLE_SUCCESS;
        })
            .then(literal("use")
                .then(argument("name", com.mojang.brigadier.arguments.StringArgumentType.word())
                    .executes(context -> {
                        info(control().profile(ControlAction.Profile.Kind.USE,
                            com.mojang.brigadier.arguments.StringArgumentType.getString(context, "name")));
                        return SINGLE_SUCCESS;
                    })))
            .then(literal("create")
                .then(argument("name", com.mojang.brigadier.arguments.StringArgumentType.word())
                    .executes(context -> {
                        info(control().profile(ControlAction.Profile.Kind.CREATE,
                            com.mojang.brigadier.arguments.StringArgumentType.getString(context, "name")));
                        return SINGLE_SUCCESS;
                    })))
            .then(literal("delete")
                .then(argument("name", com.mojang.brigadier.arguments.StringArgumentType.word())
                    .executes(context -> {
                        info(control().profile(ControlAction.Profile.Kind.DELETE,
                            com.mojang.brigadier.arguments.StringArgumentType.getString(context, "name")));
                        return SINGLE_SUCCESS;
                    })))
            .then(literal("save").executes(context -> {
                info(control().profile(ControlAction.Profile.Kind.SAVE, null));
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("set")
            .then(argument("module", com.mojang.brigadier.arguments.StringArgumentType.word())
                .then(argument("setting", com.mojang.brigadier.arguments.StringArgumentType.word())
                    .then(argument("value", com.mojang.brigadier.arguments.StringArgumentType.greedyString())
                        .executes(context -> {
                            String module = com.mojang.brigadier.arguments.StringArgumentType.getString(context, "module");
                            String setting = com.mojang.brigadier.arguments.StringArgumentType.getString(context, "setting");
                            String value = com.mojang.brigadier.arguments.StringArgumentType.getString(context, "value");
                            info(control().setSetting(module, setting, value));
                            return SINGLE_SUCCESS;
                        }))))
        );

        builder.then(literal("get")
            .executes(context -> {
                printModules(control().modules(null));
                return SINGLE_SUCCESS;
            })
            .then(argument("module", com.mojang.brigadier.arguments.StringArgumentType.word())
                .executes(context -> {
                    printModules(control().modules(
                        com.mojang.brigadier.arguments.StringArgumentType.getString(context, "module")));
                    return SINGLE_SUCCESS;
                }))
        );

        builder.then(literal("hud").executes(context -> {
            info(control().hud(null, true));
            return SINGLE_SUCCESS;
        })
            .then(literal("list").executes(context -> {
                info(control().hud(null, true));
                return SINGLE_SUCCESS;
            }))
            .then(argument("element", com.mojang.brigadier.arguments.StringArgumentType.word())
                .executes(context -> {
                    info(control().hud(
                        com.mojang.brigadier.arguments.StringArgumentType.getString(context, "element"), false));
                    return SINGLE_SUCCESS;
                }))
        );

        builder.then(literal("export").executes(context -> {
            info(control().data(ControlAction.Data.Kind.EXPORT));
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("reload").executes(context -> {
            info(control().data(ControlAction.Data.Kind.RELOAD));
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("companion").executes(context -> {
            companionStatus();
            return SINGLE_SUCCESS;
        })
            .then(literal("status").executes(context -> {
                companionStatus();
                return SINGLE_SUCCESS;
            }))
            .then(literal("start").executes(context -> {
                var module = HunterRegistry.companion();
                if (module == null) {
                    error("Companion module is not registered.");
                } else {
                    if (!module.isActive()) module.enable();
                    info("Companion endpoint enabled.");
                }
                return SINGLE_SUCCESS;
            }))
            .then(literal("stop").executes(context -> {
                var module = HunterRegistry.companion();
                if (module != null && module.isActive()) module.disable();
                info("Companion endpoint disabled.");
                return SINGLE_SUCCESS;
            }))
            .then(literal("token").executes(context -> {
                var module = HunterRegistry.companion();
                if (module == null) {
                    error("Companion module is not registered.");
                } else {
                    String token = module.currentToken();
                    if (token.isBlank()) info("No token set; one is generated when the endpoint starts.");
                    else info("Companion token: %s", token);
                }
                return SINGLE_SUCCESS;
            }))
            .then(literal("regenerate").executes(context -> {
                var module = HunterRegistry.companion();
                if (module == null) {
                    error("Companion module is not registered.");
                } else {
                    info("New companion token: %s", module.regenerateToken());
                }
                return SINGLE_SUCCESS;
            }))
            .then(literal("port")
                .then(argument("port", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 65535))
                    .executes(context -> {
                        int port = com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(context, "port");
                        core().config().setCompanionPort(port);
                        core().markDirty();
                        var module = HunterRegistry.companion();
                        if (module != null && module.isActive()) {
                            module.disable();
                            module.enable();
                        }
                        info("Companion port set to %d.", port);
                        return SINGLE_SUCCESS;
                    }))
            )
        );
    }

    private void companionStatus() {
        var module = HunterRegistry.companion();
        var config = core().config();
        info("Companion: %s  Port: %d  Remote: %s",
            module != null && module.running() ? "listening on " + module.boundPort() : "stopped",
            config.companionPort(), config.companionAllowRemote() ? "yes" : "no");
        String token = config.companionToken();
        info("Token: %s", token.isBlank() ? "(none - generated on start)" : token);
    }

    private HunterCore core() {
        return HunterRuntime.get().core();
    }

    private MinecraftControlTarget control() {
        return new MinecraftControlTarget();
    }

    private void printModules(java.util.List<ModuleView> modules) {
        if (modules == null || modules.isEmpty()) {
            info("No matching modules.");
            return;
        }
        for (ModuleView module : modules) {
            info("%s [%s] %s", module.name(), module.enabled() ? "on" : "off", module.title());
            for (SettingView setting : module.settings()) {
                info("  %s = %s%s", setting.name(), setting.value(), setting.modified() ? " *" : "");
            }
        }
    }

    private void status() {
        HunterCore core = core();
        HunterRuntime runtime = HunterRuntime.get();

        String state = core.config().emergencyStop() ? "EMERGENCY STOP" : (core.running() ? "running" : "stopped");
        info("State: %s  Profile: %s", state, core.config().activeProfileName());
        info("Server: %s  Dimension: %s", core.serverAddress().isBlank() ? "-" : core.serverAddress(),
            core.dimension().isBlank() ? "-" : core.dimension());
        info("Health: %.1f  Armor: %d  Weapon: %s",
            runtime.localHealth(), runtime.localArmor(), runtime.localWeapon());

        var target = core.currentTarget();
        if (target == null) info("Target: none (visible: %d, candidates: %d)", core.tracker().visibleCount(), core.candidates().size());
        else info("Target: %s %.1fm hp %.1f/%s", target.name(), target.distance, target.snapshot.health(), target.snapshot.maxHealth());

        var session = core.sessions().current();
        info("Session: %s", session == null ? "idle" : Time.duration(runtime.now() - session.startedAt) + " on " + session.server);
        info("Kills: %d  Deaths: %d  K/D: %.2f  Tracked: %d  Modules: %d/%d",
            core.statistics().totalKills(), core.statistics().totalDeaths(), core.statistics().kdRatio(),
            core.targets().size(), HunterRegistry.activeCount(), HunterRegistry.hunterModules().size());
    }
}
