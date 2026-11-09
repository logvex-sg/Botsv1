package com.logvex.hunter.core.swarm;

/**
 * The pure half of the swarm handshake: building the {@code hello}/{@code hello-ack} messages and
 * deciding whether a hunter may join.
 *
 * <p>Keeping this free of sockets means the token check and protocol check are unit-tested directly,
 * and both the host and the hunter share exactly one implementation of the rule.
 */
public final class SwarmHandshake {
    private SwarmHandshake() {}

    /** The hunter's opening message: the protocol id, version, shared token, and a display label. */
    public static SwarmMessage hello(String token, String label) {
        return SwarmMessage.of(SwarmProtocol.HELLO)
            .with(SwarmProtocol.FIELD_PROTOCOL, SwarmProtocol.ID)
            .with(SwarmProtocol.FIELD_VERSION, SwarmProtocol.VERSION)
            .with(SwarmProtocol.FIELD_TOKEN, token == null ? "" : token)
            .with(SwarmProtocol.FIELD_LABEL, label == null ? "" : label);
    }

    /** The host's reply accepting a hunter. */
    public static SwarmMessage accept(String label) {
        return SwarmMessage.of(SwarmProtocol.HELLO_ACK)
            .with(SwarmProtocol.FIELD_OK, true)
            .with(SwarmProtocol.FIELD_PROTOCOL, SwarmProtocol.ID)
            .with(SwarmProtocol.FIELD_VERSION, SwarmProtocol.VERSION)
            .with(SwarmProtocol.FIELD_LABEL, label == null ? "" : label);
    }

    /** The host's reply rejecting a hunter, with a reason the hunter can show the user. */
    public static SwarmMessage reject(String reason) {
        return SwarmMessage.of(SwarmProtocol.HELLO_ACK)
            .with(SwarmProtocol.FIELD_OK, false)
            .with(SwarmProtocol.FIELD_ERROR, reason == null ? "rejected" : reason);
    }

    /**
     * Decides whether a {@code hello} may join.
     *
     * @return {@code null} when the hunter is accepted, otherwise the reason to send back. An empty
     *         configured token means the host accepts anyone on the port, which the caller warns
     *         about when the host is started.
     */
    public static String check(SwarmMessage hello, String expectedToken) {
        if (hello == null || !SwarmProtocol.HELLO.equals(hello.type())) return "expected a hello message";
        if (!SwarmProtocol.ID.equals(hello.string(SwarmProtocol.FIELD_PROTOCOL))) {
            return "protocol mismatch (got '" + hello.string(SwarmProtocol.FIELD_PROTOCOL) + "')";
        }
        if (hello.number(SwarmProtocol.FIELD_VERSION, 0) != SwarmProtocol.VERSION) {
            return "version mismatch (got " + hello.number(SwarmProtocol.FIELD_VERSION, 0)
                + ", want " + SwarmProtocol.VERSION + ")";
        }
        String expected = expectedToken == null ? "" : expectedToken;
        if (!expected.isBlank() && !constantTimeEquals(hello.string(SwarmProtocol.FIELD_TOKEN), expected)) {
            return "bad token";
        }
        return null;
    }

    /** Whether a {@code hello-ack} says the hunter was accepted. */
    public static boolean accepted(SwarmMessage ack) {
        return ack != null && SwarmProtocol.HELLO_ACK.equals(ack.type()) && ack.flag(SwarmProtocol.FIELD_OK);
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int result = 0;
        for (int i = 0; i < a.length(); i++) result |= a.charAt(i) ^ b.charAt(i);
        return result == 0;
    }
}
