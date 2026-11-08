package com.logvex.hunter.core.config;

import java.nio.file.Path;
import java.util.function.Function;

/**
 * Resolves the on-disk locations used by the addon.
 *
 * <p>The base directory is supplied by the game layer (Fabric's config directory), which keeps this
 * class free of Minecraft types and lets tests point it at a temporary folder.
 */
public final class ConfigPaths {
    public static final String ROOT_FOLDER = "logvex-hunter";

    private final Path root;

    public ConfigPaths(Path configDir) {
        this.root = configDir.resolve(ROOT_FOLDER);
    }

    public Path root() {
        return root;
    }

    public Path configFile() {
        return root.resolve("config.json");
    }

    public Path targetsFile() {
        return root.resolve("targets.json");
    }

    public Path messagesFile() {
        return root.resolve("messages.json");
    }

    public Path statisticsFile() {
        return root.resolve("statistics.json");
    }

    public Path instancesFile() {
        return root.resolve("instances.json");
    }

    public Path profilesDir() {
        return root.resolve("profiles");
    }

    public Path exportsDir() {
        return root.resolve("exports");
    }

    public Path backupsDir() {
        return root.resolve("backups");
    }

    /** Applies a transformation to the root, used when the user moves the data folder. */
    public ConfigPaths withRoot(Function<Path, Path> transform) {
        return new ConfigPaths(transform.apply(root).getParent());
    }
}
