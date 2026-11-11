package com.logvex.hunter;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SmokeTest {
    /**
     * The reported version must match the one the build stamps into {@code fabric.mod.json}. Reading
     * it back instead of hardcoding it means a version bump cannot leave the two disagreeing.
     */
    @Test
    void versionIsSet() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/fabric.mod.json")) {
            assertNotNull(in, "fabric.mod.json must be on the classpath");
            JsonObject mod = JsonParser.parseReader(
                new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
            String declared = mod.get("version").getAsString();

            assertTrue(declared.matches("\\d+\\.\\d+\\.\\d+"),
                "the stamped version should be a release version, was: " + declared);
            assertEquals(declared, HunterAddon.VERSION,
                "HunterAddon.VERSION drifted from fabric.mod.json");
        }
    }
}
