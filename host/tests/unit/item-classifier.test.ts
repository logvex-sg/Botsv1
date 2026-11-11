/**
 * Item-classifier tests: classification by tag, enchantment, component, namespace and durability,
 * the specificity ordering, and the honesty rule that missing metadata never matches.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CATEGORIES,
  ItemClassifier,
  classify,
  durabilityPercent,
  explain,
  isModded,
  matchesRule,
  namespaceOf,
  namespacesPresent,
  pathOf,
  ruleSpecificity,
  uncategorized,
  type ClassifierCategory,
} from '../../src/main/packages/item-classifier';
import type { WorkerItem } from '../../src/shared/workers';

function item(id: string, name = id, extra: Partial<WorkerItem> = {}): WorkerItem {
  return { id, name, count: 1, slot: 0, damage: 0, maxDamage: 0, damageable: false, ...extra };
}

describe('namespace and path', () => {
  it('splits a namespaced id', () => {
    expect(namespaceOf('minecraft:diamond_sword')).toBe('minecraft');
    expect(pathOf('minecraft:diamond_sword')).toBe('diamond_sword');
  });

  it('treats an unqualified id as minecraft', () => {
    expect(namespaceOf('diamond')).toBe('minecraft');
    expect(pathOf('diamond')).toBe('diamond');
  });

  it('recognises modded items', () => {
    expect(isModded({ id: 'create:cogwheel' })).toBe(true);
    expect(isModded({ id: 'minecraft:stone' })).toBe(false);
  });
});

describe('durability', () => {
  it('is 100 for a non-damageable item', () => {
    expect(durabilityPercent({ damage: 10, maxDamage: 0, damageable: false })).toBe(100);
  });

  it('computes the remaining percentage', () => {
    expect(durabilityPercent({ damage: 750, maxDamage: 1000, damageable: true })).toBe(25);
    expect(durabilityPercent({ damage: 0, maxDamage: 1000, damageable: true })).toBe(100);
    expect(durabilityPercent({ damage: 1000, maxDamage: 1000, damageable: true })).toBe(0);
  });
});

describe('matchesRule', () => {
  it('matches an exact id', () => {
    expect(matchesRule(item('minecraft:diamond'), undefined, { kind: 'id-equals', id: 'minecraft:diamond' })).toBe(true);
    expect(matchesRule(item('minecraft:diamond'), undefined, { kind: 'id-equals', id: 'minecraft:coal' })).toBe(false);
  });

  it('matches a substring in id or display name', () => {
    expect(matchesRule(item('minecraft:cobblestone'), undefined, { kind: 'id-contains', contains: 'cobble' })).toBe(true);
    expect(matchesRule(item('minecraft:stone', 'Mossy Cobble'), undefined, { kind: 'id-contains', contains: 'cobble' })).toBe(true);
  });

  it('matches a tag, accepting the bare and qualified forms', () => {
    const log = item('minecraft:oak_log');
    expect(matchesRule(log, { tags: ['minecraft:logs'] }, { kind: 'tag', tag: 'minecraft:logs' })).toBe(true);
    expect(matchesRule(log, { tags: ['logs'] }, { kind: 'tag', tag: 'minecraft:logs' })).toBe(true);
    expect(matchesRule(log, { tags: ['minecraft:planks'] }, { kind: 'tag', tag: 'minecraft:logs' })).toBe(false);
  });

  it('does not match a tag the item never reported', () => {
    expect(matchesRule(item('minecraft:oak_log'), undefined, { kind: 'tag', tag: 'minecraft:logs' })).toBe(false);
  });

  it('matches an enchantment at or above a level', () => {
    const meta = { enchantments: [{ id: 'minecraft:unbreaking', level: 3 }] };
    expect(matchesRule(item('minecraft:diamond_pickaxe'), meta, { kind: 'enchantment', id: 'minecraft:unbreaking', minLevel: 2 })).toBe(true);
    expect(matchesRule(item('minecraft:diamond_pickaxe'), meta, { kind: 'enchantment', id: 'minecraft:unbreaking', minLevel: 4 })).toBe(false);
    expect(matchesRule(item('minecraft:diamond_pickaxe'), meta, { kind: 'enchantment', id: 'minecraft:mending' })).toBe(false);
  });

  it('matches a component', () => {
    const meta = { components: ['minecraft:container', 'minecraft:custom_name'] };
    expect(matchesRule(item('minecraft:shulker_box'), meta, { kind: 'component', id: 'minecraft:container' })).toBe(true);
    expect(matchesRule(item('minecraft:shulker_box'), meta, { kind: 'component', id: 'minecraft:food' })).toBe(false);
  });

  it('matches a custom name substring', () => {
    expect(matchesRule(item('minecraft:stone'), { customName: 'Base Stone' }, { kind: 'custom-name', contains: 'base' })).toBe(true);
    expect(matchesRule(item('minecraft:stone'), { customName: null }, { kind: 'custom-name', contains: 'base' })).toBe(false);
  });

  it('matches a durability band only for damageable items', () => {
    const worn = item('minecraft:diamond_pickaxe', 'pick', { damageable: true, damage: 900, maxDamage: 1000 });
    expect(matchesRule(worn, undefined, { kind: 'durability', maxPercent: 15 })).toBe(true);
    expect(matchesRule(worn, undefined, { kind: 'durability', minPercent: 50 })).toBe(false);
    expect(matchesRule(item('minecraft:stone'), undefined, { kind: 'durability', maxPercent: 15 })).toBe(false);
  });

  it('matches stackability', () => {
    expect(matchesRule(item('minecraft:stone'), undefined, { kind: 'stackable', stackable: true })).toBe(true);
    expect(matchesRule(item('minecraft:stone', 'stone', { damageable: true }), undefined, { kind: 'stackable', stackable: true })).toBe(false);
  });
});

describe('rule specificity ordering', () => {
  it('ranks an exact id above a tag above a substring', () => {
    expect(ruleSpecificity({ kind: 'id-equals', id: 'x' })).toBeGreaterThan(ruleSpecificity({ kind: 'tag', tag: 'x' }));
    expect(ruleSpecificity({ kind: 'tag', tag: 'x' })).toBeGreaterThan(ruleSpecificity({ kind: 'id-contains', contains: 'x' }));
  });
});

describe('classify', () => {
  it('classifies a log by its tag, not its name', () => {
    const result = classify(item('minecraft:oak_log'), { tags: ['minecraft:logs'] }, BUILTIN_CATEGORIES);
    expect(result?.id).toBe('logs');
  });

  it('classifies an ore by its tag', () => {
    const result = classify(item('minecraft:deepslate_diamond_ore'), { tags: ['minecraft:ores'] }, BUILTIN_CATEGORIES);
    expect(result?.id).toBe('ores');
  });

  it('classifies an enchanted pickaxe as enchanted gear, beating tools', () => {
    const meta = { enchantments: [{ id: 'minecraft:unbreaking', level: 3 }], tags: ['minecraft:pickaxes'] };
    const result = classify(item('minecraft:diamond_pickaxe'), meta, BUILTIN_CATEGORIES);
    expect(result?.id).toBe('enchanted');
  });

  it('classifies a shulker box by its container component', () => {
    const meta = { components: ['minecraft:container'] };
    const result = classify(item('minecraft:shulker_box'), meta, BUILTIN_CATEGORIES);
    expect(result?.id).toBe('shulkers');
  });

  it('classifies a plain pickaxe as a tool', () => {
    const result = classify(item('minecraft:iron_pickaxe'), { tags: ['minecraft:pickaxes'] }, BUILTIN_CATEGORIES);
    expect(result?.id).toBe('tools');
  });

  it('returns null for an item no category claims', () => {
    expect(classify(item('minecraft:strange_thing'), undefined, BUILTIN_CATEGORIES)).toBeNull();
  });

  it('is deterministic when two categories tie', () => {
    const categories: ClassifierCategory[] = [
      { id: 'b', name: 'B', priority: 5, color: '#000', exclusive: false, rules: [{ kind: 'id-contains', contains: 'stone' }] },
      { id: 'a', name: 'A', priority: 5, color: '#000', exclusive: false, rules: [{ kind: 'id-contains', contains: 'stone' }] },
    ];
    expect(classify(item('minecraft:stone'), undefined, categories)?.id).toBe('a');
  });
});

describe('explain', () => {
  it('lists every matching rule, most specific first', () => {
    const meta = { tags: ['minecraft:pickaxes'], enchantments: [{ id: 'minecraft:mending', level: 1 }] };
    const hits = explain(item('minecraft:diamond_pickaxe'), meta, BUILTIN_CATEGORIES);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[hits.length - 1]!.score);
    expect(hits.some((hit) => hit.category.id === 'enchanted')).toBe(true);
    expect(hits.some((hit) => hit.category.id === 'tools')).toBe(true);
  });
});

describe('uncategorized', () => {
  it('groups the items no category claims', () => {
    const entries = [
      { item: item('minecraft:strange_thing', 'Strange', { count: 5 }) },
      { item: item('minecraft:strange_thing', 'Strange', { count: 3 }) },
      { item: item('minecraft:stone', 'Stone') },
    ];
    const result = uncategorized(entries, BUILTIN_CATEGORIES);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'minecraft:strange_thing', count: 8 });
  });
});

describe('namespacesPresent', () => {
  it('counts items per mod namespace', () => {
    const result = namespacesPresent([
      { item: item('minecraft:stone') },
      { item: item('create:cogwheel') },
      { item: item('create:shaft') },
    ]);
    expect(result).toEqual([
      { namespace: 'create', items: 2, total: 2 },
      { namespace: 'minecraft', items: 1, total: 1 },
    ]);
  });
});

describe('ItemClassifier', () => {
  it('classifies with the built-ins by default', () => {
    const classifier = new ItemClassifier();
    expect(classifier.classify(item('minecraft:oak_log'), { tags: ['minecraft:logs'] })?.id).toBe('logs');
  });

  it('adds, renames and removes categories', () => {
    const classifier = new ItemClassifier([]);
    classifier.put({ id: 'custom', name: 'Custom', priority: 1, color: '#123456', exclusive: false, rules: [{ kind: 'id-equals', id: 'minecraft:stone' }] });
    expect(classifier.classify(item('minecraft:stone'))?.id).toBe('custom');
    expect(classifier.rename('custom', 'Renamed')).toBe(true);
    expect(classifier.get('custom')?.name).toBe('Renamed');
    expect(classifier.remove('custom')).toBe(true);
    expect(classifier.remove('custom')).toBe(false);
    expect(classifier.classify(item('minecraft:stone'))).toBeNull();
  });

  it('round-trips a profile through export and import', () => {
    const source = new ItemClassifier();
    source.put({ id: 'mine', name: 'Mine', priority: 7, color: '#abcdef', exclusive: true, rules: [{ kind: 'tag', tag: 'c:magic_gems' }] });
    const json = source.exportProfile();

    const target = new ItemClassifier([]);
    target.importProfile(json);
    expect(target.get('mine')).toMatchObject({ name: 'Mine', priority: 7, exclusive: true });
    expect(target.classify(item('create:magic_gem'), { tags: ['c:magic_gems'] })?.id).toBe('mine');
  });

  it('rejects a malformed profile rather than emptying itself', () => {
    const classifier = new ItemClassifier();
    expect(() => classifier.importProfile('not json')).toThrow();
    expect(() => classifier.importProfile('{"nope": true}')).toThrow();
    // The category set is untouched after a failed import.
    expect(classifier.get('logs')).toBeDefined();
  });

  it('drops unknown rule kinds when importing', () => {
    const classifier = new ItemClassifier([]);
    classifier.importProfile(
      JSON.stringify({ categories: [{ id: 'x', name: 'X', rules: [{ kind: 'id-equals', id: 'minecraft:stone' }, { kind: 'from-the-future' }] }] }),
    );
    expect(classifier.get('x')?.rules).toHaveLength(1);
  });
});
