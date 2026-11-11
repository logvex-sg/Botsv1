package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.StorageRequests;
import org.junit.jupiter.api.Test;

/**
 * Parsing and validation of storage instructions.
 *
 * <p>This is the boundary before the client is touched, so every malformed request must be refused
 * here rather than reaching the game layer. The tests pin the contract the host relies on: which
 * fields are required, how aliases are accepted, and how limits and coordinates are clamped.
 */
class StorageRequestsTest {
    private static JsonObject payload() {
        return new JsonObject();
    }

    private static JsonObject at(JsonObject json, double x, double y, double z) {
        json.addProperty(Protocol.FIELD_X, x);
        json.addProperty(Protocol.FIELD_Y, y);
        json.addProperty(Protocol.FIELD_Z, z);
        return json;
    }

    // ------------------------------------------------------------------ container-read

    @Test
    void readsAContainerAtAFinitePosition() {
        JsonObject json = at(payload(), 10, 64, -20);
        json.addProperty(Protocol.FIELD_LABEL, "Diamonds");
        StorageRequests.ContainerRead request = StorageRequests.parseContainerRead(json);
        assertNotNull(request);
        assertEquals(10, request.x());
        assertEquals(64, request.y());
        assertEquals(-20, request.z());
        assertEquals("Diamonds", request.label());
    }

    @Test
    void refusesAContainerReadWithoutACoordinate() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_X, 10);
        assertNull(StorageRequests.parseContainerRead(json));
    }

    @Test
    void refusesANonFiniteContainerCoordinate() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_X, "NaN");
        json.addProperty(Protocol.FIELD_Y, 64);
        json.addProperty(Protocol.FIELD_Z, 0);
        assertNull(StorageRequests.parseContainerRead(json));
    }

    // ------------------------------------------------------------------ container-move

    @Test
    void parsesAWithdrawMoveWithADefaultLimit() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_QUERY, "diamond");
        StorageRequests.ContainerMove request = StorageRequests.parseContainerMove(json);
        assertNotNull(request);
        assertEquals(StorageRequests.Direction.WITHDRAW, request.direction());
        assertEquals("diamond", request.query());
        assertEquals(1, request.limit());
        assertFalse(request.hasTarget());
    }

    @Test
    void acceptsDepositAliases() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_QUERY, "dirt");
        json.addProperty(Protocol.FIELD_DIRECTION, "put");
        assertEquals(StorageRequests.Direction.DEPOSIT, StorageRequests.parseContainerMove(json).direction());
    }

    @Test
    void refusesAMoveWithoutAQuery() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_DIRECTION, "withdraw");
        assertNull(StorageRequests.parseContainerMove(json));
    }

    @Test
    void refusesAMoveWithAnUnknownDirection() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_QUERY, "diamond");
        json.addProperty(Protocol.FIELD_DIRECTION, "sideways");
        assertNull(StorageRequests.parseContainerMove(json));
    }

    @Test
    void clampsTheMoveLimitToTheMaximum() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_QUERY, "cobblestone");
        json.addProperty(Protocol.FIELD_LIMIT, 999_999);
        assertEquals(StorageRequests.MAX_LIMIT, StorageRequests.parseContainerMove(json).limit());
    }

    @Test
    void treatsAMoveWithCoordinatesAsTargeted() {
        JsonObject json = at(payload(), 1, 2, 3);
        json.addProperty(Protocol.FIELD_QUERY, "iron_ingot");
        assertTrue(StorageRequests.parseContainerMove(json).hasTarget());
    }

    // ------------------------------------------------------------------ shulkers

    @Test
    void defaultsShulkerSlotToEveryBox() {
        StorageRequests.ShulkerRead request = StorageRequests.parseShulkerRead(payload());
        assertEquals(-1, request.slot());
        assertFalse(request.hasSlot());
    }

    @Test
    void readsANamedShulkerSlot() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_SLOT, 12);
        StorageRequests.ShulkerRead request = StorageRequests.parseShulkerRead(json);
        assertEquals(12, request.slot());
        assertTrue(request.hasSlot());
    }

    @Test
    void unpackAcceptsAnEmptyPayload() {
        StorageRequests.ShulkerUnpack request = StorageRequests.parseShulkerUnpack(payload());
        assertNotNull(request);
        assertFalse(request.hasSlot());
    }

    @Test
    void parsesAShulkerPackWithAQueryAndLimit() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_QUERY, "cobblestone");
        json.addProperty(Protocol.FIELD_LIMIT, 512);
        json.addProperty(Protocol.FIELD_SLOT, 7);
        StorageRequests.ShulkerPack request = StorageRequests.parseShulkerPack(json);
        assertNotNull(request);
        assertEquals("cobblestone", request.query());
        assertEquals(512, request.limit());
        assertTrue(request.hasSlot());
    }

    @Test
    void refusesAShulkerPackWithoutAQuery() {
        assertNull(StorageRequests.parseShulkerPack(payload()));
        assertNull(StorageRequests.parseShulkerPack(null));
    }

    @Test
    void clampsAShulkerPackLimitToTheMaximum() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_QUERY, "dirt");
        json.addProperty(Protocol.FIELD_LIMIT, 999999);
        assertEquals(StorageRequests.MAX_LIMIT, StorageRequests.parseShulkerPack(json).limit());
    }

    // ------------------------------------------------------------------ restock

    @Test
    void parsesARestockWithASourceAndLimit() {
        JsonObject json = at(payload(), 5, 60, 5);
        json.addProperty(Protocol.FIELD_QUERY, "golden_apple");
        json.addProperty(Protocol.FIELD_LIMIT, 16);
        StorageRequests.Restock request = StorageRequests.parseRestock(json);
        assertNotNull(request);
        assertEquals("golden_apple", request.query());
        assertEquals(16, request.limit());
        assertTrue(request.hasSource());
    }

    @Test
    void refusesARestockWithoutAQuery() {
        assertNull(StorageRequests.parseRestock(payload()));
    }

    // ------------------------------------------------------------------ portal-scan

    @Test
    void defaultsAPortalScanToScanning() {
        StorageRequests.PortalScan request = StorageRequests.parsePortalScan(payload());
        assertNotNull(request);
        assertFalse(request.isRemove());
        assertEquals(24, request.radius());
        assertFalse(request.hasTarget());
    }

    @Test
    void acceptsARemovePortalAction() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_ACTION, "remove");
        json.addProperty(Protocol.FIELD_RADIUS, 8);
        StorageRequests.PortalScan request = StorageRequests.parsePortalScan(json);
        assertTrue(request.isRemove());
        assertEquals(8, request.radius());
    }

    @Test
    void refusesAnUnknownPortalAction() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_ACTION, "explode");
        assertNull(StorageRequests.parsePortalScan(json));
    }

    @Test
    void clampsThePortalRadiusToTheMaximum() {
        JsonObject json = payload();
        json.addProperty(Protocol.FIELD_RADIUS, 4096);
        assertEquals(StorageRequests.MAX_RADIUS, StorageRequests.parsePortalScan(json).radius());
    }

    @Test
    void toleratesANullPayloadForTheReadOnlyKinds() {
        assertNotNull(StorageRequests.parseShulkerRead(null));
        assertNotNull(StorageRequests.parseShulkerUnpack(null));
        assertNotNull(StorageRequests.parsePortalScan(null));
    }
}
