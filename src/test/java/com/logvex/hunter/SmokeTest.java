package com.logvex.hunter;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SmokeTest {
    @Test
    void versionIsSet() {
        assertEquals("1.1.0", HunterAddon.VERSION);
    }
}
