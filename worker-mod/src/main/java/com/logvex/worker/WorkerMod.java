package com.logvex.worker;

import com.logvex.worker.core.WorkerConfig;
import com.logvex.worker.core.WorkerLink;
import com.logvex.worker.core.WorkerState;
import com.logvex.worker.mc.CommandSender;
import com.logvex.worker.mc.MinecraftTaskDispatcher;
import java.nio.file.Path;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;

/**
 * Worker mod entry point.
 *
 * <p>The worker is deliberately configuration-light: it reads one small JSON file from the game's
 * config directory, connects to the host named there and then does nothing until the host asks it to
 * do something. There is no in-game UI to configure and no keybind to learn. If the config file is
 * absent it is written with working defaults, so dropping the jar into a mods folder and launching
 * is a complete installation when the host runs on the same machine.
 */
public final class WorkerMod implements ClientModInitializer {
    public static final String MOD_ID = "logvex-worker";
    public static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(MOD_ID);

    private static WorkerLink link;

    @Override
    public void onInitializeClient() {
        Path configFile = FabricLoader.getInstance().getConfigDir().resolve("logvex-worker.json");
        WorkerConfig config = WorkerConfig.load(configFile);

        if (!config.enabled) {
            LOG.info("Logvex Worker is disabled in {}", configFile);
            return;
        }

        link = new WorkerLink(config, new MinecraftTaskDispatcher(), WorkerLink.ConnectionFactory.defaultFactory(), LOG::info);
        link.onStateChange(WorkerMod::onState);
        link.start();

        LOG.info("Logvex Worker connecting to {} (id={})", config.endpoint(),
            config.workerId.isEmpty() ? "<derived>" : config.workerId);
    }

    private static void onState(WorkerState state) {
        switch (state) {
            case REGISTERED -> CommandSender.localMessage("connected to fleet host");
            case BACKING_OFF -> CommandSender.localMessage("host unreachable, retrying...");
            default -> { /* Transient states are logged, not shown in chat. */ }
        }
    }
}
