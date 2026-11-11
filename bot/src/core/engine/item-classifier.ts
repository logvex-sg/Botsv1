/**
 * Item classification.
 *
 * The rule that governs everything here: two items are never interchangeable. A stack is placed by
 * matching its real metadata — tags, enchantments, data components, namespace, durability, id —
 * never by assuming "any iron is the same iron". When metadata was not reported, that field is
 * *unknown* and matches nothing; it is never treated as empty.
 */

import type { ClassifierRule, ItemCategory, ItemMeta, ItemStack } from '../types';

export function namespaceOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? 'minecraft' : id.slice(0, colon);
}

export function pathOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

export function isModded(id: string): boolean {
  const namespace = namespaceOf(id);
  return namespace !== 'minecraft' && namespace !== 'minecraft';
}

export function metaOf(item: ItemStack): ItemMeta {
  return item.meta ?? {};
}

/** Durability as a percentage of max, or null when the item is not damageable / unknown. */
export function durabilityPercent(item: ItemStack): number | null {
  if (typeof item.durability === 'number') return item.durability;
  if (typeof item.damage === 'number' && typeof item.maxDamage === 'number' && item.maxDamage > 0) {
    const remaining = item.maxDamage - item.damage;
    return Math.max(0, Math.min(100, (remaining / item.maxDamage) * 100));
  }
  return null;
}

/**
 * Whether a rule matches an item.
 *
 * Absent metadata never matches a metadata rule. An enchantment rule matches only when the
 * enchantment is present at or above the required level.
 */
export function matchesRule(item: ItemStack, rule: ClassifierRule): boolean {
  const meta = metaOf(item);
  switch (rule.kind) {
    case 'tag': {
      const tags = meta.tags;
      if (!tags) return false;
      return tags.some((tag) => tag.toLowerCase() === String(rule.value).toLowerCase());
    }
    case 'enchantment': {
      const enchantments = meta.enchantments;
      if (!enchantments) return false;
      const wanted = String(rule.value).toLowerCase();
      const level = typeof rule.level === 'number' ? rule.level : 1;
      return enchantments.some((entry) => entry.id.toLowerCase() === wanted && entry.level >= level);
    }
    case 'component': {
      const components = meta.components;
      if (!components) return false;
      const wanted = String(rule.value).toLowerCase();
      return components.some((component) => component.toLowerCase() === wanted);
    }
    case 'namespace':
      return namespaceOf(item.id).toLowerCase() === String(rule.value).toLowerCase();
    case 'id':
      return item.id.toLowerCase() === String(rule.value).toLowerCase();
    case 'id-contains':
      return item.id.toLowerCase().includes(String(rule.value).toLowerCase());
    case 'name-contains': {
      const name = (meta.customName ?? item.name ?? '').toLowerCase();
      return name.includes(String(rule.value).toLowerCase());
    }
    case 'durability-below': {
      const percent = durabilityPercent(item);
      if (percent === null) return false;
      return percent < Number(rule.value);
    }
    case 'count-at-least':
      return item.count >= Number(rule.value);
    default:
      return false;
  }
}

/**
 * How specific a rule is. Used to pick the best category when an item matches several, so a
 * `minecraft:logs` tag rule beats a broad `id-contains: log`.
 */
export function ruleSpecificity(rule: ClassifierRule): number {
  switch (rule.kind) {
    case 'enchantment':
      return 100 + (typeof rule.level === 'number' ? rule.level : 1);
    case 'component':
      return 90;
    case 'tag':
      return 80;
    case 'durability-below':
      return 70;
    case 'count-at-least':
      return 60;
    case 'namespace':
      return 40;
    case 'id':
      return 35;
    case 'name-contains':
      return 30;
    case 'id-contains':
      return 20;
    default:
      return 0;
  }
}

export interface ClassificationResult {
  /** Category id chosen for the item. `null` when nothing matched. */
  categoryId: string | null;
  /** Every category the item matched, most specific first. */
  matches: string[];
  reason: string;
}

/**
 * Classifies an item against a set of categories.
 *
 * A category with no rules is skipped: a rule-less category would otherwise swallow everything.
 * Ties are broken by category priority, then by the specificity of the winning rule.
 */
export function classify(item: ItemStack, categories: readonly ItemCategory[]): ClassificationResult {
  interface Candidate {
    id: string;
    priority: number;
    specificity: number;
    rule: ClassifierRule;
  }

  const candidates: Candidate[] = [];
  for (const category of categories) {
    if (category.rules.length === 0) continue;
    for (const rule of category.rules) {
      if (matchesRule(item, rule)) {
        candidates.push({ id: category.id, priority: category.priority, specificity: ruleSpecificity(rule), rule });
      }
    }
  }

  if (candidates.length === 0) {
    return { categoryId: null, matches: [], reason: `no category rule matched ${item.id}` };
  }

  candidates.sort((a, b) => b.priority - a.priority || b.specificity - a.specificity);
  const best = candidates[0]!;
  const matches: string[] = [];
  for (const candidate of candidates) if (!matches.includes(candidate.id)) matches.push(candidate.id);

  return {
    categoryId: best.id,
    matches,
    reason: `matched ${best.rule.kind}:${best.rule.value} for category ${best.id}`,
  };
}

/** Categories an item matches, in specificity order. */
export function matchesAll(item: ItemStack, categories: readonly ItemCategory[]): string[] {
  return classify(item, categories).matches;
}

/** The id used to group identical stacks. Two stacks group only when id *and* metadata agree. */
export function identityKey(item: ItemStack): string {
  const meta = metaOf(item);
  const enchantments = (meta.enchantments ?? [])
    .map((entry) => `${entry.id.toLowerCase()}@${entry.level}`)
    .sort()
    .join(',');
  const tags = [...(meta.tags ?? [])].map((tag) => tag.toLowerCase()).sort().join(',');
  const components = [...(meta.components ?? [])].map((component) => component.toLowerCase()).sort().join(',');
  const name = (meta.customName ?? '').toLowerCase();
  return `${item.id.toLowerCase()}|${enchantments}|${tags}|${components}|${name}`;
}

/** Whether two stacks may be merged: same identity, and the merge does not exceed a stack. */
export function stackable(a: ItemStack, b: ItemStack, maxStack = 64): boolean {
  return identityKey(a) === identityKey(b) && a.count + b.count <= maxStack;
}

export function describeItem(item: ItemStack): string {
  const parts = [item.id, `x${item.count}`];
  const meta = metaOf(item);
  if (meta.enchantments && meta.enchantments.length > 0) {
    parts.push(`[${meta.enchantments.map((entry) => `${entry.id}:${entry.level}`).join(',')}]`);
  }
  if (meta.customName) parts.push(`"${meta.customName}"`);
  return parts.join(' ');
}
