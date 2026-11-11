/**
 * Structure-registry tests: region normalisation, containment, overlap, issue flagging and the
 * change preview's safety checks.
 */
import { describe, expect, it } from 'vitest';
import {
  STRUCTURE_KINDS,
  centreOf,
  contains,
  countByKind,
  distanceBetween,
  fromPortal,
  issues,
  maintenanceDue,
  overlaps,
  previewChange,
  regionOf,
  volumeOf,
  type RegisteredStructure,
} from '../../src/main/packages/structure-registry';
import type { PortalRecord } from '../../src/shared/types';

function structure(overrides: Partial<RegisteredStructure> = {}): RegisteredStructure {
  return {
    id: 's1',
    name: 'Store',
    kind: 'storage_room',
    dimension: 'minecraft:overworld',
    x1: 0, y1: 60, z1: 0,
    x2: 10, y2: 70, z2: 10,
    ownership: '',
    protected: false,
    maintenance: 'ok',
    lastSeenBy: 'w1',
    lastSeenAt: 1000,
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('regions', () => {
  it('normalises corner order', () => {
    const region = regionOf(structure({ x1: 10, y1: 70, z1: 10, x2: 0, y2: 60, z2: 0 }));
    expect(region).toMatchObject({ minX: 0, minY: 60, minZ: 0, maxX: 10, maxY: 70, maxZ: 10 });
  });

  it('computes a centre and volume', () => {
    expect(centreOf(structure())).toEqual({ dimension: 'minecraft:overworld', x: 5, y: 65, z: 5 });
    expect(volumeOf(structure())).toBe(11 * 11 * 11);
  });

  it('contains points inside and rejects points outside or in another dimension', () => {
    const s = structure();
    expect(contains(s, 'minecraft:overworld', 5, 65, 5)).toBe(true);
    expect(contains(s, 'minecraft:overworld', 0, 60, 0)).toBe(true);
    expect(contains(s, 'minecraft:overworld', 11, 65, 5)).toBe(false);
    expect(contains(s, 'minecraft:the_nether', 5, 65, 5)).toBe(false);
  });
});

describe('overlap and distance', () => {
  it('detects overlapping regions in the same dimension', () => {
    const a = structure();
    const b = structure({ id: 's2', x1: 5, y1: 60, z1: 5, x2: 15, y2: 70, z2: 15 });
    expect(overlaps(a, b)).toBe(true);
  });

  it('treats disjoint regions and other dimensions as non-overlapping', () => {
    const a = structure();
    const far = structure({ id: 's2', x1: 100, y1: 60, z1: 100, x2: 110, y2: 70, z2: 110 });
    expect(overlaps(a, far)).toBe(false);
    const other = structure({ id: 's3', dimension: 'minecraft:the_nether' });
    expect(overlaps(a, other)).toBe(false);
  });

  it('measures distance between centres, and is infinite across dimensions', () => {
    const a = structure();
    const b = structure({ id: 's2', x1: 10, y1: 60, z1: 0, x2: 20, y2: 70, z2: 10 });
    expect(distanceBetween(a, b)).toBeCloseTo(10);
    expect(distanceBetween(a, structure({ id: 's3', dimension: 'minecraft:the_end' }))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('issues', () => {
  it('flags protected, unconfirmed, disabled and overdue structures', () => {
    const list = [
      structure({ id: 'p', protected: true }),
      structure({ id: 'u', lastSeenAt: null }),
      structure({ id: 'd', maintenance: 'disabled' }),
      structure({ id: 'o', maintenance: 'overdue' }),
    ];
    const reasons = issues(list).map((issue) => `${issue.structureId}:${issue.reason}`);
    expect(reasons).toContain('p:protected');
    expect(reasons).toContain('u:unconfirmed');
    expect(reasons).toContain('d:disabled');
    expect(reasons).toContain('o:maintenance');
  });

  it('flags both sides of an overlap', () => {
    const a = structure({ id: 'a' });
    const b = structure({ id: 'b', x1: 5, y1: 60, z1: 5, x2: 15, y2: 70, z2: 15 });
    const overlapsFound = issues([a, b]).filter((issue) => issue.reason === 'overlap');
    expect(overlapsFound.map((issue) => issue.structureId).sort()).toEqual(['a', 'b']);
  });
});

describe('maintenanceDue', () => {
  it('selects structures past the interval, skipping protected and disabled ones', () => {
    const now = 10_000;
    const list = [
      structure({ id: 'stale', lastSeenAt: 0 }),
      structure({ id: 'fresh', lastSeenAt: now - 10 }),
      structure({ id: 'protected', lastSeenAt: 0, protected: true }),
      structure({ id: 'disabled', lastSeenAt: 0, maintenance: 'disabled' }),
      structure({ id: 'due', maintenance: 'due' }),
    ];
    const due = maintenanceDue(list, 5000, now).map((s) => s.id).sort();
    expect(due).toEqual(['due', 'stale']);
  });
});

describe('previewChange', () => {
  it('lists overlapping structures and marks protected ones not actionable', () => {
    const list = [
      structure({ id: 'open' }),
      structure({ id: 'locked', protected: true }),
      structure({ id: 'far', x1: 100, y1: 60, z1: 100, x2: 110, y2: 70, z2: 110 }),
    ];
    const region = { dimension: 'minecraft:overworld', minX: 0, minY: 60, minZ: 0, maxX: 10, maxY: 70, maxZ: 10 };
    const preview = previewChange(list, region);
    const byId = new Map(preview.map((entry) => [entry.structureId, entry]));
    expect(byId.has('far')).toBe(false);
    expect(byId.get('open')?.actionable).toBe(true);
    expect(byId.get('locked')?.actionable).toBe(false);
    expect(byId.get('locked')?.reasons).toContain('structure is protected');
  });

  it('computes the touched block count as the region intersection', () => {
    const list = [structure({ id: 's', x1: 0, y1: 0, z1: 0, x2: 9, y2: 9, z2: 9 })];
    const region = { dimension: 'minecraft:overworld', minX: 5, minY: 5, minZ: 5, maxX: 20, maxY: 20, maxZ: 20 };
    const preview = previewChange(list, region);
    expect(preview[0]?.estimatedBlocks).toBe(5 * 5 * 5);
  });
});

describe('countByKind', () => {
  it('counts every kind, including the empty ones', () => {
    const counts = countByKind([structure({ kind: 'farm' }), structure({ id: 'b', kind: 'farm' }), structure({ id: 'c', kind: 'portal' })]);
    expect(counts.farm).toBe(2);
    expect(counts.portal).toBe(1);
    expect(counts.workshop).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...STRUCTURE_KINDS].sort());
  });
});

describe('fromPortal', () => {
  it('projects a portal record into a registered structure', () => {
    const portal: PortalRecord = {
      id: 'p1',
      name: 'Nether Hub',
      category: 'nether',
      dimension: 'minecraft:overworld',
      x: 8, y: 64, z: -3,
      permanent: true,
      temporary: false,
      needsMaintenance: false,
      tracking: true,
      lastSeenBy: 'w1',
      lastSeenAt: 500,
      obsolete: false,
      notes: 'hub',
      createdAt: 1,
      updatedAt: 2,
    };
    const s = fromPortal(portal);
    expect(s).toMatchObject({ id: 'p1', kind: 'portal', protected: true, dimension: 'minecraft:overworld' });
    expect(volumeOf(s)).toBe(1);
    expect(s.lastSeenBy).toBe('w1');
  });
});
