import { describe, expect, it } from 'vitest';
import {
  classify,
  durabilityPercent,
  identityKey,
  isModded,
  matchesAll,
  matchesRule,
  namespaceOf,
  pathOf,
  ruleSpecificity,
  stackable,
} from '../../src/core/engine/item-classifier';
import { BUILTIN_CATEGORIES } from '../../src/core/engine/categories';
import type { ItemCategory, ItemStack } from '../../src/core/types';

const categories: ItemCategory[] = [
  { id: 'tools', name: 'Tools', priority: 50, rules: [{ kind: 'id-contains', value: 'pickaxe' }] },
  { id: 'enchanted', name: 'Enchanted', priority: 10, rules: [{ kind: 'enchantment', value: 'minecraft:mending' }] },
  { id: 'modded', name: 'Modded', priority: 10, rules: [{ kind: 'namespace', value: 'create' }] },
];

describe('item classifier', () => {
  it('splits namespaces', () => {
    expect(namespaceOf('minecraft:diamond')).toBe('minecraft');
    expect(namespaceOf('create:copper_ingot')).toBe('create');
    expect(namespaceOf('diamond')).toBe('minecraft');
    expect(pathOf('create:copper_ingot')).toBe('copper_ingot');
  });

  it('recognises modded items by namespace', () => {
    expect(isModded('create:copper_ingot')).toBe(true);
    expect(isModded('minecraft:diamond')).toBe(false);
  });

  it('matches an id-contains rule', () => {
    const item: ItemStack = { id: 'minecraft:diamond_pickaxe', count: 1 };
    expect(matchesRule(item, { kind: 'id-contains', value: 'pickaxe' })).toBe(true);
    expect(matchesRule(item, { kind: 'id-contains', value: 'sword' })).toBe(false);
  });

  it('treats unreported enchantments as unknown, never as absent', () => {
    const noMeta: ItemStack = { id: 'minecraft:netherite_sword', count: 1 };
    // The stack has no `meta` at all: the rule must not match, because "unknown" is not "has none".
    expect(matchesRule(noMeta, { kind: 'enchantment', value: 'minecraft:mending' })).toBe(false);

    const known: ItemStack = { id: 'minecraft:netherite_sword', count: 1, meta: { enchantments: [{ id: 'minecraft:mending', level: 1 }] } };
    expect(matchesRule(known, { kind: 'enchantment', value: 'minecraft:mending' })).toBe(true);
    expect(matchesRule(known, { kind: 'enchantment', value: 'minecraft:mending', level: 2 })).toBe(false);
  });

  it('distinguishes an empty tag list from an unreported one', () => {
    const reported: ItemStack = { id: 'minecraft:oak_log', count: 1, meta: { tags: [] } };
    const unreported: ItemStack = { id: 'minecraft:oak_log', count: 1 };
    expect(matchesRule(reported, { kind: 'tag', value: 'minecraft:logs' })).toBe(false);
    expect(matchesRule(unreported, { kind: 'tag', value: 'minecraft:logs' })).toBe(false);
    const tagged: ItemStack = { id: 'minecraft:oak_log', count: 1, meta: { tags: ['minecraft:logs'] } };
    expect(matchesRule(tagged, { kind: 'tag', value: 'minecraft:logs' })).toBe(true);
  });

  it('matches durability rules only when durability is known', () => {
    const unknown: ItemStack = { id: 'minecraft:diamond_pickaxe', count: 1 };
    expect(matchesRule(unknown, { kind: 'durability-below', value: 20 })).toBe(false);
    const damaged: ItemStack = { id: 'minecraft:diamond_pickaxe', count: 1, durability: 10 };
    expect(matchesRule(damaged, { kind: 'durability-below', value: 20 })).toBe(true);
  });

  it('computes durability from damage when a percentage is absent', () => {
    expect(durabilityPercent({ id: 'x', count: 1, damage: 500, maxDamage: 1000 })).toBe(50);
    expect(durabilityPercent({ id: 'x', count: 1 })).toBeNull();
  });

  it('picks the most specific, highest-priority category', () => {
    const item: ItemStack = { id: 'create:copper_pickaxe', count: 1, meta: { enchantments: [{ id: 'minecraft:mending', level: 1 }] } };
    const result = classify(item, categories);
    // `tools` (priority 50) beats both `enchanted` and `modded` (priority 10).
    expect(result.categoryId).toBe('tools');
    expect(result.matches).toContain('enchanted');
    expect(result.matches).toContain('modded');
  });

  it('never classifies into a category with no rules', () => {
    const empty: ItemCategory = { id: 'everything', name: 'Everything', priority: 999, rules: [] };
    const item: ItemStack = { id: 'minecraft:dirt', count: 1 };
    expect(classify(item, [empty]).categoryId).toBeNull();
  });

  it('groups stacks by identity, not by id', () => {
    const plain: ItemStack = { id: 'minecraft:iron_sword', count: 1 };
    const sharp: ItemStack = { id: 'minecraft:iron_sword', count: 1, meta: { enchantments: [{ id: 'minecraft:sharpness', level: 5 }] } };
    expect(identityKey(plain)).not.toBe(identityKey(sharp));
    expect(stackable(plain, sharp)).toBe(false);
    expect(stackable(plain, { ...plain, count: 2 })).toBe(true);
  });

  it('orders rule specificity sensibly', () => {
    expect(ruleSpecificity({ kind: 'enchantment', value: 'x' })).toBeGreaterThan(ruleSpecificity({ kind: 'id-contains', value: 'x' }));
    expect(ruleSpecificity({ kind: 'tag', value: 'x' })).toBeGreaterThan(ruleSpecificity({ kind: 'namespace', value: 'x' }));
  });

  it('classifies real vanilla items into the built-in categories', () => {
    const pickaxe: ItemStack = { id: 'minecraft:diamond_pickaxe', count: 1 };
    expect(classify(pickaxe, BUILTIN_CATEGORIES).categoryId).toBe('tools');

    const log: ItemStack = { id: 'minecraft:oak_log', count: 1, meta: { tags: ['minecraft:logs'] } };
    expect(classify(log, BUILTIN_CATEGORIES).categoryId).toBe('building');

    const shulker: ItemStack = { id: 'minecraft:shulker_box', count: 1 };
    expect(classify(shulker, BUILTIN_CATEGORIES).categoryId).toBe('shulkers');

    const gapple: ItemStack = { id: 'minecraft:enchanted_golden_apple', count: 1 };
    // `valuables` has the highest priority and matches `enchanted_golden_apple`.
    expect(classify(gapple, BUILTIN_CATEGORIES).categoryId).toBe('valuables');
  });

  it('reports every category an item matches', () => {
    const item: ItemStack = { id: 'minecraft:shulker_box', count: 1 };
    expect(matchesAll(item, BUILTIN_CATEGORIES)).toContain('shulkers');
  });
});
