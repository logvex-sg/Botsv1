package com.logvex.hunter.core.swarm;

/**
 * Wire constants for the in-game swarm link.
 *
 * <p>The protocol is newline-delimited JSON: exactly one compact JSON object per line, in both
 * directions. It is deliberately trivial to speak, so the same classes are unit-testable without a
 * socket and a hand-written client can be debugged with {@code nc}.
 *
 * <p>Handshake: the hunter connects and sends {@code hello} carrying the shared token. The host
 * answers {@code hello-ack}; a rejected handshake is followed by a disconnect. After that the host
 * sends {@code command} lines and the hunter answers {@code result}, while either side may send
 * {@code ping}/{@code pong} and {@code status}.
 */
public final class SwarmProtocol {
    private SwarmProtocol() {}

    /** Protocol revision. Bumped when the message shapes change incompatibly. */
    public static final int VERSION = 1;

    /** Human-readable protocol identifier exchanged in the handshake. */
    public static final String ID = "logvex-swarm/1";

    /** Longest single line accepted, in characters. Oversized lines are dropped, not buffered. */
    public static final int MAX_LINE = 32 * 1024;

    // Message types -----------------------------------------------------------
    public static final String HELLO = "hello";
    public static final String HELLO_ACK = "hello-ack";
    public static final String STATUS = "status";
    public static final String COMMAND = "command";
    public static final String RESULT = "result";
    public static final String PING = "ping";
    public static final String PONG = "pong";
    public static final String BYE = "bye";

    // Field names -------------------------------------------------------------
    public static final String FIELD_TYPE = "type";
    public static final String FIELD_PROTOCOL = "protocol";
    public static final String FIELD_VERSION = "version";
    public static final String FIELD_TOKEN = "token";
    public static final String FIELD_ID = "id";
    public static final String FIELD_LABEL = "label";
    public static final String FIELD_ROLE = "role";
    public static final String FIELD_STATUS = "status";
    public static final String FIELD_OK = "ok";
    public static final String FIELD_ERROR = "error";
    public static final String FIELD_OUTPUT = "output";
    public static final String FIELD_LINE = "line";
    public static final String FIELD_TIME = "time";
    public static final String FIELD_DATA = "data";
}
