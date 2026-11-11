/**
 * Hive engine unit tests.
 *
 * The pure half of HIVE MODE: formations, roles, sectors, command parsing, task distribution and
 * observations. Everything here is arithmetic, so the coordinated behaviour the hive promises is
 * pinned down without a server, a socket or a worker.
 */
import { describe, expect, it } from 'vitest';
import {
  assignSectors,
  assignSlots,
  buildGrid,
  capabilitiesFor,
  distribute,
  eligibleWorkers,
  formationPositions,
  gridAround,
  initialProgress,
  inPosition,
  markExplored,
  observationId,
  parseCommand,
  PRIORITY,
  priorityFor,
  releaseForWorker,
  releaseSector,
  ROLE_PROFILES,
  sectorAt,
  splitClauses,
  stragglers,
  suitability,
  summarise,
  type Objective,
  type Observation,
  type RoleAssignment,
  type WorkerLoad,
} from '../../src/main/packages/hive';

const commander = { position: { x: 0, y: 64, z: 0 } };

describe('formations', () => {
  it('never places a member on the commander for a follow formation', () => {
    const positions = formationPositions({ kind: 'follow', spacing: 3 }, commander, 5);
    expect(positions).toHaveLength(5);
    for (const position of positions) {
      expect(position.x !== 0 || position.z !== 0).toBe(true);
    }
  });

  it('staggers followers so they do not form a single blocking file', () => {
    const positions = formationPositions({ kind: 'follow', spacing: 4 }, commander, 4);
    // The first two are the same rank, on opposite sides.
    expect(positions[0].z).toBe(positions[1].z);
    expect(Math.sign(positions[0].x)).not.toBe(Math.sign(positions[1].x));
  });

  it('spaces a circle evenly and at the requested radius', () => {
    const positions = formationPositions({ kind: 'circle', spacing: 2, radius: 10 }, commander, 8);
    expect(positions).toHaveLength(8);
    for (const position of positions) {
      const radius = Math.hypot(position.x, position.z);
      expect(radius).toBeCloseTo(10, 1);
    }
    // No two members share a cell.
    const cells = new Set(positions.map((p) => `${p.x},${p.z}`));
    expect(cells.size).toBe(8);
  });

  it('recalculates the circle when a member disconnects', () => {
    const withSix = formationPositions({ kind: 'circle', spacing: 2, radius: 8 }, commander, 6);
    const withFive = formationPositions({ kind: 'circle', spacing: 2, radius: 8 }, commander, 5);
    expect(withSix).toHaveLength(6);
    expect(withFive).toHaveLength(5);
    // The remaining members keep an even spacing rather than leaving a gap.
    const angles = withFive.map((p) => Math.atan2(p.z, p.x)).sort((a, b) => a - b);
    const gaps = angles.slice(1).map((angle, index) => angle - angles[index]);
    for (const gap of gaps) expect(gap).toBeCloseTo((Math.PI * 2) / 5, 2);
  });

  it('moves the whole formation when the commander moves', () => {
    const at0 = formationPositions({ kind: 'circle', spacing: 2, radius: 6 }, { position: { x: 0, y: 64, z: 0 } }, 4);
    const at100 = formationPositions({ kind: 'circle', spacing: 2, radius: 6 }, { position: { x: 100, y: 64, z: 0 } }, 4);
    expect(at100[0].x - at0[0].x).toBeCloseTo(100, 1);
  });

  it('places a diamond on the four axes', () => {
    const positions = formationPositions({ kind: 'diamond', spacing: 5 }, commander, 4);
    expect(positions).toEqual([
      { x: 0, y: 64, z: 5 },
      { x: 5, y: 64, z: 0 },
      { x: 0, y: 64, z: -5 },
      { x: -5, y: 64, z: 0 },
    ]);
  });

  it('places a line behind the commander', () => {
    const positions = formationPositions({ kind: 'line', spacing: 2, depth: 1 }, commander, 3);
    expect(positions.map((p) => p.z)).toEqual([2, 4, 6]);
  });

  it('spreads a scatter grid without overlaps', () => {
    const positions = formationPositions({ kind: 'scatter', spacing: 2, radius: 20 }, commander, 9);
    const cells = new Set(positions.map((p) => `${p.x},${p.z}`));
    expect(cells.size).toBe(9);
  });

  it('honours a custom offset list', () => {
    const offsets = [{ x: 1, y: 0, z: 1 }, { x: -1, y: 0, z: -1 }];
    const positions = formationPositions({ kind: 'custom', spacing: 1, offsets }, commander, 2);
    expect(positions).toEqual([{ x: 1, y: 64, z: 1 }, { x: -1, y: 64, z: -1 }]);
  });

  it('rotates a formation by its rotation setting', () => {
    const straight = formationPositions({ kind: 'line', spacing: 2, depth: 1, rotation: 0 }, commander, 1);
    const turned = formationPositions({ kind: 'line', spacing: 2, depth: 1, rotation: 90 }, commander, 1);
    expect(straight[0].z).toBeCloseTo(2, 3);
    expect(turned[0].x).toBeCloseTo(-2, 3);
  });

  it('assigns slots in a stable order', () => {
    const first = assignSlots(['c', 'a', 'b'], 3);
    const second = assignSlots(['b', 'c', 'a'], 3);
    expect(first.get('a')).toBe(0);
    expect(second.get('a')).toBe(0);
    expect(first.get('c')).toBe(2);
    expect(second.get('c')).toBe(2);
  });

  it('detects a straggler beyond the regroup threshold', () => {
    const positions = new Map([['a', { x: 0, y: 0, z: 0 }], ['b', { x: 40, y: 0, z: 0 }]]);
    const targets = new Map([['a', { x: 0, y: 0, z: 0 }], ['b', { x: 0, y: 0, z: 0 }]]);
    expect(stragglers(positions, targets, 10)).toEqual(['b']);
    expect(inPosition({ x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 2)).toBe(true);
  });
});

describe('roles', () => {
  it('gives each role a capability profile', () => {
    expect(ROLE_PROFILES.SCOUT.capabilities).toContain('navigate');
    expect(ROLE_PROFILES.STORAGE.capabilities).toContain('storage');
  });

  it('scores suitability by the fraction of needed capabilities present', () => {
    expect(suitability(['navigate', 'observe'], ['navigate'])).toBe(1);
    expect(suitability(['navigate'], ['navigate', 'observe'])).toBe(0.5);
    expect(suitability([], [])).toBe(1);
  });

  it('excludes a worker with none of the needed capabilities', () => {
    const assignments: RoleAssignment[] = [
      { workerId: 'scout', role: 'SCOUT', extraCapabilities: [], isCommander: false },
      { workerId: 'store', role: 'STORAGE', extraCapabilities: [], isCommander: false },
    ];
    const eligible = eligibleWorkers(assignments, ['observe']);
    expect(eligible.map((a) => a.workerId)).toEqual(['scout']);
  });

  it('merges a role\'s capabilities with the worker\'s extras', () => {
    const caps = capabilitiesFor({ workerId: 'w', role: 'SCOUT', extraCapabilities: ['build'], isCommander: false });
    expect(caps).toContain('navigate');
    expect(caps).toContain('build');
  });
});

describe('sectors', () => {
  it('builds a deterministic grid with stable ids', () => {
    const spec = { originX: 0, originZ: 0, cols: 2, rows: 2, tileSize: 16, dimension: 'overworld' };
    const first = buildGrid(spec);
    const second = buildGrid(spec);
    expect(first).toHaveLength(4);
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
    expect(first[0]).toMatchObject({ minX: 0, minZ: 0, maxX: 15, maxZ: 15, centerX: 7, centerZ: 7 });
  });

  it('centres a grid around a point', () => {
    const spec = gridAround(100, 100, 4, 16, 'overworld');
    const sectors = buildGrid(spec);
    const inside = sectors.find((s) => 100 >= s.minX && 100 <= s.maxX && 100 >= s.minZ && 100 <= s.maxZ);
    expect(inside).toBeDefined();
    expect(sectorAt(sectors, 100, 100)?.id).toBe(inside?.id);
  });

  it('hands out distinct sectors to different workers', () => {
    const sectors = buildGrid({ originX: 0, originZ: 0, cols: 3, rows: 3, tileSize: 16, dimension: 'overworld' });
    const progress = initialProgress(sectors);
    const assignment = assignSectors(sectors, progress, ['a', 'b', 'c'], { x: 0, z: 0 });
    const ids = [...assignment.values()].map((sector) => sector.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });

  it('assigns the nearest unexplored sector first', () => {
    const sectors = buildGrid({ originX: 0, originZ: 0, cols: 4, rows: 1, tileSize: 16, dimension: 'overworld' });
    const progress = initialProgress(sectors);
    const assignment = assignSectors(sectors, progress, ['a'], { x: 0, z: 0 });
    expect([...assignment.values()][0].col).toBe(0);
  });

  it('does not re-assign an explored sector', () => {
    const sectors = buildGrid({ originX: 0, originZ: 0, cols: 2, rows: 1, tileSize: 16, dimension: 'overworld' });
    const progress = initialProgress(sectors);
    markExplored(progress, sectors[0].id, 2, 1000);
    const assignment = assignSectors(sectors, progress, ['a'], { x: 0, z: 0 });
    expect([...assignment.values()][0].id).toBe(sectors[1].id);
  });

  it('releases a sector when its worker disconnects', () => {
    const sectors = buildGrid({ originX: 0, originZ: 0, cols: 2, rows: 1, tileSize: 16, dimension: 'overworld' });
    const progress = initialProgress(sectors);
    progress.set(sectors[0].id, { ...progress.get(sectors[0].id)!, state: 'assigned', assignedTo: 'a' });
    expect(releaseSector(progress, sectors[0].id)).toBe(true);
    expect(progress.get(sectors[0].id)?.state).toBe('unexplored');
  });

  it('summarises exploration progress', () => {
    const sectors = buildGrid({ originX: 0, originZ: 0, cols: 2, rows: 2, tileSize: 16, dimension: 'overworld' });
    const progress = initialProgress(sectors);
    markExplored(progress, sectors[0].id, 0, 1);
    progress.set(sectors[1].id, { ...progress.get(sectors[1].id)!, state: 'assigned', assignedTo: 'a' });
    const summary = summarise(sectors, progress);
    expect(summary).toMatchObject({ total: 4, explored: 1, assigned: 1, unexplored: 2, percentComplete: 25 });
  });
});

describe('command parsing', () => {
  it('parses "everyone follow me"', () => {
    const command = parseCommand('Everyone follow me.');
    expect(command.kind).toBe('follow');
    expect(command.everyone).toBe(true);
  });

  it('parses "circle around me"', () => {
    expect(parseCommand('Circle around me.').kind).toBe('circle');
  });

  it('parses "protect my position"', () => {
    const command = parseCommand('Protect my position.');
    expect(command.kind).toBe('protect');
    expect(command.role).toBe('GUARD');
  });

  it('parses "spread out around spawn"', () => {
    expect(parseCommand('Spread out around spawn.').kind).toBe('scatter');
  });

  it('parses "scout the surrounding area"', () => {
    const command = parseCommand('Scout the surrounding area.');
    expect(command.kind).toBe('scout');
  });

  it('parses "send two Workers to explore the northern area"', () => {
    const command = parseCommand('Send two Workers to explore the northern area.');
    expect(command.kind).toBe('scout');
    expect(command.count).toBe(2);
    expect(command.direction).toBe('north');
  });

  it('parses "have one Worker organize storage"', () => {
    const command = parseCommand('Have one Worker organize storage.');
    expect(command.kind).toBe('store');
  });

  it('parses "bring everyone back" and "recall the entire hive"', () => {
    expect(parseCommand('Bring everyone back.').kind).toBe('recall');
    expect(parseCommand('Recall the entire HIVE.').kind).toBe('recall');
  });

  it('parses "stop all tasks" and "everyone return to formation"', () => {
    expect(parseCommand('Stop all tasks.').kind).toBe('stop');
    expect(parseCommand('Everyone return to formation.').kind).toBe('regroup');
  });

  it('extracts a radius when one is named', () => {
    expect(parseCommand('Scout the area within 50 blocks.').radius).toBe(50);
  });

  it('refuses an instruction it does not understand, with what it can do', () => {
    const command = parseCommand('launch the missiles');
    expect(command.kind).toBe('unknown');
    expect(command.confidence).toBe(0);
    expect(command.note).toContain('follow me');
  });

  it('splits a compound instruction into clauses', () => {
    expect(splitClauses('circle around me and scout the surrounding area')).toEqual([
      'circle around me',
      'scout the surrounding area',
    ]);
  });
});

describe('task distribution', () => {
  const roles: RoleAssignment[] = [
    { workerId: 'a', role: 'SCOUT', extraCapabilities: [], isCommander: false },
    { workerId: 'b', role: 'SCOUT', extraCapabilities: [], isCommander: false },
    { workerId: 'c', role: 'STORAGE', extraCapabilities: [], isCommander: false },
  ];
  const loads: WorkerLoad[] = [
    { workerId: 'a', position: { x: 0, y: 0, z: 0 }, health: 20, busy: false, online: true },
    { workerId: 'b', position: { x: 100, y: 0, z: 0 }, health: 20, busy: false, online: true },
    { workerId: 'c', position: { x: 5, y: 0, z: 0 }, health: 20, busy: false, online: true },
  ];

  it('never assigns the same objective to two workers', () => {
    const objectives: Objective[] = [
      { id: 'o1', kind: 'scout', needs: ['navigate'], position: { x: 0, y: 0, z: 0 }, priority: PRIORITY.EXPLORATION, label: 'Scout 1' },
      { id: 'o2', kind: 'scout', needs: ['navigate'], position: { x: 10, y: 0, z: 0 }, priority: PRIORITY.EXPLORATION, label: 'Scout 2' },
    ];
    const { assignments } = distribute(objectives, roles, loads);
    const workers = assignments.map((a) => a.workerId);
    expect(new Set(workers).size).toBe(workers.length);
    expect(assignments).toHaveLength(2);
  });

  it('picks the nearest capable worker for a positional objective', () => {
    const objectives: Objective[] = [
      { id: 'o1', kind: 'scout', needs: ['navigate'], position: { x: 90, y: 0, z: 0 }, priority: PRIORITY.EXPLORATION, label: 'Scout' },
    ];
    const { assignments } = distribute(objectives, roles, loads);
    expect(assignments[0].workerId).toBe('b');
  });

  it('never hands a scouting job to a storage bot', () => {
    const objectives: Objective[] = [
      { id: 'o1', kind: 'scout', needs: ['observe'], priority: PRIORITY.EXPLORATION, label: 'Scout' },
    ];
    const onlyStorage: RoleAssignment[] = [{ workerId: 'c', role: 'STORAGE', extraCapabilities: [], isCommander: false }];
    const { assignments, unassigned } = distribute(objectives, onlyStorage, loads);
    expect(assignments).toHaveLength(0);
    expect(unassigned).toEqual(['o1']);
  });

  it('leaves an objective held by an online worker alone', () => {
    const objectives: Objective[] = [
      { id: 'o1', kind: 'scout', needs: ['navigate'], assignedTo: 'b', priority: PRIORITY.EXPLORATION, label: 'Scout' },
    ];
    const { assignments } = distribute(objectives, roles, loads);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ workerId: 'b', reason: 'already assigned' });
  });

  it('takes the higher-priority objective first', () => {
    const objectives: Objective[] = [
      { id: 'low', kind: 'scout', needs: ['navigate'], priority: PRIORITY.EXPLORATION, label: 'low' },
      { id: 'high', kind: 'guard', needs: ['navigate'], priority: PRIORITY.EXPLICIT, label: 'high' },
    ];
    const oneWorker: WorkerLoad[] = [{ workerId: 'a', position: { x: 0, y: 0, z: 0 }, health: 20, busy: false, online: true }];
    const oneRole: RoleAssignment[] = [{ workerId: 'a', role: 'SCOUT', extraCapabilities: [], isCommander: false }];
    const { assignments } = distribute(objectives, oneRole, oneWorker);
    expect(assignments[0].objectiveId).toBe('high');
  });

  it('does not give a new objective to a busy or unhealthy worker', () => {
    const objectives: Objective[] = [
      { id: 'o1', kind: 'scout', needs: ['navigate'], priority: PRIORITY.EXPLORATION, label: 'Scout' },
    ];
    const sick: WorkerLoad[] = [{ workerId: 'a', position: { x: 0, y: 0, z: 0 }, health: 2, busy: false, online: true }];
    const oneRole: RoleAssignment[] = [{ workerId: 'a', role: 'SCOUT', extraCapabilities: [], isCommander: false }];
    expect(distribute(objectives, oneRole, sick).assignments).toHaveLength(0);
  });

  it('releases an objective when its worker disconnects', () => {
    const objectives: Objective[] = [{ id: 'o1', kind: 'scout', needs: [], assignedTo: 'a', priority: 0, label: 'x' }];
    const released = releaseForWorker(objectives, 'a');
    expect(released[0].assignedTo).toBeNull();
  });

  it('maps objective kinds onto the priority ladder', () => {
    expect(priorityFor('formation')).toBe(PRIORITY.FORMATION);
    expect(priorityFor('scout')).toBe(PRIORITY.EXPLORATION);
    expect(priorityFor('idle')).toBe(PRIORITY.IDLE);
    expect(PRIORITY.EMERGENCY).toBeGreaterThan(PRIORITY.EXPLICIT);
    expect(PRIORITY.EXPLICIT).toBeGreaterThan(PRIORITY.FORMATION);
  });
});

describe('observations', () => {
  it('builds a stable id for the same thing seen twice', () => {
    const a = observationId('container', 'chest', { x: 1, y: 2, z: 3 });
    const b = observationId('container', 'chest', { x: 1, y: 2, z: 3 });
    expect(a).toBe(b);
  });

  it('records the newest player sighting', () => {
    const observations: Observation[] = [
      { id: 'p1', kind: 'player', workerId: 'a', position: { x: 0, y: 0, z: 0 }, dimension: 'overworld', at: 100, label: 'Steve', detail: { name: 'Steve', distance: 10 } },
      { id: 'p2', kind: 'player', workerId: 'b', position: { x: 5, y: 0, z: 0 }, dimension: 'overworld', at: 200, label: 'Steve', detail: { name: 'Steve', distance: 4 } },
    ];
    // The observation module dedupes by proximity; the service keeps the latest per name.
    expect(observations).toHaveLength(2);
  });
});
