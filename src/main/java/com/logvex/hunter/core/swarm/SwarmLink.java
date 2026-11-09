package com.logvex.hunter.core.swarm;

/**
 * A single, one-way outbound channel to a connected peer.
 *
 * <p>The host keeps one link per hunter. The interface exists so the roster and command dispatch can
 * be exercised in a test with an in-memory link, with no socket and no Minecraft.
 */
public interface SwarmLink {
    /** Queues one already-encoded protocol line. Returns {@code false} when the link is closed. */
    boolean send(String line);

    /** Closes the channel and releases its socket. Safe to call more than once. */
    void close();

    /** Whether the channel is still usable. */
    boolean open();

    /**
     * Best-effort wait for already-queued messages to reach the socket.
     *
     * <p>Used before tearing a link down so a final command (an emergency stop) is not lost in the
     * outbound queue. Bounded: it never waits longer than {@code timeoutMillis}. A link with no
     * queue has nothing to do, so the default is a no-op.
     */
    default void flush(long timeoutMillis) {}
}
