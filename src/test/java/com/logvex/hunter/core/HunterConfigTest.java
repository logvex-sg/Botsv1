package com.logvex.hunter.core;

import com.logvex.hunter.core.config.ConfigPaths;
import com.logvex.hunter.core.config.HunterConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Tests for configuration defaults, persistence and corruption recovery. */
class HunterConfigTest {

    @Test
    void defaultsAreSane() {
        HunterConfig config = new HunterConfig();
        assertTrue(config.enabled());
        assertFalse(config.emergencyStop());
        assertEquals("default", config.activeProfileName());
        assertNotNull(config.profile("default"));
        assertFalse(config.companionEnabled());
        assertEquals(8720, config.companionPort());
        assertEquals("", config.companionToken());
    }

    @Test
    void companionSettingsRoundTrip() {
        HunterConfig config = new HunterConfig();
        config.setCompanionEnabled(true);
        config.setCompanionPort(9911);
        config.setCompanionToken("token-123");
        config.setCompanionAllowRemote(true);

        HunterConfig reloaded = HunterConfig.fromJson(config.toJson());
        assertTrue(reloaded.companionEnabled());
        assertEquals(9911, reloaded.companionPort());
        assertEquals("token-123", reloaded.companionToken());
        assertTrue(reloaded.companionAllowRemote());
    }

    @Test
    void portIsClamped() {
        HunterConfig config = new HunterConfig();
        config.setCompanionPort(0);
        assertEquals(1, config.companionPort());
        config.setCompanionPort(100_000);
        assertEquals(65535, config.companionPort());
    }

    @Test
    void profilesRoundTrip() {
        HunterConfig config = new HunterConfig();
        assertNotNull(config.createProfile("raid", true));
        config.setActiveProfile("raid");

        HunterConfig reloaded = HunterConfig.fromJson(config.toJson());
        assertEquals("raid", reloaded.activeProfileName());
        assertNotNull(reloaded.profile("raid"));
        assertNotNull(reloaded.profile("default"));
    }

    @Test
    void missingFileYieldsDefaults(@TempDir Path dir) {
        ConfigPaths paths = new ConfigPaths(dir);
        HunterConfig.LoadResult result = HunterConfig.load(paths.configFile());

        assertFalse(result.recovered());
        assertTrue(result.config().enabled());
    }

    @Test
    void corruptFileIsBackedUpAndReset(@TempDir Path dir) throws Exception {
        ConfigPaths paths = new ConfigPaths(dir);
        Files.createDirectories(paths.root());
        Files.writeString(paths.configFile(), "{ this is not valid json ");

        HunterConfig.LoadResult result = HunterConfig.load(paths.configFile());

        assertTrue(result.recovered());
        assertTrue(result.message().contains("corrupt"));
        assertTrue(Files.exists(paths.configFile()));
        assertFalse(HunterConfig.load(paths.configFile()).recovered());
    }

    @Test
    void savedFileLoadsCleanly(@TempDir Path dir) throws Exception {
        ConfigPaths paths = new ConfigPaths(dir);
        HunterConfig config = new HunterConfig();
        config.setCompanionEnabled(true);
        config.save(paths.configFile());

        HunterConfig.LoadResult result = HunterConfig.load(paths.configFile());
        assertFalse(result.recovered());
        assertTrue(result.config().companionEnabled());
    }
}
