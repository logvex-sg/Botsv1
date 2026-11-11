/**
 * Shulker, portal, restock, disposal, workflow and assistant engine tests.
 *
 * These cover the safety rules the brief is explicit about: a filled or unknown shulker is never
 * removed, a portal removal is refused outside an authorised area, a disposal never touches a
 * valuable or reserved item, and the assistant never invents an operation for a request it does not
 * understand.
 */
import { describe, expect, it } from 'vitest';
import {
  assessRemoval,
  assessUnpack,
  classify,
  dominantCategory,
  emptyShulkers,
  fillOf,
  isMixed,
  mixedShulkers,
  surplusEmptyShulkers,
} from '../../src/main/packages/shulker-engine';
import {
  CONNECTED_RADIUS,
  duplicates,
  groupConnected,
  isAuthorised,
  isObsolete,
  parseArea,
  previewRemoval,
  withinArea,
} from '../../src/main/packages/portal-engine';
import { computeDelta, evaluateRules, findSources, planRestock } from '../../src/main/packages/restock-engine';
import { decide, isValuable, planDisposal, preview as disposalPreview } from '../../src/main/packages/disposal-engine';
import { BUILTIN_WORKFLOWS, OPERATIONS, expand, validate } from '../../src/main/packages/workflow-engine';
import { answer, classify as classifyIntent, extractQuery } from '../../src/main/packages/maintenance-assistant';
import { assess, craftableTimes, fuelCapacity } from '../../src/main/packages/crafting-engine';
import type {
  DisposalRule, PortalRecord, RestockRule, ShulkerRecord, StorageCategory, StorageContainer, StorageNetwork, WorkflowRecord,
} from '../../src/shared/types';
import type { WorkerItem } from '../../src/shared/workers';

function item(id: string, name: string, count: number): WorkerItem {
  return { id, name, count, slot: 0, damage: 0, maxDamage: 0, damageable: false };
}

function category(id: string, name: string, matches: string[]): StorageCategory {
  return { id, name, itemMatches: matches, priority: 0, color: '#000', protected: false, createdAt: 0, updatedAt: 0 };
}

function container(id: string, overrides: Partial<StorageContainer> = {}): StorageContainer {
  return {
    id, networkId: 'n1', workerId: 'w1', label: id, kind: 'general', x: 0, y: 0, z: 0, dimension: 'overworld',
    categoryId: null, locked: false, permanent: false, capacity: 27, freeSlots: 10, full: false, items: [],
    inspectedAt: Date.now(), createdAt: 0, updatedAt: 0, ...overrides,
  };
}

function shulker(id: string, overrides: Partial<ShulkerRecord> = {}): ShulkerRecord {
  return {
    id, workerId: 'w1', slot: 0, label: '', categoryId: null, mixed: false, empty: true, items: [],
    itemCount: 0, freeSlots: 27, reserved: false, markedForRemoval: false, inspectedAt: Date.now(), createdAt: 0, updatedAt: 0, ...overrides,
  };
}

const CATEGORIES = [category('build', 'Building', ['stone', 'cobble']), category('ore', 'Ores', ['iron_ingot'])];

describe('shulker engine', () => {
  it('classifies fill from the reported item count', () => {
    expect(fillOf(shulker('s'))).toBe('empty');
    expect(fillOf(shulker('s', { itemCount: 64, freeSlots: 26, items: [item('minecraft:stone', 'Stone', 64)] }))).toBe('partial');
    expect(fillOf(shulker('s', { itemCount: 64, freeSlots: 0, items: [item('minecraft:stone', 'Stone', 64)] }))).toBe('full');
  });

  it('finds the dominant category and detects a mix', () => {
    const mixed = shulker('s', { items: [item('minecraft:iron_ingot', 'Iron Ingot', 64), item('minecraft:stone', 'Stone', 5)] });
    expect(dominantCategory(mixed, CATEGORIES)?.id).toBe('ore');
    expect(isMixed(mixed, CATEGORIES)).toBe(true);
  });

  it('recomputes derived fields from the contents', () => {
    const classified = classify(shulker('s', { items: [item('minecraft:iron_ingot', 'Iron Ingot', 10)] }), CATEGORIES);
    expect(classified.empty).toBe(false);
    expect(classified.itemCount).toBe(10);
    expect(classified.categoryId).toBe('ore');
  });

  it('refuses to unpack a shulker whose contents were never read', () => {
    const s = shulker('s', { inspectedAt: 0, itemCount: 10, items: [item('minecraft:stone', 'Stone', 10)] });
    expect(assessUnpack(s, CATEGORIES, [container('c')]).unpackable).toBe(false);
  });

  it('refuses to unpack when there is no destination', () => {
    const s = shulker('s', { items: [item('minecraft:stone', 'Stone', 10)], itemCount: 10 });
    expect(assessUnpack(s, CATEGORIES, [container('c', { freeSlots: 0 })]).unpackable).toBe(false);
  });

  it('never removes a shulker that still holds items or has unknown contents', () => {
    const filled = shulker('s', { itemCount: 10, items: [item('minecraft:stone', 'Stone', 10)] });
    expect(assessRemoval(filled, { allowDestruction: true }).removable).toBe(false);
    const unknown = shulker('s', { inspectedAt: 0 });
    expect(assessRemoval(unknown, { allowDestruction: true }).removable).toBe(false);
  });

  it('refuses removal of a reserved shulker and when destruction is disabled', () => {
    const empty = shulker('s');
    expect(assessRemoval(empty, { allowDestruction: true, reserved: true }).removable).toBe(false);
    expect(assessRemoval(empty, { allowDestruction: false }).removable).toBe(false);
    expect(assessRemoval(empty, { allowDestruction: true }).removable).toBe(true);
  });

  it('computes surplus empty shulkers beyond the reserve', () => {
    const empties = [shulker('a', { createdAt: 1 }), shulker('b', { createdAt: 2 }), shulker('c', { createdAt: 3 })];
    expect(emptyShulkers(empties)).toHaveLength(3);
    expect(surplusEmptyShulkers(empties, 2).map((s) => s.id)).toEqual(['c']);
  });

  it('lists mixed shulkers', () => {
    expect(mixedShulkers([shulker('a', { mixed: true }), shulker('b')]).map((s) => s.id)).toEqual(['a']);
  });
});

describe('portal engine', () => {
  function portal(id: string, overrides: Partial<PortalRecord> = {}): PortalRecord {
    return {
      id, name: id, category: 'nether', dimension: 'overworld', x: 0, y: 0, z: 0, permanent: false, temporary: true,
      needsMaintenance: false, tracking: true, lastSeenBy: null, lastSeenAt: Date.now(), obsolete: false, notes: '', createdAt: 0, updatedAt: 0, ...overrides,
    };
  }

  it('groups connected portals in the same dimension', () => {
    const a = portal('a', { x: 0, y: 0, z: 0 });
    const b = portal('b', { x: 1, y: 0, z: 1 });
    const far = portal('c', { x: 100, y: 0, z: 100 });
    const groups = groupConnected([a, b, far]);
    expect(groups.some((g) => g.portals.length === 2)).toBe(true);
    expect(groups).toHaveLength(2);
  });

  it('treats portals past the connected radius as separate', () => {
    const a = portal('a', { x: 0 });
    const b = portal('b', { x: CONNECTED_RADIUS + 1 });
    expect(duplicates([a, b])).toHaveLength(0);
  });

  it('marks a temporary unseen portal obsolete and never a permanent one', () => {
    const old = Date.now() - 8 * 24 * 3600_000;
    expect(isObsolete(portal('a', { lastSeenAt: old }))).toBe(true);
    expect(isObsolete(portal('b', { lastSeenAt: old, permanent: true }))).toBe(false);
  });

  it('parses an area and rejects a malformed one', () => {
    expect(parseArea('overworld 0 0 0 10 10 10')).toEqual({ dimension: 'overworld', x1: 0, y1: 0, z1: 0, x2: 10, y2: 10, z2: 10 });
    expect(parseArea('overworld 0 0 0')).toBeNull();
    expect(parseArea('overworld a b c d e f')).toBeNull();
  });

  it('checks containment order-independently', () => {
    const area = parseArea('overworld 10 10 10 0 0 0')!;
    expect(withinArea(area, 'overworld', 5, 5, 5)).toBe(true);
    expect(withinArea(area, 'overworld', 20, 5, 5)).toBe(false);
    expect(withinArea(area, 'nether', 5, 5, 5)).toBe(false);
  });

  it('refuses removal outside every authorised area', () => {
    const p = portal('a', { x: 50, y: 50, z: 50 });
    expect(isAuthorised(p, [])).toBe(false);
    const area = parseArea('overworld 0 0 0 10 10 10')!;
    expect(isAuthorised(p, [area])).toBe(false);
    const wide = parseArea('overworld 0 0 0 100 100 100')!;
    expect(isAuthorised(p, [wide])).toBe(true);
  });

  it('never previews a permanent portal as removable', () => {
    const p = portal('a', { permanent: true, x: 5, y: 5, z: 5 });
    const area = parseArea('overworld 0 0 0 10 10 10')!;
    const preview = previewRemoval([p], [area]);
    expect(preview[0].authorised).toBe(false);
    expect(preview[0].reasons).toContain('portal is marked permanent');
  });
});

describe('restock engine', () => {
  const rule = (overrides: Partial<RestockRule> = {}): RestockRule => ({
    id: 'r1', networkId: null, name: 'Food', query: 'beef', label: 'Beef', min: 16, max: 64, batch: 16,
    workerIds: [], enabled: true, priority: 0, createdAt: 0, updatedAt: 0, ...overrides,
  });

  it('computes the delta to reach the band', () => {
    expect(computeDelta(4, 16, 64, 16)).toEqual({ direction: 'in', amount: 12 });
    expect(computeDelta(100, 16, 64, 16)).toEqual({ direction: 'out', amount: 36 });
    expect(computeDelta(30, 16, 64, 16)).toEqual({ direction: 'ok', amount: 0 });
  });

  it('evaluates an enabled rule against a carried inventory', () => {
    const needs = evaluateRules([rule()], null, 'w1', [item('minecraft:cooked_beef', 'Cooked Beef', 4)]);
    expect(needs).toHaveLength(1);
    expect(needs[0].direction).toBe('in');
    expect(needs[0].delta).toBe(12);
  });

  it('skips a disabled rule and a rule scoped to another worker', () => {
    expect(evaluateRules([rule({ enabled: false })], null, 'w1', [])).toHaveLength(0);
    expect(evaluateRules([rule({ workerIds: ['w2'] })], null, 'w1', [])).toHaveLength(0);
  });

  it('finds sources only on the same worker', () => {
    const source = container('c', { workerId: 'w1', items: [item('minecraft:cooked_beef', 'Cooked Beef', 64)] });
    const other = container('o', { workerId: 'w2', items: [item('minecraft:cooked_beef', 'Cooked Beef', 64)] });
    expect(findSources('beef', 'w1', [source, other], null).map((s) => s.containerId)).toEqual(['c']);
  });

  it('reports an unsatisfied rule when no source holds the item', () => {
    const plan = planRestock([{ ruleId: 'r1', workerId: 'w1', query: 'beef', label: 'Beef', have: 0, min: 16, max: 64, delta: 16, amount: 16, direction: 'in' }], () => []);
    expect(plan.steps).toHaveLength(0);
    expect(plan.unsatisfied).toHaveLength(1);
    expect(plan.unsatisfied[0].missing).toBe(16);
  });
});

describe('disposal engine', () => {
  const rule = (overrides: Partial<DisposalRule> = {}): DisposalRule => ({
    id: 'd1', name: 'Gravel', query: 'gravel', label: 'Gravel', targetContainerId: null, enabled: true, createdAt: 0, updatedAt: 0, ...overrides,
  });

  it('recognises valuable items', () => {
    expect(isValuable(item('minecraft:diamond', 'Diamond', 1))).toBe(true);
    expect(isValuable(item('minecraft:gravel', 'Gravel', 1))).toBe(false);
  });

  it('refuses an item with no matching rule', () => {
    const decision = decide(item('minecraft:stick', 'Stick', 1), [rule()], null);
    expect(decision.allowed).toBe(false);
  });

  it('refuses a valuable item even when a rule matches', () => {
    const decision = decide(item('minecraft:diamond', 'Diamond', 1), [rule({ query: 'diamond' })], null);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('item is valuable');
  });

  it('refuses a reserved item', () => {
    const network: StorageNetwork = {
      id: 'n1', name: 'n', description: '', mode: 'supervised', paused: false, workerIds: [], protectedItems: [],
      reservations: [{ query: 'gravel', count: 10 }], exclusionAreas: [], createdAt: 0, updatedAt: 0,
    };
    const decision = decide(item('minecraft:gravel', 'Gravel', 1), [rule()], network);
    expect(decision.allowed).toBe(false);
  });

  it('allows a matched, non-valuable item', () => {
    expect(decide(item('minecraft:gravel', 'Gravel', 1), [rule()], null).allowed).toBe(true);
  });

  it('refuses disposal when there is no disposal container', () => {
    const plan = planDisposal([item('minecraft:gravel', 'Gravel', 5)], [rule()], null, [], 'w1');
    expect(plan.steps).toHaveLength(0);
    expect(plan.refused).toHaveLength(1);
  });

  it('plans a move to an unlocked disposal container', () => {
    const destination = container('d', { kind: 'disposal' });
    const plan = planDisposal([item('minecraft:gravel', 'Gravel', 5)], [rule()], null, [destination], 'w1');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].toContainerId).toBe('d');
  });

  it('previews without acting', () => {
    const result = disposalPreview([item('minecraft:gravel', 'Gravel', 5)], [rule()], null);
    expect(result.wouldDispose).toHaveLength(1);
  });
});

describe('workflow engine', () => {
  it('exposes the built-in workflows and validates a definition', () => {
    expect(BUILTIN_WORKFLOWS.length).toBeGreaterThan(0);
    expect(validate({ name: '', operations: [] })).not.toHaveLength(0);
    expect(validate({ name: 'ok', operations: ['nope'] })).not.toHaveLength(0);
    expect(validate({ name: 'ok', operations: ['inspect'] })).toHaveLength(0);
  });

  it('expands a workflow into known operations', () => {
    const workflow: WorkflowRecord = { id: 'w', name: 'w', description: '', operations: ['inspect', 'consolidate', 'bogus'], networkId: null, mode: 'supervised', enabled: true, createdAt: 0, updatedAt: 0 };
    expect(expand(workflow).map((o) => o.id)).toEqual(['inspect', 'consolidate']);
  });

  it('has a descriptor for every operation', () => {
    for (const operation of OPERATIONS) expect(operation.label.length).toBeGreaterThan(0);
  });
});

describe('maintenance assistant', () => {
  it('maps the brief\'s example requests to operations', () => {
    expect(classifyIntent('find all full containers').operation).toBe('maintain');
    expect(classifyIntent('find empty shulkers').operation).toBe('shulker-cleanup');
    expect(classifyIntent('organize all my shulkers').operation).toBe('shulker-organise');
    expect(classifyIntent('consolidate my storage').operation).toBe('consolidate');
    expect(classifyIntent('restock my workers').operation).toBe('restock');
    expect(classifyIntent('check my registered portals').operation).toBe('portal-cleanup');
    expect(classifyIntent('what items cannot be sorted').operation).toBe('maintain');
  });

  it('answers honestly when a request matches nothing', () => {
    const result = answer('make me a sandwich');
    expect(result.operation).toBeNull();
    expect(result.text).toContain('did not recognise');
  });

  it('extracts a query from a request', () => {
    expect(extractQuery('move all building materials into assigned storage')).toContain('building');
  });
});

describe('crafting engine', () => {
  const recipe = { id: 'r', name: 'Torch', ingredients: [{ query: 'coal', label: 'Coal', count: 1 }, { query: 'stick', label: 'Stick', count: 1 }], outputCount: 4, outputLabel: 'Torch' };

  it('computes how many times a recipe can be crafted', () => {
    expect(craftableTimes(recipe, [item('minecraft:coal', 'Coal', 4), item('minecraft:stick', 'Stick', 2)])).toBe(2);
  });

  it('reports missing ingredients', () => {
    const report = assess(recipe, [item('minecraft:coal', 'Coal', 4)]);
    expect(report.craftable).toBe(false);
    expect(report.reasons.join(' ')).toContain('Stick');
  });

  it('estimates fuel capacity', () => {
    expect(fuelCapacity([item('minecraft:coal', 'Coal', 10)]).smelts).toBe(80);
  });
});
