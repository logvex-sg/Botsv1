package com.logvex.hunter.command;

import com.logvex.hunter.core.HunterCore;
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

        builder.then(literal("gui").executes(context -> {
            mc.setScreen(new DashboardScreen(GuiThemes.get(), null));
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
        }));
    }

    private HunterCore core() {
        return HunterRuntime.get().core();
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
