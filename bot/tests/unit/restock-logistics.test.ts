import { describe, expect, it } from 'vitest';
import {
  computeDelta,
  evaluateRules,
  findSources,
  planRestock,
  type RestockRule,
} from '../../src/core/engine/restock-engine';
import {
  containerRole,
  danglingRoutes,
  networkSummary,
  planRoute,
  reservationConflict,
  type LogisticsRoute,
  type RouteContext,
} from '../../src/core/engine/logistics-engine';
import type { ContainerRecord, ItemStack } from '../../src/core/types';

const container = (over: Partial<ContainerRecord> & { id: string }): ContainerRecord => ({
  networkId: 'net',
  label: over.id,
  position: { x: 0, y: 0, z: 0 },
  dimension: 'overworld',
  categories: [],
  protected: false,
  registeredAt: 0,
  ...over,
});

const iron = (count: number): ItemStack => ({ id: 'minecraft:iron_ingot', count });
const torch = (count: number): ItemStack => ({ id: 'minecraft:torch', count });

describe('computeDelta', () => {
  const rule: RestockRule = { id: 'r1', query: 'torch', minimum: 32, maximum: 64 };

  it('reports the shortfall against the minimum', () => {
    const need = computeDelta(rule, [torch(10)]);
    expect(need.have).toBe(10);
    expect(need.shortfall).toBe(22);
  });

  it('reports zero shortfall when the minimum is met', () => {
    expect(computeDelta(rule, [torch(40)]).shortfall).toBe(0);
  });
});

describe('evaluateRules', () => {
  it('returns only rules with a shortfall', () => {
    const rules: RestockRule[] = [
      { id: 'torch', query: 'torch', minimum: 32, maximum: 64 },
      { id: 'iron', query: 'iron', minimum: 16, maximum: 64 },
    ];
    const needs = evaluateRules(rules, [torch(40), iron(2)]);
    expect(needs.map((need) => need.ruleId)).toEqual(['iron']);
    expect(needs[0]!.shortfall).toBe(14);
  });
});

describe('findSources', () => {
  const a = container({ id: 'a', label: 'Near', position: { x: 1, y: 0, z: 0 } });
  const b = container({ id: 'b', label: 'Far', position: { x: 50, y: 0, z: 0 } });
  const c = container({ id: 'c', label: 'Other', position: { x: 2, y: 0, z: 0 } });
  const contents = new Map<string, readonly ItemStack[]>([
    ['a', [torch(10)]],
    ['b', [torch(5)]],
    ['c', [iron(9)]],
  ]);
  const need = computeDelta({ id: 'torch', query: 'torch', minimum: 64, maximum: 64 }, []);
  const distanceTo = (item: ContainerRecord) => item.position.x;

  it('returns only containers that hold the item, nearest first', () => {
    const sources = findSources(need, [a, b, c], contents, distanceTo);
    expect(sources.map((source) => source.containerId)).toEqual(['a', 'b']);
    expect(sources[0]!.available).toBe(10);
  });

  it('honours a rule.sources restriction', () => {
    const rule: RestockRule = { id: 'torch', query: 'torch', minimum: 64, maximum: 64, sources: ['b'] };
    const sources = findSources(need, [a, b, c], contents, distanceTo, rule);
    expect(sources.map((source) => source.containerId)).toEqual(['b']);
  });

  it('ignores a container whose contents were never read', () => {
    const sources = findSources(need, [a, b, c], new Map([['a', [torch(1)]]]), distanceTo);
    expect(sources.map((source) => source.containerId)).toEqual(['a']);
  });
});

describe('planRestock', () => {
  const containerById = (id: string) => ({ a: container({ id: 'a' }), b: container({ id: 'b' }) }[id]);

  it('never asks for more than a source holds and reports unfulfilled', () => {
    const need = computeDelta({ id: 'torch', query: 'torch', minimum: 100, maximum: 100 }, []);
    const plan = planRestock(need, [
      { containerId: 'a', label: 'A', available: 30, distance: 1 },
      { containerId: 'b', label: 'B', available: 20, distance: 2 },
    ], containerById);
    expect(plan.steps.map((step) => step.amount)).toEqual([30, 20]);
    expect(plan.planned).toBe(50);
    expect(plan.unfulfilled).toBe(50);
    expect(plan.reason).toContain('could not be sourced');
  });

  it('stops at the maximum ceiling', () => {
    const need = computeDelta({ id: 'torch', query: 'torch', minimum: 64, maximum: 40 }, [torch(20)]);
    // have 20, minimum 64 -> shortfall 44; ceiling = 40 - 20 = 20.
    const plan = planRestock(need, [{ containerId: 'a', label: 'A', available: 100, distance: 1 }], containerById);
    expect(plan.planned).toBe(20);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.amount).toBe(20);
    expect(plan.unfulfilled).toBe(0);
  });

  it('reports no source when none holds the item', () => {
    const need = computeDelta({ id: 'torch', query: 'torch', minimum: 64, maximum: 64 }, []);
    const plan = planRestock(need, [], containerById);
    expect(plan.steps).toEqual([]);
    expect(plan.planned).toBe(0);
    expect(plan.reason).toBe('no known source holds this item');
  });

  it('attaches the source container position to a step', () => {
    const need = computeDelta({ id: 'torch', query: 'torch', minimum: 10, maximum: 10 }, []);
    const positioned = container({ id: 'a', position: { x: 5, y: 6, z: 7 } });
    const plan = planRestock(need, [{ containerId: 'a', label: 'A', available: 10, distance: 1 }], () => positioned);
    expect(plan.steps[0]!.position).toEqual({ x: 5, y: 6, z: 7 });
  });
});

describe('planRoute', () => {
  const source = container({ id: 'src', label: 'Source', position: { x: 0, y: 0, z: 0 } });
  const dest = container({ id: 'dst', label: 'Dest', position: { x: 10, y: 0, z: 0 } });

  const context = (over: Partial<RouteContext> = {}): RouteContext => ({
    containerById: (id) => (id === 'src' ? source : id === 'dst' ? dest : undefined),
    contentsOf: () => [iron(64)],
    freeSlotsOf: () => 27,
    reserved: new Set<string>(),
    allowProtected: false,
    ...over,
  });

  const route = (over: Partial<LogisticsRoute> = {}): LogisticsRoute => ({
    id: 'route-1',
    fromContainerId: 'src',
    toContainerId: 'dst',
    query: 'iron',
    batchSize: 64,
    enabled: true,
    ...over,
  });

  it('refuses a missing endpoint', () => {
    const plan = planRoute(route({ fromContainerId: 'ghost' }), context());
    expect(plan.movable).toBe(0);
    expect(plan.refusals.some((refusal) => refusal.reason.includes('source container ghost is not registered'))).toBe(true);
  });

  it('refuses a disabled route', () => {
    const plan = planRoute(route({ enabled: false }), context());
    expect(plan.refusals.some((refusal) => refusal.reason === 'route is disabled')).toBe(true);
  });

  it('refuses a reserved endpoint', () => {
    const plan = planRoute(route(), context({ reserved: new Set(['dst']) }));
    expect(plan.refusals.some((refusal) => refusal.reason === 'destination is reserved by another operation')).toBe(true);
  });

  it('refuses a protected endpoint unless allowed', () => {
    const guarded = container({ id: 'src', protected: true });
    const plan = planRoute(route(), context({ containerById: () => guarded }));
    expect(plan.refusals.some((refusal) => refusal.reason === 'source is protected')).toBe(true);

    const allowed = planRoute(route(), context({ containerById: () => guarded, allowProtected: true }));
    expect(allowed.refusals).toEqual([]);
    expect(allowed.movable).toBe(64);
  });

  it('refuses when the source contents were not read', () => {
    const plan = planRoute(route(), context({ contentsOf: () => undefined }));
    expect(plan.refusals[0]!.reason).toBe('source contents have not been read');
  });

  it('refuses when the source holds none of the item', () => {
    const plan = planRoute(route(), context({ contentsOf: () => [torch(9)] }));
    expect(plan.reason).toBe('source holds no "iron"');
  });

  it('refuses when the destination has no free space', () => {
    const plan = planRoute(route(), context({ freeSlotsOf: () => 0 }));
    expect(plan.reason).toBe('destination has no free space');
  });

  it('succeeds with withdraw then deposit steps and the right amount', () => {
    const plan = planRoute(route(), context());
    expect(plan.steps.map((step) => step.direction)).toEqual(['withdraw', 'deposit']);
    expect(plan.steps.map((step) => step.amount)).toEqual([64, 64]);
    expect(plan.movable).toBe(64);
    expect(plan.refusals).toEqual([]);
    expect(plan.steps[0]!.containerId).toBe('src');
    expect(plan.steps[1]!.containerId).toBe('dst');
  });

  it('clamps the amount by batchSize', () => {
    const plan = planRoute(route({ batchSize: 10 }), context());
    expect(plan.movable).toBe(10);
  });

  it('clamps the amount by destination capacity', () => {
    const plan = planRoute(route(), context({ freeSlotsOf: () => 1 }));
    expect(plan.movable).toBe(64);
    const plan2 = planRoute(route({ batchSize: 128 }), context({ freeSlotsOf: () => 1 }));
    expect(plan2.movable).toBe(64);
  });
});

describe('reservationConflict', () => {
  it('returns the first conflicting id, or null', () => {
    expect(reservationConflict(new Set(['a']), ['x', 'a', 'y'])).toBe('a');
    expect(reservationConflict(new Set(['z']), ['x', 'y'])).toBeNull();
  });
});

describe('danglingRoutes', () => {
  it('finds routes whose endpoints are unknown', () => {
    const routes: LogisticsRoute[] = [
      { id: 'ok', fromContainerId: 'a', toContainerId: 'b', query: 'iron', batchSize: 1, enabled: true },
      { id: 'bad', fromContainerId: 'a', toContainerId: 'gone', query: 'iron', batchSize: 1, enabled: true },
    ];
    const dangling = danglingRoutes(routes, new Set(['a', 'b']));
    expect(dangling.map((route) => route.id)).toEqual(['bad']);
  });
});

describe('containerRole', () => {
  const routes: LogisticsRoute[] = [
    { id: 'r1', fromContainerId: 'a', toContainerId: 'b', query: 'iron', batchSize: 1, enabled: true },
    { id: 'r2', fromContainerId: 'b', toContainerId: 'c', query: 'iron', batchSize: 1, enabled: true },
  ];

  it('classifies source, destination, both and isolated', () => {
    expect(containerRole('a', routes)).toBe('source');
    expect(containerRole('b', routes)).toBe('both');
    expect(containerRole('c', routes)).toBe('destination');
    expect(containerRole('d', routes)).toBe('isolated');
  });
});

describe('networkSummary', () => {
  it('counts containers, routes, enabled routes, dangling routes and roles', () => {
    const routes: LogisticsRoute[] = [
      { id: 'r1', fromContainerId: 'a', toContainerId: 'b', query: 'iron', batchSize: 1, enabled: true },
      { id: 'r2', fromContainerId: 'b', toContainerId: 'ghost', query: 'iron', batchSize: 1, enabled: false },
    ];
    const summary = networkSummary(routes, ['a', 'b', 'c']);
    expect(summary.containerCount).toBe(3);
    expect(summary.routeCount).toBe(2);
    expect(summary.enabledRoutes).toBe(1);
    expect(summary.dangling).toBe(1);
    expect(summary.roles).toEqual({ source: 1, destination: 0, both: 1, isolated: 1 });
  });
});
