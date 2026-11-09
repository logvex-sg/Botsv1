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
        for (String kind : kinds) {
            assertTrue(TaskCatalog.isSupported(kind), kind + " should be supported");
        }
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
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_STATUS));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_INVENTORY));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_COUNT));
        assertFalse(TaskCatalog.isMutating(Protocol.TASK_POSITION));
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
