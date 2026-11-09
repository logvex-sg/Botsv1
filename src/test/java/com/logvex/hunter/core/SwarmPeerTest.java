package com.logvex.hunter.core;

import com.logvex.hunter.core.swarm.SwarmPeer;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Tests one worker's live state as the host tracks it. */
class SwarmPeerTest {

    @Test
    void fallsBackToTheIdWhenTheLabelIsMissing() {
        assertEquals("w1", new SwarmPeer("w1", "127.0.0.1:1", null).label());
        assertEquals("w1", new SwarmPeer("w1", "127.0.0.1:1", "  ").label());
        assertEquals("alpha", new SwarmPeer("w1", "127.0.0.1:1", "alpha").label());
    }

    @Test
    void defaultsAreSafe() {
        SwarmPeer peer = new SwarmPeer("w1", null, "alpha");
        assertEquals("", peer.address());
        assertEquals("unknown", peer.status());
        assertEquals("", peer.lastResult());
        assertEquals(-1, peer.lastLatencyMillis());
        assertTrue(peer.alive());
    }

    @Test
    void nullWritesDoNotCorruptTheState() {
        SwarmPeer peer = new SwarmPeer("w1", "a", "alpha");
        peer.setStatus(null);
        peer.setLastResult(null);
        assertEquals("unknown", peer.status());
        assertEquals("", peer.lastResult());
    }

    @Test
    void staleOnlyOnceItHasBeenSeenAndTheTimeoutPasses() {
        SwarmPeer peer = new SwarmPeer("w1", "a", "alpha");
        assertFalse(peer.stale(10_000, 5_000), "never seen means not stale");
        peer.touch(10_000);
        assertFalse(peer.stale(14_999, 5_000));
        assertTrue(peer.stale(15_001, 5_000));
    }

    @Test
    void countersAndLivenessAreTracked() {
        SwarmPeer peer = new SwarmPeer("w1", "a", "alpha");
        peer.incrementCommandsSent();
        peer.incrementCommandsSent();
        peer.incrementResultsReceived();
        assertEquals(2, peer.commandsSent());
        assertEquals(1, peer.resultsReceived());

        peer.markDead();
        assertFalse(peer.alive());
    }

    @Test
    void toStringReadsAsLabelAndAddress() {
        assertEquals("alpha (127.0.0.1:9)", new SwarmPeer("w1", "127.0.0.1:9", "alpha").toString());
    }
}
