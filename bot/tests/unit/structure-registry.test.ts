import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAINTENANCE_INTERVAL_DAYS,
  OVERDUE_GRACE_DAYS,
  centreOf,
  contains,
  countByKind,
  regionDistance,
  findByPoint,
  fromPortal,
  issues,
  maintenanceDue,
  maintenanceStateFor,
  overlaps,
  previewChange,
  regionOf,
  volumeOf,
} from '../../src/core/engine/structure-registry';
import type { PortalRecord, Region, RegisteredStructure, Vec3 } from '../../src/core/types';

const DAY = 24 * 60 * 60 * 1000;

const structure = (over: Partial<RegisteredStructure> & { id: string; region: Region }): RegisteredStructure => ({
  name: over.id,
  kind: 'storage',
  protected: false,
  maintenance: 'ok',
  createdAt: 0,
  ...over,
});

const box = (min: Vec3, max: Vec3, dimension = 'overworld'): Region => ({ min, max, dimension });

describe('regionOf', () => {
  it('normalises corners regardless of argument order', () => {
    const region = regionOf({ x: 10, y: 5, z: 3 }, { x: 0, y: 8, z: 1 }, 'overworld');
    expect(region.min).toEqual({ x: 0, y: 5, z: 1 });
    expect(region.max).toEqual({ x: 10, y: 8, z: 3 });
    expect(region.dimension).toBe('overworld');
  });
});

describe('volumeOf', () => {
  it('counts both inclusive endpoints', () => {
    expect(volumeOf(box({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }))).toBe(1);
    expect(volumeOf(box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }))).toBe(8);
  });
});

describe('centreOf', () => {
  it('returns the floored centre', () => {
    expect(centreOf(box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 }))).toEqual({ x: 2, y: 2, z: 2 });
    expect(centreOf(box({ x: 0, y: 0, z: 0 }, { x: 3, y: 3, z: 3 }))).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe('contains', () => {
  const region = box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 });

  it('includes the boundary corners', () => {
    expect(contains(region, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(contains(region, { x: 4, y: 4, z: 4 })).toBe(true);
    expect(contains(region, { x: 2, y: 2, z: 2 })).toBe(true);
  });

  it('excludes a point just outside', () => {
    expect(contains(region, { x: 5, y: 2, z: 2 })).toBe(false);
  });

  it('returns false on a dimension mismatch', () => {
    expect(contains(region, { x: 2, y: 2, z: 2 }, 'nether')).toBe(false);
    expect(contains(region, { x: 2, y: 2, z: 2 }, 'overworld')).toBe(true);
  });
});

describe('overlaps', () => {
  it('treats touching edges as overlapping because bounds are inclusive', () => {
    const a = box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 });
    const b = box({ x: 4, y: 0, z: 0 }, { x: 8, y: 4, z: 4 });
    expect(overlaps(a, b)).toBe(true);
  });

  it('reports no overlap when there is a gap', () => {
    const a = box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 });
    const b = box({ x: 5, y: 0, z: 0 }, { x: 8, y: 4, z: 4 });
    expect(overlaps(a, b)).toBe(false);
  });

  it('never overlaps across dimensions', () => {
    const a = box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 }, 'overworld');
    const b = box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 }, 'nether');
    expect(overlaps(a, b)).toBe(false);
  });
});

describe('regionDistance', () => {
  it('is zero for overlapping or touching regions', () => {
    const a = box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 });
    const b = box({ x: 2, y: 0, z: 0 }, { x: 6, y: 4, z: 4 });
    expect(regionDistance(a, b)).toBe(0);
  });

  it('measures the gap between separated regions', () => {
    const a = box({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const b = box({ x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
    expect(regionDistance(a, b)).toBe(3);
  });
});

describe('issues', () => {
  const now = 100 * DAY;

  it('reports protected, overdue, unconfirmed, unsized and overlapping issues', () => {
    const protectedStruct = structure({
      id: 'p',
      region: box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
      protected: true,
      maintenance: 'overdue',
      lastMaintainedAt: now - 100 * DAY,
    });
    const unsized = structure({
      id: 'u',
      region: box({ x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
    });
    const a = structure({ id: 'a', region: box({ x: 10, y: 0, z: 0 }, { x: 12, y: 2, z: 2 }) });
    const b = structure({ id: 'b', region: box({ x: 11, y: 0, z: 0 }, { x: 13, y: 2, z: 2 }) });

    const found = issues([protectedStruct, unsized, a, b], now);
    const kinds = found.map((issue) => issue.kind);
    expect(kinds).toContain('protected');
    expect(kinds).toContain('overdue');
    expect(kinds).toContain('unconfirmed');
    expect(kinds).toContain('unsized');
    expect(kinds).toContain('overlapping');
  });

  it('reports nothing for a fresh, protected-free, in-bounds set', () => {
    const clean = structure({
      id: 'clean',
      region: box({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }),
      lastMaintainedAt: now,
    });
    expect(issues([clean], now)).toEqual([]);
  });
});

describe('maintenanceDue', () => {
  it('skips protected structures', () => {
    const guarded = structure({
      id: 'guarded',
      region: box({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      protected: true,
      maintenanceIntervalDays: 1,
    });
    expect(maintenanceDue([guarded], 100 * DAY)).toEqual([]);
  });

  it('sorts worst-first by overdue time', () => {
    const slightly = structure({
      id: 'slightly',
      region: box({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      maintenanceIntervalDays: 7,
      lastMaintainedAt: 100 * DAY - 8 * DAY,
    });
    const veryOverdue = structure({
      id: 'very',
      region: box({ x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }),
      maintenanceIntervalDays: 7,
      lastMaintainedAt: 100 * DAY - 30 * DAY,
    });
    const due = maintenanceDue([slightly, veryOverdue], 100 * DAY);
    expect(due.map((entry) => entry.id)).toEqual(['very', 'slightly']);
  });

  it('uses createdAt when never maintained', () => {
    const neverMaintained = structure({
      id: 'new',
      region: box({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      maintenanceIntervalDays: 1,
      createdAt: 99 * DAY,
    });
    expect(maintenanceDue([neverMaintained], 100 * DAY).map((entry) => entry.id)).toEqual(['new']);
  });
});

describe('maintenanceStateFor', () => {
  it('returns ok, due and overdue around the interval and grace window', () => {
    const base = { createdAt: 0 };
    expect(maintenanceStateFor({ ...base, maintenanceIntervalDays: 7 }, 3 * DAY)).toBe('ok');
    expect(maintenanceStateFor({ ...base, maintenanceIntervalDays: 7 }, 7 * DAY)).toBe('due');
    expect(maintenanceStateFor({ ...base, maintenanceIntervalDays: 7 }, (7 + OVERDUE_GRACE_DAYS) * DAY)).toBe('overdue');
  });

  it('falls back to the default interval', () => {
    expect(maintenanceStateFor({ createdAt: 0 }, (DEFAULT_MAINTENANCE_INTERVAL_DAYS - 1) * DAY)).toBe('ok');
  });
});

describe('previewChange', () => {
  const region = box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 });
  const touched = structure({
    id: 'touched',
    region: box({ x: 2, y: 2, z: 2 }, { x: 6, y: 6, z: 6 }),
  });
  const guarded = structure({
    id: 'guarded',
    region: box({ x: 1, y: 1, z: 1 }, { x: 3, y: 3, z: 3 }),
    protected: true,
  });
  const faraway = structure({
    id: 'far',
    region: box({ x: 100, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }),
  });

  it('lists only the structures the region touches', () => {
    const preview = previewChange(region, [touched, faraway]);
    expect(preview.touched.map((entry) => entry.structureId)).toEqual(['touched']);
    expect(preview.safe).toBe(true);
    expect(preview.volume).toBe(125);
  });

  it('marks a protected structure as not actionable and the preview unsafe', () => {
    const preview = previewChange(region, [touched, guarded]);
    const protectedEntry = preview.touched.find((entry) => entry.structureId === 'guarded')!;
    expect(protectedEntry.protected).toBe(true);
    expect(protectedEntry.actionable).toBe(false);
    expect(preview.safe).toBe(false);
    expect(preview.reason).toContain('protected structure(s) are in the way');
  });

  it('honours excludeIds', () => {
    const preview = previewChange(region, [guarded], { excludeIds: ['guarded'] });
    expect(preview.touched).toEqual([]);
    expect(preview.safe).toBe(true);
    expect(preview.reason).toBe('the change touches no registered structure');
  });
});

describe('countByKind', () => {
  it('counts structures per kind', () => {
    const structures = [
      structure({ id: 'a', region: box({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), kind: 'storage' }),
      structure({ id: 'b', region: box({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), kind: 'farm' }),
      structure({ id: 'c', region: box({ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }), kind: 'storage' }),
    ];
    expect(countByKind(structures)).toEqual({ storage: 2, farm: 1 });
  });
});

describe('fromPortal', () => {
  it('projects an unconfirmed portal as a protected single-block structure', () => {
    const portal: PortalRecord = {
      id: 'nether-1',
      label: 'Nether Gate',
      position: { x: 5, y: 6, z: 7 },
      dimension: 'overworld',
      target: { x: 1, y: 2, z: 3 },
      targetDimension: 'nether',
      registeredAt: 100,
      lastSeenAt: 200,
      confirmed: false,
    };
    const projected = fromPortal(portal);
    expect(projected.id).toBe('portal:nether-1');
    expect(projected.protected).toBe(true);
    expect(projected.kind).toBe('other');
    expect(volumeOf(projected.region)).toBe(1);
    expect(projected.region.min).toEqual({ x: 5, y: 6, z: 7 });
    expect(projected.notes).toContain('nether');
  });

  it('projects a confirmed portal as unprotected', () => {
    const portal: PortalRecord = {
      id: 'p',
      label: 'Gate',
      position: { x: 0, y: 0, z: 0 },
      dimension: 'overworld',
      registeredAt: 0,
      confirmed: true,
    };
    expect(fromPortal(portal).protected).toBe(false);
  });
});

describe('findByPoint', () => {
  it('finds structures containing the point in the given dimension', () => {
    const a = structure({ id: 'a', region: box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 }, 'overworld') });
    const b = structure({ id: 'b', region: box({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 }, 'nether') });
    const found = findByPoint([a, b], { x: 2, y: 2, z: 2 }, 'overworld');
    expect(found.map((entry) => entry.id)).toEqual(['a']);
  });
});
