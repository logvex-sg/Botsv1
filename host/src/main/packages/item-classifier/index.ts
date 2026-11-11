/**
 * Item classifier: real Minecraft-aware classification of reported items.
 *
 * The storage engine's `categoryFor` matches item ids by substring, which is a good first pass but
 * cannot tell a *log* from a *plank* that merely shares a name fragment, and cannot see the
 * metadata the game already knows: item **tags** (`minecraft:logs`, `c:wood`), **enchantments**,
 * **data components** (custom name, container contents), the **mod namespace**, or **durability**.
 * This engine classifies on those real signals, so two items are never treated as interchangeable
 * just because their display names look alike.
 *
 * It is pure: it reads an item plus whatever metadata the worker reported and returns a category.
 * It never talks to a worker and never invents metadata it was not given — a rule that needs a tag
 * simply does not match an item with no reported tags, which is the honest result.
 */
import type { WorkerItem } from '../../../shared/workers';
import type { ClassifierRule } from '../../../shared/types';

/** The metadata a worker may report alongside an item. Every field is optional. */
export interface ItemMeta {
  /** Fully-qualified item tags, e.g. `minecraft:logs`, `c:ingots`. */
  tags?: readonly string[];
  /** Enchantments present, by id, with a level. */
  enchantments?: readonly { id: string; level: number }[];
  /** Data component ids present on the stack, e.g. `minecraft:container`. */
  components?: readonly string[];
  /** The stack's custom name, when it has one (already plain text). */
  customName?: string | null;
}

/**
 * One rule inside a category. A rule matches an item or it does not; there is no expression language.
 *
 * Re-exported from `shared/types` so the classifier and the persisted category share one definition.
 */
export type { ClassifierRule };

/** A category defined by rules over real item metadata. */
export interface ClassifierCategory {
  id: string;
  name: string;
  /** Higher priority wins when two categories match an item equally specifically. */
  priority: number;
  color: string;
  rules: ClassifierRule[];
  /** When true, the category is offered as an exclusive bucket (routing will not mix others in). */
  exclusive: boolean;
}

/** The namespace (`minecraft` in `minecraft:diamond_sword`), or `minecraft` when unqualified. */
export function namespaceOf(itemId: string): string {
  const colon = itemId.indexOf(':');
  return colon > 0 ? itemId.slice(0, colon).toLowerCase() : 'minecraft';
}

/** The path (`diamond_sword` in `minecraft:diamond_sword`). */
export function pathOf(itemId: string): string {
  const colon = itemId.indexOf(':');
  return (colon >= 0 ? itemId.slice(colon + 1) : itemId).toLowerCase();
}

/** Remaining durability as a percentage, or 100 when the item cannot take damage. */
export function durabilityPercent(item: Pick<WorkerItem, 'damage' | 'maxDamage' | 'damageable'>): number {
  if (!item.damageable || item.maxDamage <= 0) return 100;
  const remaining = Math.max(0, item.maxDamage - item.damage);
  return (remaining / item.maxDamage) * 100;
}

/** Normalises a tag for comparison: lower-cased, and both `minecraft:`-qualified and bare forms accepted. */
function tagEquals(reported: string, wanted: string): boolean {
  const a = reported.toLowerCase();
  const b = wanted.toLowerCase();
  if (a === b) return true;
  // Accept `logs` for `minecraft:logs` and vice versa so authors need not know the namespace.
  return a.replace(/^minecraft:/, '') === b.replace(/^minecraft:/, '');
}

/**
 * The metadata an item carries, gathering it off the stack itself.
 *
 * A reported `WorkerItem` already holds the tags, enchantments, components and custom name the worker
 * sent, so classification reads them from the item without the caller having to pass them separately.
 */
export function metaOfItem(item: WorkerItem): ItemMeta {
  return {
    tags: item.tags,
    enchantments: item.enchantments,
    components: item.components,
    customName: item.customName,
  };
}

/**
 * The metadata to classify against: the item's own fields, with an explicit `meta` overriding them.
 *
 * The item is the primary source, since a reported stack already carries what the worker sent. An
 * explicit `meta` overrides field by field, which lets a caller classify against hypothetical
 * metadata (a preview) without mutating the item.
 */
function effectiveMeta(item: WorkerItem, meta: ItemMeta | undefined): ItemMeta {
  if (!meta) return metaOfItem(item);
  return {
    tags: meta.tags ?? item.tags,
    enchantments: meta.enchantments ?? item.enchantments,
    components: meta.components ?? item.components,
    customName: meta.customName ?? item.customName,
  };
}

/**
 * Whether an item matches a rule.
 *
 * A rule that needs metadata the item did not report does not match: absence of a tag is not
 * evidence the tag is present.
 */
export function matchesRule(item: WorkerItem, meta: ItemMeta | undefined, rule: ClassifierRule): boolean {
  const source = effectiveMeta(item, meta);
  const id = (item.id ?? '').toLowerCase();
  const name = (item.name ?? '').toLowerCase();
  switch (rule.kind) {
    case 'id-equals':
      return id === rule.id.toLowerCase();
    case 'id-contains':
      return rule.contains.length > 0 && (id.includes(rule.contains.toLowerCase()) || name.includes(rule.contains.toLowerCase()));
    case 'tag':
      return (source.tags ?? []).some((tag) => tagEquals(tag, rule.tag));
    case 'namespace':
      return namespaceOf(id) === rule.namespace.toLowerCase();
    case 'enchantment': {
      const found = (source.enchantments ?? []).find((entry) => entry.id.toLowerCase() === rule.id.toLowerCase());
      if (!found) return false;
      return rule.minLevel === undefined || found.level >= rule.minLevel;
    }
    case 'component':
      return (source.components ?? []).some((component) => component.toLowerCase() === rule.id.toLowerCase());
    case 'custom-name': {
      const custom = (source.customName ?? '').toLowerCase();
      return custom.length > 0 && custom.includes(rule.contains.toLowerCase());
    }
    case 'durability': {
      if (!item.damageable) return false;
      const percent = durabilityPercent(item);
      if (rule.minPercent !== undefined && percent < rule.minPercent) return false;
      if (rule.maxPercent !== undefined && percent > rule.maxPercent) return false;
      return true;
    }
    case 'stackable':
      return rule.stackable === !item.damageable;
  }
}

/**
 * How specific a matched rule is: a higher score is a stronger claim on the item.
 *
 * An exact id beats a tag, a tag beats a namespace, and a longer substring beats a shorter one, so a
 * category added for a niche item is not shadowed by a broad one.
 */
export function ruleSpecificity(rule: ClassifierRule): number {
  switch (rule.kind) {
    case 'id-equals':
      return 1000;
    // An enchantment or a specific data component is a stronger claim on the item than a broad
    // family tag: a pickaxe in `minecraft:pickaxes` that is also enchanted belongs with the
    // enchanted gear, so the enchantment must outrank the tag.
    case 'enchantment':
      return 900 + (rule.minLevel ?? 0);
    case 'component':
      return 800;
    case 'tag':
      return 700;
    case 'custom-name':
      return 600 + rule.contains.length;
    case 'id-contains':
      return 300 + rule.contains.length;
    case 'durability':
      return 200;
    case 'stackable':
      return 100;
    default:
      return 0;
  }
}

/**
 * The category an item belongs to, or null when none matches.
 *
 * The most specific matching rule wins; ties are broken by category priority, then by id for
 * determinism. A category with no matching rule is never chosen.
 */
export function classify(
  item: WorkerItem,
  meta: ItemMeta | undefined,
  categories: readonly ClassifierCategory[],
): ClassifierCategory | null {
  let best: ClassifierCategory | null = null;
  let bestScore = -1;
  for (const category of categories) {
    for (const rule of category.rules) {
      if (!matchesRule(item, meta, rule)) continue;
      const score = ruleSpecificity(rule);
      if (
        score > bestScore ||
        (score === bestScore &&
          best !== null &&
          (category.priority > best.priority || (category.priority === best.priority && category.id < best.id)))
      ) {
        best = category;
        bestScore = score;
      }
    }
  }
  return best;
}

/** The categories a single item matches (for "why is this here?" explanations). */
export function explain(
  item: WorkerItem,
  meta: ItemMeta | undefined,
  categories: readonly ClassifierCategory[],
): { category: ClassifierCategory; rule: ClassifierRule; score: number }[] {
  const hits: { category: ClassifierCategory; rule: ClassifierRule; score: number }[] = [];
  for (const category of categories) {
    for (const rule of category.rules) {
      if (matchesRule(item, meta, rule)) {
        hits.push({ category, rule, score: ruleSpecificity(rule) });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.category.id.localeCompare(b.category.id));
}

/** Items that match no category, grouped by id with a total count. */
export function uncategorized(
  entries: readonly { item: WorkerItem; meta?: ItemMeta }[],
  categories: readonly ClassifierCategory[],
): { id: string; name: string; count: number }[] {
  const totals = new Map<string, { id: string; name: string; count: number }>();
  for (const { item, meta } of entries) {
    if (classify(item, meta, categories)) continue;
    const existing = totals.get(item.id);
    if (existing) existing.count += item.count;
    else totals.set(item.id, { id: item.id, name: item.name, count: item.count });
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** The mod namespaces present in a set of items, with a count each — the "mod sorting" view. */
export function namespacesPresent(
  entries: readonly { item: WorkerItem }[],
): { namespace: string; items: number; total: number }[] {
  const byNs = new Map<string, { namespace: string; items: number; total: number }>();
  for (const { item } of entries) {
    const ns = namespaceOf(item.id);
    const entry = byNs.get(ns) ?? { namespace: ns, items: 0, total: 0 };
    entry.items += 1;
    entry.total += Math.max(0, item.count);
    byNs.set(ns, entry);
  }
  return [...byNs.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));
}

/** Whether an item comes from a mod (any namespace other than `minecraft`). */
export function isModded(item: Pick<WorkerItem, 'id'>): boolean {
  return namespaceOf(item.id) !== 'minecraft';
}

/**
 * The built-in categories, covering the families the spec names.
 *
 * Where a family has a real Minecraft tag it is used (so the classification is data-driven and
 * correct for every item in the tag, including modded ones that opt in); substring rules are the
 * fallback for families with no single tag.
 */
export const BUILTIN_CATEGORIES: readonly ClassifierCategory[] = [
  {
    id: 'building',
    name: 'Building blocks',
    priority: 40,
    color: '#8b8b8b',
    exclusive: false,
    rules: [
      { kind: 'tag', tag: 'minecraft:base_stone_overworld' },
      { kind: 'tag', tag: 'minecraft:planks' },
      { kind: 'tag', tag: 'minecraft:stone_bricks' },
      { kind: 'tag', tag: 'minecraft:walls' },
      { kind: 'tag', tag: 'minecraft:stairs' },
      { kind: 'tag', tag: 'minecraft:slabs' },
      { kind: 'id-contains', contains: 'concrete' },
      { kind: 'id-contains', contains: 'terracotta' },
      { kind: 'id-contains', contains: 'glass' },
      { kind: 'id-contains', contains: 'wool' },
      { kind: 'id-contains', contains: 'sandstone' },
      { kind: 'id-contains', contains: 'cobble' },
      { kind: 'id-contains', contains: 'stone' },
      { kind: 'id-contains', contains: 'quartz_block' },
    ],
  },
  {
    id: 'logs',
    name: 'Logs & wood',
    priority: 45,
    color: '#7a5a3a',
    exclusive: false,
    rules: [
      { kind: 'tag', tag: 'minecraft:logs' },
      { kind: 'tag', tag: 'minecraft:logs_that_burn' },
    ],
  },
  {
    id: 'ores',
    name: 'Ores & raw materials',
    priority: 50,
    color: '#d4a24a',
    exclusive: false,
    rules: [
      { kind: 'tag', tag: 'minecraft:ores' },
      { kind: 'id-contains', contains: '_ore' },
      { kind: 'id-contains', contains: 'raw_' },
    ],
  },
  {
    id: 'ingots',
    name: 'Ingots & gems',
    priority: 55,
    color: '#e0c060',
    exclusive: false,
    rules: [
      { kind: 'tag', tag: 'c:ingots' },
      { kind: 'tag', tag: 'c:gems' },
      { kind: 'id-contains', contains: 'ingot' },
      { kind: 'id-contains', contains: 'diamond' },
      { kind: 'id-contains', contains: 'emerald' },
      { kind: 'id-contains', contains: 'netherite' },
      { kind: 'id-contains', contains: 'lapis' },
    ],
  },
  {
    id: 'redstone',
    name: 'Redstone',
    priority: 60,
    color: '#e0463a',
    exclusive: false,
    rules: [
      { kind: 'id-contains', contains: 'redstone' },
      { kind: 'id-contains', contains: 'repeater' },
      { kind: 'id-contains', contains: 'comparator' },
      { kind: 'id-contains', contains: 'piston' },
      { kind: 'id-contains', contains: 'observer' },
      { kind: 'id-contains', contains: 'hopper' },
      { kind: 'id-contains', contains: 'dispenser' },
      { kind: 'id-contains', contains: 'dropper' },
      { kind: 'id-contains', contains: 'lever' },
      { kind: 'id-contains', contains: 'pressure_plate' },
      { kind: 'id-contains', contains: '_button' },
    ],
  },
  {
    id: 'tools',
    name: 'Tools & weapons',
    priority: 70,
    color: '#5fa8d3',
    exclusive: false,
    rules: [
      { kind: 'tag', tag: 'minecraft:swords' },
      { kind: 'tag', tag: 'minecraft:pickaxes' },
      { kind: 'tag', tag: 'minecraft:axes' },
      { kind: 'tag', tag: 'minecraft:shovels' },
      { kind: 'tag', tag: 'minecraft:hoes' },
      { kind: 'id-contains', contains: '_sword' },
      { kind: 'id-contains', contains: '_pickaxe' },
      { kind: 'id-contains', contains: '_axe' },
      { kind: 'id-contains', contains: '_shovel' },
      { kind: 'id-contains', contains: '_hoe' },
      { kind: 'id-contains', contains: 'shield' },
      { kind: 'id-contains', contains: 'trident' },
      { kind: 'id-contains', contains: 'bow' },
      { kind: 'id-contains', contains: 'arrow' },
    ],
  },
  {
    id: 'armor',
    name: 'Armour',
    priority: 75,
    color: '#4f8fbf',
    exclusive: false,
    rules: [
      { kind: 'tag', tag: 'minecraft:head_armor' },
      { kind: 'tag', tag: 'minecraft:chest_armor' },
      { kind: 'tag', tag: 'minecraft:leg_armor' },
      { kind: 'tag', tag: 'minecraft:foot_armor' },
      { kind: 'id-contains', contains: '_helmet' },
      { kind: 'id-contains', contains: '_chestplate' },
      { kind: 'id-contains', contains: '_leggings' },
      { kind: 'id-contains', contains: '_boots' },
      { kind: 'id-contains', contains: 'elytra' },
    ],
  },
  {
    id: 'food',
    name: 'Food',
    priority: 65,
    color: '#7ac74f',
    exclusive: false,
    rules: [
      { kind: 'tag', tag: 'minecraft:food' },
      { kind: 'component', id: 'minecraft:food' },
      { kind: 'id-contains', contains: 'bread' },
      { kind: 'id-contains', contains: 'apple' },
      { kind: 'id-contains', contains: 'cooked_' },
      { kind: 'id-contains', contains: 'carrot' },
      { kind: 'id-contains', contains: 'potato' },
    ],
  },
  {
    id: 'potions',
    name: 'Potions & brewing',
    priority: 80,
    color: '#b05fd3',
    exclusive: false,
    rules: [
      { kind: 'id-contains', contains: 'potion' },
      { kind: 'id-contains', contains: 'blaze_powder' },
      { kind: 'id-contains', contains: 'brewing_stand' },
      { kind: 'id-contains', contains: 'nether_wart' },
      { kind: 'id-contains', contains: 'glistering_melon' },
    ],
  },
  {
    id: 'enchanted',
    name: 'Enchanted gear',
    priority: 90,
    color: '#c060ff',
    exclusive: false,
    rules: [
      { kind: 'enchantment', id: 'minecraft:unbreaking', minLevel: 1 },
      { kind: 'enchantment', id: 'minecraft:mending' },
      { kind: 'component', id: 'minecraft:enchantments' },
    ],
  },
  {
    id: 'shulkers',
    name: 'Shulker boxes',
    priority: 95,
    color: '#a060c0',
    exclusive: true,
    rules: [
      { kind: 'component', id: 'minecraft:container' },
      { kind: 'id-contains', contains: 'shulker_box' },
    ],
  },
  {
    id: 'books',
    name: 'Books',
    priority: 85,
    color: '#8a6a3a',
    exclusive: false,
    rules: [
      { kind: 'component', id: 'minecraft:stored_enchantments' },
      { kind: 'id-contains', contains: 'enchanted_book' },
      { kind: 'id-contains', contains: 'writable_book' },
      { kind: 'id-contains', contains: 'written_book' },
      { kind: 'id-contains', contains: 'book' },
    ],
  },
  {
    id: 'valuables',
    name: 'Valuables',
    priority: 100,
    color: '#f0c419',
    exclusive: true,
    rules: [
      { kind: 'id-contains', contains: 'nether_star' },
      { kind: 'id-contains', contains: 'beacon' },
      { kind: 'id-contains', contains: 'end_crystal' },
      { kind: 'id-contains', contains: 'totem_of_undying' },
      { kind: 'id-contains', contains: 'enchanted_golden_apple' },
      { kind: 'id-contains', contains: 'netherite' },
      { kind: 'id-contains', contains: 'elytra' },
      { kind: 'id-contains', contains: 'dragon_egg' },
    ],
  },
];

/**
 * A classifier with a mutable category set.
 *
 * The set starts from the built-ins and can be extended, edited, imported and exported without
 * touching the engine's logic, so a user's custom categories are data, not code.
 */
export class ItemClassifier {
  private categories: ClassifierCategory[];

  constructor(categories: readonly ClassifierCategory[] = BUILTIN_CATEGORIES) {
    this.categories = categories.map(cloneCategory);
  }

  /** The current categories, in definition order. */
  list(): readonly ClassifierCategory[] {
    return this.categories;
  }

  /** Looks a category up by id. */
  get(id: string): ClassifierCategory | undefined {
    return this.categories.find((category) => category.id === id);
  }

  /** Adds a category, or replaces one with the same id. */
  put(category: ClassifierCategory): void {
    const index = this.categories.findIndex((existing) => existing.id === category.id);
    const copy = cloneCategory(category);
    if (index >= 0) this.categories[index] = copy;
    else this.categories.push(copy);
  }

  /** Renames a category, keeping its rules. Returns false when the id is unknown. */
  rename(id: string, name: string): boolean {
    const category = this.get(id);
    if (!category) return false;
    category.name = name;
    return true;
  }

  /** Removes a category. Returns false when the id is unknown. */
  remove(id: string): boolean {
    const before = this.categories.length;
    this.categories = this.categories.filter((category) => category.id !== id);
    return this.categories.length !== before;
  }

  /** Classifies one item. */
  classify(item: WorkerItem, meta?: ItemMeta): ClassifierCategory | null {
    return classify(item, meta, this.categories);
  }

  /** Exports the category set as a portable JSON string. */
  exportProfile(): string {
    return JSON.stringify({ version: 1, categories: this.categories }, null, 2);
  }

  /**
   * Imports a category set, replacing the current one.
   *
   * A malformed profile throws rather than silently emptying the classifier, and unknown rule kinds
   * are dropped so a newer profile does not break an older build.
   */
  importProfile(json: string): void {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('the category profile is not an object');
    }
    const categories = (parsed as { categories?: unknown }).categories;
    if (!Array.isArray(categories)) {
      throw new Error('the category profile has no categories array');
    }
    this.categories = categories
      .map((entry) => normaliseCategory(entry))
      .filter((entry): entry is ClassifierCategory => entry !== null);
  }
}

const RULE_KINDS: ReadonlySet<string> = new Set([
  'id-equals',
  'id-contains',
  'tag',
  'namespace',
  'enchantment',
  'component',
  'custom-name',
  'durability',
  'stackable',
]);

function cloneCategory(category: ClassifierCategory): ClassifierCategory {
  return {
    id: category.id,
    name: category.name,
    priority: category.priority,
    color: category.color,
    exclusive: category.exclusive,
    rules: category.rules.map((rule) => ({ ...rule })),
  };
}

/** Reads an untrusted category object, dropping unknown rule kinds. Returns null when unusable. */
function normaliseCategory(value: unknown): ClassifierCategory | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) return null;
  const rules = Array.isArray(record.rules)
    ? record.rules.filter(
        (rule): rule is ClassifierRule =>
          typeof rule === 'object' &&
          rule !== null &&
          typeof (rule as { kind?: unknown }).kind === 'string' &&
          RULE_KINDS.has((rule as { kind: string }).kind),
      )
    : [];
  return {
    id,
    name: typeof record.name === 'string' ? record.name : id,
    priority: typeof record.priority === 'number' ? record.priority : 0,
    color: typeof record.color === 'string' ? record.color : '#888888',
    exclusive: record.exclusive === true,
    rules: rules.map((rule) => ({ ...rule })),
  };
}
