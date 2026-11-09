package com.logvex.hunter;

import com.logvex.hunter.gui.HunterTab;
import com.logvex.hunter.hud.EquipmentHud;
import com.logvex.hunter.hud.HunterStatusHud;
import com.logvex.hunter.hud.StasisHud;
import com.logvex.hunter.hud.StatisticsHud;
import com.logvex.hunter.hud.SwarmHud;
import com.logvex.hunter.hud.TargetHud;
import com.logvex.hunter.modules.HunterRegistry;
import com.mojang.logging.LogUtils;
import meteordevelopment.meteorclient.addons.GithubRepo;
import meteordevelopment.meteorclient.addons.MeteorAddon;
import meteordevelopment.meteorclient.commands.Commands;
import meteordevelopment.meteorclient.gui.tabs.Tabs;
import meteordevelopment.meteorclient.systems.hud.Hud;
import meteordevelopment.meteorclient.systems.modules.Category;
import meteordevelopment.meteorclient.systems.modules.Modules;
import org.slf4j.Logger;

/** The addon entry point: registers the category, modules, HUD elements, tab and commands. */
public class HunterAddon extends MeteorAddon {
    public static final Logger LOG = LogUtils.getLogger();
    public static final String NAME = "Logvex Hunter";
    public static final String VERSION = "1.0.0";
    public static final Category CATEGORY = new Category("Logvex Hunter");

    @Override
    public void onInitialize() {
        LOG.info("Initializing {} {}", NAME, VERSION);

        HunterRegistry.register();
        registerHud();
        Tabs.add(new HunterTab());
        Commands.add(new com.logvex.hunter.command.HunterCommand());
        Commands.add(new com.logvex.hunter.command.TargetCommand());
        Commands.add(new com.logvex.hunter.command.HunterStatsCommand());
        Commands.add(new com.logvex.hunter.command.SwarmCommand());
    }

    @Override
    public void onRegisterCategories() {
        Modules.registerCategory(CATEGORY);
    }

    private void registerHud() {
        Hud hud = Hud.get();
        hud.register(TargetHud.INFO);
        hud.register(HunterStatusHud.INFO);
        hud.register(EquipmentHud.INFO);
        hud.register(StasisHud.INFO);
        hud.register(StatisticsHud.INFO);
        hud.register(SwarmHud.INFO);
    }

    @Override
    public String getPackage() {
        return "com.logvex.hunter";
    }

    @Override
    public GithubRepo getRepo() {
        return new GithubRepo("logvex-sg", "Botsv1");
    }
}
