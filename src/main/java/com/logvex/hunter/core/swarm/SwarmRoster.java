package com.logvex.hunter.core.swarm;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The host's view of every connected worker: who is connected, and how to reach them.
 *
 * <p>This class owns no sockets. The transport layer registers a peer together with its
 * {@link SwarmLink}; the roster then routes commands by id, label or 1-based index. Keeping the
 * routing here means the command path is fully unit-testable with in-memory links, and the GUI can
 * read the roster without ever touching the network.
 *
 * <p>Peers are registered from the host's socket threads and read from the GUI and client threads,
 * so every method that touches the maps is synchronized. Callbacks that a link invokes on close
 * (which re-enter the roster) are safe because the lock is not held across the close call.
 */
public final class SwarmRoster {
    private final Map<String, SwarmPeer> peers = new LinkedHashMap<>();
    private final Map<String, SwarmLink> links = new LinkedHashMap<>();

    /** Registers a peer and its link, replacing any previous connection under the same id. */
    public synchronized SwarmPeer register(String id, String address, String label, SwarmLink link, long now) {
        if (id == null || id.isBlank()) return null;
        SwarmPeer previous = peers.remove(id);
        SwarmLink previousLink = links.remove(id);
        if (previousLink != null) previousLink.close();
        if (previous != null) previous.markDead();
        SwarmPeer peer = new SwarmPeer(id, address, label);
        peer.setConnectedAt(now);
        peer.touch(now);
        peers.put(id, peer);
        links.put(id, link);
        return peer;
    }

    /** Marks a peer dead and removes it. Returns the peer that was removed, or {@code null}. */
    public SwarmPeer unregister(String id) {
        SwarmPeer peer;
        SwarmLink link;
        synchronized (this) {
            if (id == null) return null;
            peer = peers.remove(id);
            link = links.remove(id);
            if (peer != null) peer.markDead();
        }
        if (link != null) link.close();
        return peer;
    }

    public synchronized SwarmPeer get(String id) {
        return id == null ? null : peers.get(id);
    }

    public synchronized List<SwarmPeer> peers() {
        return new ArrayList<>(peers.values());
    }

    public synchronized int size() {
        return peers.size();
    }

    public synchronized boolean isEmpty() {
        return peers.isEmpty();
    }

    /**
     * Resolves a user-typed selector to a peer: an exact id, a case-insensitive label, or a 1-based
     * index into {@link #peers()}. Returns {@code null} when nothing matches.
     */
    public synchronized SwarmPeer resolve(String selector) {
        if (selector == null || selector.isBlank()) return null;
        String key = selector.trim();
        SwarmPeer byId = peers.get(key);
        if (byId != null) return byId;
        for (SwarmPeer peer : peers.values()) {
            if (peer.label().equalsIgnoreCase(key)) return peer;
        }
        try {
            int index = Integer.parseInt(key);
            List<SwarmPeer> list = peers();
            if (index >= 1 && index <= list.size()) return list.get(index - 1);
        } catch (NumberFormatException ignored) {
            // not an index; fall through to no match
        }
        return null;
    }

    /** Sends a message to one peer. Returns {@code null} on success, or an error to report. */
    public String send(String id, SwarmMessage message) {
        SwarmPeer peer;
        SwarmLink link;
        synchronized (this) {
            peer = peers.get(id);
            if (peer == null) return "unknown worker: " + id;
            link = links.get(id);
        }
        if (link == null || !link.open()) return "worker " + peer.label() + " is not connected";
        if (!link.send(message.encode())) return "could not reach " + peer.label();
        peer.incrementCommandsSent();
        peer.touch(System.currentTimeMillis());
        return null;
    }

    /** Sends a message to every peer. Returns the number of peers it reached. */
    public int broadcast(SwarmMessage message) {
        List<Map.Entry<String, SwarmLink>> snapshot;
        synchronized (this) {
            snapshot = new ArrayList<>(links.entrySet());
        }
        String line = message.encode();
        int count = 0;
        long now = System.currentTimeMillis();
        for (Map.Entry<String, SwarmLink> entry : snapshot) {
            SwarmLink link = entry.getValue();
            if (link != null && link.open() && link.send(line)) {
                SwarmPeer peer = get(entry.getKey());
                if (peer != null) {
                    peer.incrementCommandsSent();
                    peer.touch(now);
                }
                count++;
            }
        }
        return count;
    }

    /** Disconnects one peer. Returns {@code true} when it was connected. */
    public boolean kick(String selector) {
        SwarmPeer peer = resolve(selector);
        if (peer == null) return false;
        return unregister(peer.id()) != null;
    }

    /** Drops every peer whose link died or that has been silent past the timeout. */
    public int prune(long now, long timeoutMillis) {
        List<String> dead = new ArrayList<>();
        for (SwarmPeer peer : peers()) {
            SwarmLink link;
            synchronized (this) {
                link = links.get(peer.id());
            }
            boolean linkGone = link == null || !link.open();
            if (linkGone || peer.stale(now, timeoutMillis)) dead.add(peer.id());
        }
        for (String id : dead) unregister(id);
        return dead.size();
    }

    public void clear() {
        List<SwarmLink> toClose;
        List<SwarmPeer> toMark;
        synchronized (this) {
            toClose = new ArrayList<>(links.values());
            toMark = new ArrayList<>(peers.values());
            peers.clear();
            links.clear();
        }
        for (SwarmLink link : toClose) {
            if (link != null) link.close();
        }
        for (SwarmPeer peer : toMark) peer.markDead();
    }

    /** A compact, one-line summary used by the HUD and the status command. */
    public String summary() {
        int size = size();
        return size + " worker" + (size == 1 ? "" : "s");
    }

    public String describe() {
        List<SwarmPeer> list = peers();
        if (list.isEmpty()) return "No workers connected.";
        StringBuilder sb = new StringBuilder();
        int i = 1;
        for (SwarmPeer peer : list) {
            sb.append(i++).append(". ").append(peer.label())
                .append(" [").append(peer.address()).append("] ")
                .append(peer.status());
            if (peer.lastLatencyMillis() >= 0) sb.append(" ").append(peer.lastLatencyMillis()).append("ms");
            if (!peer.lastResult().isBlank()) sb.append(" - ").append(peer.lastResult());
            sb.append('\n');
        }
        return sb.toString().trim();
    }

    /**
     * Waits, in total, up to {@code timeoutMillis} for queued messages to leave every link.
     *
     * <p>Call this before tearing links down when a final message matters (an emergency stop).
     */
    public void flush(long timeoutMillis) {
        List<SwarmLink> snapshot;
        synchronized (this) {
            snapshot = new ArrayList<>(links.values());
        }
        long perLink = snapshot.isEmpty() ? 0 : Math.max(1, timeoutMillis / snapshot.size());
        for (SwarmLink link : snapshot) {
            if (link != null) link.flush(perLink);
        }
    }
}
