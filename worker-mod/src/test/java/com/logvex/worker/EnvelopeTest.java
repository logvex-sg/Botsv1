package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.google.gson.JsonObject;
import com.logvex.worker.core.Envelope;
import com.logvex.worker.core.Protocol;
import org.junit.jupiter.api.Test;

class EnvelopeTest {
    @Test
    void roundTripsThroughJson() {
        JsonObject payload = new JsonObject();
        payload.addProperty("kind", Protocol.TASK_COUNT);
        Envelope original = Envelope.reply(Protocol.TASK, "task-1", payload);

        Envelope decoded = Envelope.decode(original.encode());

        assertNotNull(decoded);
        assertEquals(Protocol.TASK, decoded.type);
        assertEquals("task-1", decoded.id);
        assertEquals(Protocol.VERSION, decoded.v);
        assertEquals(Protocol.TASK_COUNT, decoded.payload.get("kind").getAsString());
    }

    @Test
    void rejectsMalformedInput() {
        assertNull(Envelope.decode("not json"));
        assertNull(Envelope.decode("{\"id\":\"x\"}"));
        assertNull(Envelope.decode("[]"));
        assertNull(Envelope.decode(""));
        assertNull(Envelope.decode(null));
    }

    @Test
    void missingPayloadBecomesAnEmptyObject() {
        Envelope decoded = Envelope.decode("{\"type\":\"status\"}");
        assertNotNull(decoded);
        assertNotNull(decoded.payload);
        assertEquals(0, decoded.payload.size());
    }
}
