package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.logvex.worker.core.EflyRequest;
import com.logvex.worker.core.Protocol;
import org.junit.jupiter.api.Test;

/** Parsing and validation of EFly instructions, which is the boundary before the client is touched. */
class EflyRequestTest {
    private static JsonObject payload() {
        return new JsonObject();
    }

    @Test
    void defaultsToStartWithNoTarget() {
        EflyRequest request = EflyRequest.parse(payload());
        assertNotNull(request);
        assertEquals(EflyRequest.Action.START, request.action());
        assertFalse(request.hasTarget());
        assertFalse(request.startPathing());
    }

    @Test
    void parsesExplicitStop() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_ACTION, "stop");
        EflyRequest request = EflyRequest.parse(json);
        assertNotNull(request);
        assertTrue(request.isStop());
    }

    @Test
    void acceptsAliasesForStartAndStop() {
        JsonObject off = payload();
        off.addProperty(Protocol.FIELD_ACTION, "disable");
        assertTrue(EflyRequest.parse(off).isStop());

        JsonObject on = payload();
        on.addProperty(Protocol.FIELD_ACTION, "enable");
        assertEquals(EflyRequest.Action.START, EflyRequest.parse(on).action());
    }

    @Test
    void rejectsUnknownAction() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_ACTION, "teleport");
        assertNull(EflyRequest.parse(json));
    }

    @Test
    void rejectsNullPayload() {
        assertNull(EflyRequest.parse(null));
    }

    @Test
    void parsesTargetAndOptsIntoTargeting() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_X, 100);
        json.addProperty(Protocol.FIELD_Y, 120);
        json.addProperty(Protocol.FIELD_Z, -250);
        json.addProperty(Protocol.FIELD_MODE, "packet");
        json.addProperty(Protocol.FIELD_USE_FIREWORKS, true);
        json.addProperty(Protocol.FIELD_MIN_HEIGHT, 90);

        EflyRequest request = EflyRequest.parse(json);
        assertNotNull(request);
        assertTrue(request.hasTarget());
        assertEquals(100.0, request.x());
        assertEquals(120.0, request.y());
        assertEquals(-250.0, request.z());
        assertEquals("packet", request.mode());
        assertTrue(request.useFireworks());
        assertEquals(90.0, request.minHeight());
        assertTrue(request.startPathing());
    }

    @Test
    void partialTargetIsNotATarget() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_X, 10);
        json.addProperty(Protocol.FIELD_Z, 20);
        EflyRequest request = EflyRequest.parse(json);
        assertNotNull(request);
        assertFalse(request.hasTarget());
    }

    @Test
    void rejectsNonFiniteCoordinates() {
        JsonObject json = payload();
        // GSON serialises a non-finite double as a string token, which getAsDouble still parses to NaN.
        json.addProperty(Protocol.FIELD_X, Double.NaN);
        json.addProperty(Protocol.FIELD_Y, 64);
        json.addProperty(Protocol.FIELD_Z, 0);
        assertNull(EflyRequest.parse(json));
    }

    @Test
    void minHeightDefaultsWhenAbsent() {
        EflyRequest request = EflyRequest.parse(payload());
        assertEquals(EflyRequest.DEFAULT_MIN_HEIGHT, request.minHeight());
    }
}
