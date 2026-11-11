package com.logvex.hunter.core;

import com.logvex.hunter.core.stats.EliminationLog;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The elimination detector must never invent a kill and never claim one just because a player left
 * view. These tests pin down exactly when a disappearance counts.
 */
class EliminationLogTest {
    private static final String KEY = "uuid:steve";

    @Test
    void aRecentHitOnALowHealthPlayerCounts() {
        EliminationLog log = new EliminationLog(8_000, 6.0);
        log.noteAttack(KEY, "Steve", 1_000);
        log.noteHealth(KEY, 2.0, 1_500);
        assertTrue(log.confirm(KEY, 3_000));
    }

    @Test
    void aHealthyPlayerLeavingViewIsNotAKill() {
        EliminationLog log = new EliminationLog(8_000, 6.0);
        log.noteAttack(KEY, "Steve", 1_000);
        log.noteHealth(KEY, 18.0, 1_500);
        assertFalse(log.confirm(KEY, 3_000), "a struck but healthy player leaving view is not an elimination");
    }

    @Test
    void aPlayerNeverStruckIsNotAKill() {
        EliminationLog log = new EliminationLog(8_000, 6.0);
        log.noteHealth(KEY, 1.0, 1_500);
        assertFalse(log.confirm(KEY, 3_000), "walking out of range is not a kill");
    }

    @Test
    void anOldHitIsOutsideTheWindow() {
        EliminationLog log = new EliminationLog(8_000, 6.0);
        log.noteAttack(KEY, "Steve", 1_000);
        log.noteHealth(KEY, 1.0, 1_500);
        assertFalse(log.confirm(KEY, 20_000), "the hit is too old to attribute the disappearance");
    }

    @Test
    void aKillIsConsumedSoItIsNeverCountedTwice() {
        EliminationLog log = new EliminationLog(8_000, 6.0);
        log.noteAttack(KEY, "Steve", 1_000);
        log.noteHealth(KEY, 1.0, 1_500);
        assertTrue(log.confirm(KEY, 2_000));
        assertFalse(log.confirm(KEY, 2_100), "the same evidence cannot confirm a second kill");
        assertEquals(0, log.trackedCount());
    }

    @Test
    void unknownHealthDoesNotConfirm() {
        EliminationLog log = new EliminationLog(8_000, 6.0);
        log.noteAttack(KEY, "Steve", 1_000);
        assertFalse(log.confirm(KEY, 2_000), "no health observed means no evidence of a kill");
    }

    @Test
    void forgetClearsEvidence() {
        EliminationLog log = new EliminationLog(8_000, 6.0);
        log.noteAttack(KEY, "Steve", 1_000);
        log.noteHealth(KEY, 1.0, 1_500);
        log.forget(KEY);
        assertFalse(log.confirm(KEY, 2_000));
    }
}
