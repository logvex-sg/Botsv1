package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.TaskCatalog;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The worker's security boundary: which task kinds exist, which mutate, and what the config permits. */
class TaskCatalogTest {
    @Test
    void supportsTheFullClosedSet() {
        List<String> kinds = TaskCatalog.all();
        assertTrue(kinds.contains(Protocol.TASK_EFLY));
        assertTrue(kinds.contains(Protocol.TASK_REGEAR));
        assertTrue(kinds.contains(Protocol.TASK_INVENTORY));
        assertTrue(kinds.contains(Protocol.TASK_CONTAINER_READ));
        assertTrue(kinds.contains(Protocol.TASK_CONTAINER_MOVE));
        assertTrue(kinds.contains(Protocol.TASK_SHULKER_READ));
        assertTrue(kinds.contains(Protocol.TASK_SHULKER_UNPACK));
        assertTrue(kinds.contains(Protocol.TASK_SHULKER_PACK));
        assertTrue(kinds.contains(Protocol.TASK_RESTOCK));
        assertTrue(kinds.contains(Protocol.TASK_PORTAL_SCAN));
        assertTrue(kinds.contains(Protocol.TASK_NL_TASK));
        for (String kind : kinds) {
            assertTrue(TaskCatalog.isSupported(kind), kind + " should be supported");
        }
    }

    @Test
    void advertisesTheStorageKindsTheHostExpects() {
        // These names are the Host's TASK_KINDS entries for storage; a rename on either side would
        // make the Host offer a task this worker refuses, so the contract is pinned here.
        assertEquals(
            List.of(
                Protocol.TASK_STATUS, Protocol.TASK_INVENTORY, Protocol.TASK_COUNT, Protocol.TASK_SEARCH,
                Protocol.TASK_EQUIPMENT, Protocol.TASK_REGEAR, Protocol.TASK_COMMAND, Protocol.TASK_CHAT,
                Protocol.TASK_POSITION, Protocol.TASK_EFLY, Protocol.TASK_CONTAINER_READ,
                Protocol.TASK_CONTAINER_MOVE, Protocol.TASK_SHULKER_READ, Protocol.TASK_SHULKER_UNPACK,
                Protocol.TASK_SHULKER_PACK, Protocol.TASK_RESTOCK, Protocol.TASK_PORTAL_SCAN,
                Protocol.TASK_NL_TASK
            ),
            TaskCatalog.all()
        );
    }

    @Test
    void isCaseInsensitive() {
        assertTrue(TaskCatalog.isSupported("EFLY"));
        assertTrue(TaskCatalog.isSupported("Regear"));
    }

    @Test
    void refusesUnknownKinds() {
        assertFalse(TaskCatalog.isSupported("exec"));
        assertFalse(TaskCatalog.isSupported(""));
        assertFalse(TaskCatalog.isSupported(null));
    }

    @Test
    void classifiesMutatingKinds() {
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_REGEAR));
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_COMMAND));
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_CHAT));
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_EFLY));
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_CONTAINER_MOVE));
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_SHULKER_UNPACK));
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_SHULKER_PACK));
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_RESTOCK));
        assertTrue(TaskCatalog.isMutating(Protocol.TASK_NL_TASK));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_STATUS));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_INVENTORY));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_COUNT));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_POSITION));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_CONTAINER_READ));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_SHULKER_READ));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_PORTAL_SCAN));
    }

    @Test
    void configPermitsByDefaultAndCanRefuseEachKind() {
        var config = com.logvex.worker.core.WorkerConfig.defaults();
        assertTrue(config.permits(Protocol.TASK_EFLY));
        assertTrue(config.permits(Protocol.TASK_COMMAND));
        assertTrue(config.permits(Protocol.TASK_CHAT));
        assertTrue(config.permits(Protocol.TASK_REGEAR));

        config.allowEfly = false;
        assertFalse(config.permits(Protocol.TASK_EFLY));
        config.allowCommands = false;
        assertFalse(config.permits(Protocol.TASK_COMMAND));
        config.allowChat = false;
        assertFalse(config.permits(Protocol.TASK_CHAT));
        config.allowRegear = false;
        assertFalse(config.permits(Protocol.TASK_REGEAR));
    }

    @Test
    void readOnlyKindsAreAlwaysPermitted() {
        var config = com.logvex.worker.core.WorkerConfig.defaults();
        config.allowEfly = false;
        config.allowCommands = false;
        config.allowChat = false;
        config.allowRegear = false;
        assertTrue(config.permits(Protocol.TASK_STATUS));
        assertTrue(config.permits(Protocol.TASK_INVENTORY));
    }

    @Test
    void permissionsRoundTripThroughTheConfigFile(@TempDir Path dir) {
        Path file = dir.resolve("logvex-worker.json");
        var config = com.logvex.worker.core.WorkerConfig.defaults();
        config.allowEfly = false;
        config.allowChat = false;
        config.label = "builder-1";
        config.group = "miners";
        com.logvex.worker.core.WorkerConfig.save(file, config);

        var loaded = com.logvex.worker.core.WorkerConfig.load(file);
        assertFalse(loaded.allowEfly);
        assertFalse(loaded.allowChat);
        assertTrue(loaded.allowCommands);
        assertTrue(loaded.allowRegear);
        assertEquals("builder-1", loaded.label);
        assertEquals("miners", loaded.group);
    }

    @Test
    void corruptConfigFileFallsBackToDefaults(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("logvex-worker.json");
        Files.writeString(file, "{ this is not json ");
        var loaded = com.logvex.worker.core.WorkerConfig.load(file);
        assertEquals(com.logvex.worker.core.WorkerConfig.DEFAULT_HOST, loaded.host);
        assertTrue(loaded.allowEfly);
    }
}
