package com.logvex.hunter.core;

import com.logvex.hunter.core.swarm.SwarmLink;
import com.logvex.hunter.core.swarm.SwarmMessage;
import com.logvex.hunter.core.swarm.SwarmPeer;
import com.logvex.hunter.core.swarm.SwarmProtocol;
import com.logvex.hunter.core.swarm.SwarmRoster;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Tests the host roster: registration, resolving selectors, routing and pruning. */
class SwarmRosterTest {

    /** An in-memory link that records everything sent to it. */
    private static final class FakeLink implements SwarmLink {
        final List<String> sent = new ArrayList<>();
        boolean open = true;
        boolean closed;
        long flushed;
        int flushCalls;

        @Override public boolean send(String line) {
            if (!open) return false;
            sent.add(line);
            return true;
        }

        @Override public void close() {
            open = false;
            closed = true;
        }

        @Override public boolean open() {
            return open;
        }

        @Override public void flush(long timeoutMillis) {
            flushCalls++;
            flushed += timeoutMillis;
        }
    }

    @Test
    void registersAndListsPeers() {
        SwarmRoster roster = new SwarmRoster();
        roster.register("w1", "127.0.0.1:5000", "alpha", new FakeLink(), 1000L);
        roster.register("w2", "127.0.0.1:5001", "beta", new FakeLink(), 1000L);
        assertEquals(2, roster.size());
        assertNotNull(roster.get("w1"));
        assertEquals("beta", roster.get("w2").label());
    }

    @Test
    void resolvesByIdLabelAndIndex() {
        SwarmRoster roster = new SwarmRoster();
        roster.register("w1", "a", "alpha", new FakeLink(), 0);
        roster.register("w2", "b", "beta", new FakeLink(), 0);

        assertEquals("w1", roster.resolve("w1").id());
        assertEquals("w1", roster.resolve("ALPHA").id());
        assertEquals("w1", roster.resolve("1").id());
        assertEquals("w2", roster.resolve("2").id());
        assertNull(roster.resolve("3"));
        assertNull(roster.resolve("nobody"));
        assertNull(roster.resolve(null));
    }

    @Test
    void sendReachesOnePeer() {
        SwarmRoster roster = new SwarmRoster();
        FakeLink link = new FakeLink();
        roster.register("w1", "a", "alpha", link, 0);

        String error = roster.send("w1", SwarmMessage.of(SwarmProtocol.COMMAND).with("line", "status"));
        assertNull(error);
        assertEquals(1, link.sent.size());
        assertTrue(link.sent.get(0).contains("status"));
        assertEquals(1, roster.get("w1").commandsSent());
    }

    @Test
    void sendReportsUnknownOrClosedPeers() {
        SwarmRoster roster = new SwarmRoster();
        assertEquals("unknown worker: nope", roster.send("nope", SwarmMessage.of(SwarmProtocol.PING)));

        FakeLink link = new FakeLink();
        roster.register("w1", "a", "alpha", link, 0);
        link.open = false;
        assertTrue(roster.send("w1", SwarmMessage.of(SwarmProtocol.PING)).contains("not connected"));
    }

    @Test
    void broadcastReachesEveryOpenPeer() {
        SwarmRoster roster = new SwarmRoster();
        FakeLink a = new FakeLink();
        FakeLink b = new FakeLink();
        FakeLink closed = new FakeLink();
        closed.open = false;
        roster.register("w1", "a", "alpha", a, 0);
        roster.register("w2", "b", "beta", b, 0);
        roster.register("w3", "c", "gamma", closed, 0);

        int reached = roster.broadcast(SwarmMessage.of(SwarmProtocol.COMMAND).with("line", "hud list"));
        assertEquals(2, reached, "a closed link must not count");
        assertEquals(1, a.sent.size());
        assertEquals(1, b.sent.size());
        assertEquals(0, closed.sent.size());
    }

    @Test
    void unregisterClosesTheLinkAndMarksThePeerDead() {
        SwarmRoster roster = new SwarmRoster();
        FakeLink link = new FakeLink();
        SwarmPeer peer = roster.register("w1", "a", "alpha", link, 0);

        SwarmPeer removed = roster.unregister("w1");
        assertEquals(peer, removed);
        assertTrue(peer.alive() == false);
        assertTrue(link.closed);
        assertEquals(0, roster.size());
    }

    @Test
    void reRegisteringTheSameIdClosesTheOldLink() {
        SwarmRoster roster = new SwarmRoster();
        FakeLink first = new FakeLink();
        FakeLink second = new FakeLink();
        roster.register("w1", "a", "alpha", first, 0);
        roster.register("w1", "b", "alpha-again", second, 0);

        assertTrue(first.closed, "the superseded link must be closed");
        assertEquals(1, roster.size());
        assertEquals("alpha-again", roster.get("w1").label());
    }

    @Test
    void kickRemovesBySelector() {
        SwarmRoster roster = new SwarmRoster();
        roster.register("w1", "a", "alpha", new FakeLink(), 0);
        assertTrue(roster.kick("alpha"));
        assertEquals(0, roster.size());
        assertFalse(roster.kick("alpha"), "kicking twice is a no-op");
    }

    @Test
    void pruneDropsSilentAndClosedPeers() {
        SwarmRoster roster = new SwarmRoster();
        FakeLink live = new FakeLink();
        SwarmPeer fresh = roster.register("fresh", "a", "fresh", live, 55_000L);

        FakeLink dead = new FakeLink();
        dead.open = false;
        roster.register("dead", "b", "dead", dead, 1000L);

        FakeLink silent = new FakeLink();
        roster.register("quiet", "c", "quiet", silent, 1000L);

        int pruned = roster.prune(60_000L, 10_000L);
        assertEquals(2, pruned, "the closed link and the silent peer are both dropped");
        assertEquals(1, roster.size());
        assertEquals("fresh", roster.peers().get(0).label());
    }

    @Test
    void describeSummarisesTheRoster() {
        SwarmRoster roster = new SwarmRoster();
        assertEquals("No workers connected.", roster.describe());
        roster.register("w1", "127.0.0.1:9", "alpha", new FakeLink(), 0);
        assertTrue(roster.describe().contains("alpha"));
        assertEquals("1 worker", roster.summary());
        roster.register("w2", "127.0.0.1:8", "beta", new FakeLink(), 0);
        assertEquals("2 workers", roster.summary());
    }

    @Test
    void flushReachesEveryLink() {
        SwarmRoster roster = new SwarmRoster();
        FakeLink a = new FakeLink();
        FakeLink b = new FakeLink();
        roster.register("w1", "a", "alpha", a, 0);
        roster.register("w2", "b", "beta", b, 0);

        roster.flush(300);

        assertEquals(1, a.flushCalls);
        assertEquals(1, b.flushCalls);
        assertEquals(300, a.flushed + b.flushed, "the budget is shared across links");
    }

    @Test
    void clearClosesEveryLink() {
        SwarmRoster roster = new SwarmRoster();
        FakeLink a = new FakeLink();
        FakeLink b = new FakeLink();
        roster.register("w1", "a", "alpha", a, 0);
        roster.register("w2", "b", "beta", b, 0);
        roster.clear();
        assertTrue(a.closed);
        assertTrue(b.closed);
        assertTrue(roster.isEmpty());
    }
}
