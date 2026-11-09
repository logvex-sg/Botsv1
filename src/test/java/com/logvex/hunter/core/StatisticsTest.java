package com.logvex.hunter.core;

import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.stats.SessionRecord;
import com.logvex.hunter.core.stats.Statistics;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StatisticsTest {
    @Test
    void countersAccumulate() {
        Statistics stats = new Statistics();
        stats.addKill();
        stats.addKill("Steve");
        stats.addDeath();
        stats.addEncounter();
        stats.addTrackedTarget();
        stats.addManualSwitch();
        stats.addSession();

        assertEquals(2, stats.totalKills());
        assertEquals(1, stats.totalDeaths());
        assertEquals(1, stats.playerEncounters());
        assertEquals(1, stats.targetsTracked());
        assertEquals(1, stats.manualTargetSwitches());
        assertEquals(1, stats.sessions());
    }

    @Test
    void kdRatioHandlesZeroDeaths() {
        Statistics stats = new Statistics();
        stats.addKill();
        stats.addKill();
        assertEquals(2.0, stats.kdRatio(), 1e-9);

        stats.addDeath();
        assertEquals(2.0, stats.kdRatio(), 1e-9);
    }

    @Test
    void killsByTargetTracked() {
        Statistics stats = new Statistics();
        stats.addKill("Steve");
        stats.addKill("Steve");
        stats.addKill("Alex");

        assertEquals(2, stats.killsByTarget().get("steve"));
        assertEquals(1, stats.killsByTarget().get("alex"));
    }

    @Test
    void moduleAndEquipmentActivations() {
        Statistics stats = new Statistics();
        stats.recordModuleActivation("player-tracker");
        stats.recordModuleActivation("player-tracker");
        stats.recordEquipment("netherite_sword");

        assertEquals(2, stats.moduleActivations().get("player-tracker"));
        assertEquals(1, stats.equipmentUses().get("netherite_sword"));
    }

    @Test
    void recentEventsAreCappedAndNewestFirst() {
        Statistics stats = new Statistics();
        for (int i = 0; i < Statistics.MAX_EVENTS + 20; i++) {
            stats.addEvent(new CombatEvent(i, CombatEvent.Kind.INFO, "event " + i, ""));
        }

        assertEquals(Statistics.MAX_EVENTS, stats.recentEvents().size());
        assertEquals("event " + (Statistics.MAX_EVENTS + 19), stats.recentEvents().get(stats.recentEvents().size() - 1).message);
        assertEquals("event " + (Statistics.MAX_EVENTS + 19), stats.recentEvents(1).get(0).message);
    }

    @Test
    void sessionHistoryIsCapped() {
        Statistics stats = new Statistics();
        for (int i = 0; i < Statistics.MAX_SESSIONS + 10; i++) {
            SessionRecord record = new SessionRecord("s" + i, i);
            record.close(i + 100);
            stats.addSession(record);
        }

        assertEquals(Statistics.MAX_SESSIONS, stats.sessionHistory().size());
    }

    @Test
    void resetClearsEverything() {
        Statistics stats = new Statistics();
        stats.addKill("Steve");
        stats.addDeath();
        stats.recordModuleActivation("m");
        stats.reset();

        assertEquals(0, stats.totalKills());
        assertEquals(0, stats.totalDeaths());
        assertTrue(stats.moduleActivations().isEmpty());
        assertTrue(stats.killsByTarget().isEmpty());
    }

    @Test
    void jsonRoundTripPreservesCounters() {
        Statistics stats = new Statistics();
        stats.addKill("Steve");
        stats.addDeath();
        stats.addEncounter();
        stats.recordModuleActivation("player-tracker");
        stats.recordEquipment("netherite_sword");
        SessionRecord record = new SessionRecord("s1", 1000);
        record.close(2000);
        record.kills = 3;
        stats.addSession(record);
        stats.addEvent(new CombatEvent(1000, CombatEvent.Kind.KILL, "killed Steve", ""));

        Statistics restored = Statistics.fromJson(stats.toJson());

        assertEquals(1, restored.totalKills());
        assertEquals(1, restored.totalDeaths());
        assertEquals(1, restored.playerEncounters());
        assertEquals(1, restored.moduleActivations().get("player-tracker"));
        assertEquals(1, restored.equipmentUses().get("netherite_sword"));
        assertEquals(1, restored.sessionHistory().size());
        assertEquals(3, restored.sessionHistory().get(0).kills);
        assertEquals(1, restored.recentEvents().size());
    }

    @Test
    void csvContainsHeaderAndMetrics() {
        Statistics stats = new Statistics();
        stats.addKill();
        String csv = stats.toCsv();

        assertTrue(csv.startsWith("metric,value"));
        assertTrue(csv.contains("totalKills,1"));
    }

    @Test
    void playtimeAccumulates() {
        Statistics stats = new Statistics();
        stats.addPlaytime(1500);
        stats.addPlaytime(500);
        assertEquals(2000, stats.totalPlaytimeMillis());
    }

    @Test
    void averageSessionMillisIsZeroWithoutSessions() {
        Statistics stats = new Statistics();
        assertEquals(0, stats.averageSessionMillis(), 1e-9);
    }

    @Test
    void sessionDurationsMinutesReturnsRecentValues() {
        Statistics stats = new Statistics();
        SessionRecord record = new SessionRecord("s1", 0);
        record.close(120_000);
        stats.addSession(record);

        var durations = stats.sessionDurationsMinutes(5);
        assertEquals(1, durations.size());
        assertNotNull(durations.get(0));
        assertEquals(2.0, durations.get(0), 1e-9);
    }

    @Test
    void eventRevisionBumpsOnlyWhenAnEventIsRecorded() {
        Statistics stats = new Statistics();
        long start = stats.eventRevision();
        assertEquals(start, stats.eventRevision());
        stats.addEvent(CombatEvent.now(CombatEvent.Kind.KILL, "x", ""));
        assertTrue(stats.eventRevision() > start);
        long afterFirst = stats.eventRevision();
        stats.addEvent(null);
        assertEquals(afterFirst, stats.eventRevision());
    }
}
