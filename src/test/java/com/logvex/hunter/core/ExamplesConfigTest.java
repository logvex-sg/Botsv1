package com.logvex.hunter.core;

import com.logvex.hunter.core.config.HunterConfig;
import com.logvex.hunter.core.instances.InstanceRegistry;
import com.logvex.hunter.core.message.MessageManager;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.target.TargetStore;
import com.logvex.hunter.core.util.Json;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Loads the JSON files shipped in {@code examples/} through the real parsers.
 *
 * <p>This keeps the documented configuration examples honest: if a field is renamed or a schema
 * changes, the examples fail here instead of misleading a user.
 */
class ExamplesConfigTest {
    private static final Path EXAMPLES = Path.of("examples");

    @SuppressWarnings("unchecked")
    private static Map<String, Object> read(String name) throws Exception {
        Path file = EXAMPLES.resolve(name);
        assertTrue(Files.exists(file), "missing example " + name);
        return (Map<String, Object>) Json.parse(Files.readString(file));
    }

    @Test
    void configExampleLoads() throws Exception {
        HunterConfig config = HunterConfig.fromJson(read("config.json"));
        assertTrue(config.companionEnabled());
        assertEquals(8720, config.companionPort());
        assertNotNull(config.profile("6b6t"));
        assertEquals("6b6t", config.activeProfileName());
        assertEquals(48, config.profile("6b6t").toFilterSettings().range, 0.001);
        assertEquals(6969, config.swarmHostPort());
        assertTrue(config.swarmHostMode());
        assertTrue(config.swarmAutoConnect());
    }

    @Test
    void swarmSettingsRoundTripThroughTheConfig() throws Exception {
        HunterConfig config = HunterConfig.fromJson(read("config.json"));
        config.setSwarmHostToken("shared-secret");
        config.setSwarmWorkerHost("10.0.0.5");
        config.setSwarmWorkerPort(7000);
        config.setSwarmAllowCombatBroadcast(true);
        config.setSwarmHostMode(false);

        HunterConfig reloaded = HunterConfig.fromJson(config.toJson());
        assertEquals("shared-secret", reloaded.swarmHostToken());
        assertEquals("10.0.0.5", reloaded.swarmWorkerHost());
        assertEquals(7000, reloaded.swarmWorkerPort());
        assertTrue(reloaded.swarmAllowCombatBroadcast());
        assertFalse(reloaded.swarmHostMode());
    }

    @Test
    void targetsExampleLoads() throws Exception {
        TargetStore store = TargetStore.fromJson(read("targets.json"));
        assertEquals(5, store.size());
        assertNotNull(store.byName("Griefer01"));
        assertEquals(TargetCategory.PRIORITY, store.byName("Griefer01").category());
        assertEquals(TargetCategory.FRIEND, store.byName("FriendlySteve").category());
        assertTrue(store.isProtected(null, "FriendlySteve"));
        TargetEntry unknown = store.byName("UnknownGuy");
        assertNotNull(unknown.lastKnownPosition());
    }

    @Test
    void messagesExampleLoads() throws Exception {
        MessageManager manager = MessageManager.fromJson(read("messages.json"));
        assertEquals("aggressive", manager.activeProfileName());
        assertTrue(manager.profileNames().contains("quiet"));
        assertNotNull(manager.active());
    }

    @Test
    void instancesExampleLoads() throws Exception {
        InstanceRegistry registry = InstanceRegistry.fromJson(read("instances.json"));
        assertEquals(2, registry.size());
        assertNotNull(registry.get("hunter-main"));
        assertEquals(8720, registry.get("hunter-main").port());
    }
}
