package com.logvex.hunter.core;

import com.logvex.hunter.core.swarm.SwarmHandshake;
import com.logvex.hunter.core.swarm.SwarmMessage;
import com.logvex.hunter.core.swarm.SwarmProtocol;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Tests the swarm wire format and handshake rules without a socket. */
class SwarmProtocolTest {

    @Test
    void encodesOneCompactJsonObjectPerLine() {
        SwarmMessage message = SwarmMessage.of(SwarmProtocol.COMMAND)
            .with(SwarmProtocol.FIELD_LINE, "target add Notch")
            .with(SwarmProtocol.FIELD_TIME, 1234L);
        String encoded = message.encode();
        assertFalse(encoded.contains("\n"), "a message must not contain a newline");
        assertTrue(encoded.startsWith("{\"type\":\"command\""));
    }

    @Test
    void roundTripsEveryField() {
        String encoded = SwarmMessage.of(SwarmProtocol.RESULT)
            .with(SwarmProtocol.FIELD_LINE, "status")
            .with(SwarmProtocol.FIELD_OK, true)
            .with(SwarmProtocol.FIELD_OUTPUT, "State: running")
            .encode();

        SwarmMessage decoded = SwarmMessage.decode(encoded);
        assertNotNull(decoded);
        assertEquals(SwarmProtocol.RESULT, decoded.type());
        assertEquals("status", decoded.string(SwarmProtocol.FIELD_LINE));
        assertTrue(decoded.flag(SwarmProtocol.FIELD_OK));
        assertEquals("State: running", decoded.string(SwarmProtocol.FIELD_OUTPUT));
    }

    @Test
    void rejectsGarbageAndBlankLines() {
        assertNull(SwarmMessage.decode(null));
        assertNull(SwarmMessage.decode("   "));
        assertNull(SwarmMessage.decode("not json"));
        assertNull(SwarmMessage.decode("[1,2,3]"), "an array is not a message");
        assertNull(SwarmMessage.decode("\"a string\""));
    }

    @Test
    void rejectsOversizedLines() {
        String huge = "{\"type\":\"command\",\"line\":\"" + "x".repeat(SwarmProtocol.MAX_LINE) + "\"}";
        assertNull(SwarmMessage.decode(huge));
    }

    @Test
    void handshakeAcceptsAMatchingHello() {
        SwarmMessage hello = SwarmHandshake.hello("s3cret", "hunter-1");
        assertNull(SwarmHandshake.check(hello, "s3cret"));

        SwarmMessage ack = SwarmHandshake.accept("hunter-1");
        assertTrue(SwarmHandshake.accepted(ack));
    }

    @Test
    void handshakeRejectsABadToken() {
        SwarmMessage hello = SwarmHandshake.hello("wrong", "hunter-1");
        assertEquals("bad token", SwarmHandshake.check(hello, "s3cret"));

        SwarmMessage rejected = SwarmHandshake.reject("bad token");
        assertFalse(SwarmHandshake.accepted(rejected));
        assertEquals("bad token", rejected.string(SwarmProtocol.FIELD_ERROR));
    }

    @Test
    void handshakeRejectsAProtocolOrVersionMismatch() {
        SwarmMessage wrongProtocol = SwarmMessage.of(SwarmProtocol.HELLO)
            .with(SwarmProtocol.FIELD_PROTOCOL, "something-else")
            .with(SwarmProtocol.FIELD_VERSION, SwarmProtocol.VERSION);
        assertTrue(SwarmHandshake.check(wrongProtocol, "").startsWith("protocol mismatch"));

        SwarmMessage wrongVersion = SwarmHandshake.hello("", "w")
            .with(SwarmProtocol.FIELD_VERSION, SwarmProtocol.VERSION + 1);
        assertTrue(SwarmHandshake.check(wrongVersion, "").startsWith("version mismatch"));
    }

    @Test
    void anEmptyTokenAcceptsAnyHunter() {
        SwarmMessage hello = SwarmHandshake.hello("anything", "w");
        assertNull(SwarmHandshake.check(hello, ""));
    }

    @Test
    void handshakeRejectsAMessageThatIsNotAHello() {
        SwarmMessage notHello = SwarmMessage.of(SwarmProtocol.PING);
        assertEquals("expected a hello message", SwarmHandshake.check(notHello, ""));
    }
}
