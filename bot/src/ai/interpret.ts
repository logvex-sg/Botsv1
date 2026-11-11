/**
 * The deterministic interpreter.
 *
 * This is not a placeholder for a model. It is the offline path: a keyword interpreter that turns
 * an instruction into the same `Plan` shape a model would produce. It runs with no network, always
 * terminates, and never invents an operation outside the vocabulary.
 *
 * The model, when one is configured, is asked to produce this same shape; the deterministic
 * interpreter is what validates and, on failure, replaces it.
 */

import { OPERATIONS, operationById, type IntentOperation } from './operations';

export interface PlanArguments {
  query?: string;
  containerId?: string;
  networkId?: string;
  structureId?: string;
  slot?: number;
  count?: number;
  minimum?: number;
  radius?: number;
  x?: number;
  y?: number;
  z?: number;
  category?: string;
  task?: string;
}

export interface PlanStep {
  operation: IntentOperation;
  arguments: PlanArguments;
  description: string;
}

export interface Plan {
  /** The instruction as the operator wrote it. */
  instruction: string;
  steps: PlanStep[];
  /** How the plan was produced. */
  source: 'deterministic' | 'model';
  confidence: number;
  /** Why the interpreter chose this, for the audit log. */
  reasoning: string;
  /** True when at least one step mutates the world. */
  mutating: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, sixty: 64, hundred: 100,
};

/** Items the interpreter understands well enough to extract as a query. */
const KNOWN_ITEMS = [
  'diamond', 'diamonds', 'netherite', 'emerald', 'emeralds', 'iron', 'gold', 'coal', 'redstone',
  'lapis', 'copper', 'cobblestone', 'stone', 'dirt', 'sand', 'gravel', 'oak', 'spruce', 'birch',
  'logs', 'planks', 'torch', 'torches', 'food', 'bread', 'apple', 'cooked', 'beef', 'porkchop',
  'arrow', 'arrows', 'pearl', 'pearls', 'totem', 'totems', 'potion', 'potions', 'glass', 'wool',
  'concrete', 'terracotta', 'bricks', 'obsidian', 'shulker', 'shulkers', 'ender_pearl', 'gunpowder',
  'blaze', 'string', 'leather', 'paper', 'books', 'book', 'wheat', 'seeds', 'carrot', 'potato',
];

const CATEGORY_WORDS: Record<string, string> = {
  'building material': 'building',
  'building materials': 'building',
  building: 'building',
  ores: 'ores',
  ore: 'ores',
  tools: 'tools',
  weapons: 'tools',
  armour: 'armour',
  armor: 'armour',
  food: 'food',
  redstone: 'redstone',
  valuables: 'valuables',
  consumables: 'consumables',
  shulkers: 'shulkers',
};

function extractNumber(text: string): number | undefined {
  const digits = text.match(/\b(\d{1,5})\b/);
  if (digits) return Number(digits[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return undefined;
}

function extractQuery(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const item of KNOWN_ITEMS) {
    if (new RegExp(`\\b${item}\\b`).test(lower)) return item.replace(/s$/, '');
  }
  const afterOf = lower.match(/\b(?:of|for|all|the)\s+([a-z_]{3,})\b/);
  if (afterOf && !['storage', 'chests', 'chest', 'items', 'things', 'worker', 'structure'].includes(afterOf[1]!)) {
    return afterOf[1];
  }
  return undefined;
}

function extractCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [phrase, category] of Object.entries(CATEGORY_WORDS)) {
    if (lower.includes(phrase)) return category;
  }
  return undefined;
}

function extractCoordinates(text: string): { x?: number; y?: number; z?: number } {
  const match = text.match(/(-?\d{1,7})[ ,]+(-?\d{1,7})[ ,]+(-?\d{1,7})/);
  if (!match) return {};
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

/** A quoted or "the <name>" reference to a registered container or structure. */
function extractNamed(text: string): string | undefined {
  const quoted = text.match(/"([^"]{2,40})"/);
  if (quoted) return quoted[1]!.trim().toLowerCase().replace(/\s+/g, '-');
  const named = text.toLowerCase().match(/\b(?:the|to|into|in)\s+([a-z][a-z0-9 _-]{2,30}?)(?:\s+(?:chest|storage|vault|room|area|box|container|shulker)|\s*$)/);
  if (named) {
    const value = named[1]!.trim();
    if (!['storage', 'shulkers', 'shulker boxes', 'chests', 'chest', 'items', 'inventory'].includes(value)) {
      return value.replace(/\s+/g, '-');
    }
  }
  return undefined;
}

interface Rule {
  operation: IntentOperation;
  test: RegExp;
  build: (text: string) => PlanArguments;
}

/**
 * Rules are ordered; the first match wins.
 *
 * Ordering matters: "fill shulkers with building materials" must match `shulker.fill` before the
 * generic storage rules, so the more specific patterns come first.
 */
const RULES: Rule[] = [
  {
    operation: 'shulker.fill',
    test: /\b(fill|pack|load)\b.*\b(shulker|shulkers)\b|\b(shulker|shulkers)\b.*\b(fill|pack)\b/,
    build: (text) => ({
      query: extractQuery(text),
      category: extractCategory(text),
      count: extractNumber(text) ?? 1,
    }),
  },
  {
    operation: 'shulker.unpack',
    test: /\b(unpack|empty|dump)\b.*\b(shulker|shulkers|boxes|box)\b/,
    build: () => ({}),
  },
  {
    operation: 'shulker.organise',
    test: /\b(organise|organize|tidy|sort)\b.*\b(shulker|shulkers)\b/,
    build: () => ({}),
  },
  {
    operation: 'shulker.inspect',
    test: /\b(inspect|read|check|what(?:'s| is) in)\b.*\b(shulker|shulkers|boxes)\b/,
    build: () => ({}),
  },
  {
    operation: 'container.fullest',
    test: /\b(full)\b.*\b(chest|chests|container|containers)\b|\b(chest|chests|container|containers)\b.*\b(full)\b/,
    build: () => ({}),
  },
  {
    operation: 'container.emptiest',
    test: /\b(empty|emptiest|most free|free space)\b.*\b(chest|chests|container|containers)\b/,
    build: () => ({}),
  },
  {
    operation: 'storage.search',
    test: /\b(find|search|locate|where)\b/,
    build: (text) => ({ query: extractQuery(text) ?? text.replace(/.*\b(find|search|locate|where(?:'s| is)?|are)\b/i, '').trim() }),
  },
  {
    operation: 'storage.move',
    test: /\b(move|put|transfer|dump)\b.*\b(into|to|in)\b/,
    build: (text) => ({
      query: extractQuery(text),
      containerId: extractNamed(text),
      networkId: extractNamed(text),
    }),
  },
  {
    operation: 'storage.consolidate',
    test: /\b(consolidate|merge|combine|compact)\b/,
    build: () => ({}),
  },
  {
    operation: 'storage.sort',
    test: /\b(sort|tidy|organise|organize|clean up|cleanup)\b.*\b(storage|chest|chests|room|inventory)\b|\b(sort|tidy)\b/,
    build: () => ({}),
  },
  {
    operation: 'restock.run',
    test: /\brestock\b|\btop up\b|\brefill\b/,
    build: (text) => ({ query: extractQuery(text), minimum: extractNumber(text) }),
  },
  {
    operation: 'restock.report',
    test: /\b(need|needs|below)\b.*\brestock/,
    build: () => ({}),
  },
  {
    operation: 'maintenance.run',
    test: /\b(run|do|perform|start)\b.*\bmaintenance\b|\bmaintain\b/,
    build: (text) => ({ structureId: extractNamed(text) }),
  },
  {
    operation: 'structure.audit',
    test: /\b(structure|structures)\b.*\b(check|audit|need|attention|status)\b|\baudit\b.*\bstructure/,
    build: () => ({}),
  },
  {
    operation: 'structure.preview',
    test: /\bpreview\b|\bwhat would\b.*\btouch\b/,
    build: (text) => ({ structureId: extractNamed(text), ...extractCoordinates(text) }),
  },
  {
    operation: 'structure.list',
    test: /\b(list|show|what)\b.*\bstructures\b/,
    build: () => ({}),
  },
  {
    operation: 'portal.scan',
    test: /\b(scan|find|search|inspect)\b.*\bportals?\b|\bportals?\b.*\b(scan|inspect)\b/,
    build: (text) => ({ radius: extractNumber(text) }),
  },
  {
    operation: 'portal.list',
    test: /\b(list|show)\b.*\bportals?\b/,
    build: () => ({}),
  },
  {
    operation: 'worker.assign',
    test: /\bassign\b.*\bworker\b|\bworker\b.*\bassign\b/,
    build: (text) => {
      if (/maintenance/.test(text)) return { task: 'maintenance.run' };
      if (/sort/.test(text)) return { task: 'storage.sort' };
      if (/restock/.test(text)) return { task: 'restock.run' };
      return { task: text.replace(/.*\bassign\b/i, '').replace(/\bworker\b/i, '').trim() || 'storage.sort' };
    },
  },
  {
    operation: 'navigation.goTo',
    test: /\b(go to|goto|walk to|return to|travel to|head to)\b/,
    build: (text) => ({ containerId: extractNamed(text), ...extractCoordinates(text) }),
  },
  {
    operation: 'storage.count',
    test: /\b(how many|count|total)\b/,
    build: (text) => ({ query: extractQuery(text) }),
  },
  {
    operation: 'crafting.plan',
    test: /\b(craft|craftable|can i make)\b/,
    build: (text) => ({ query: extractQuery(text) }),
  },
  {
    operation: 'disposal.plan',
    test: /\b(junk|throw out|dispose|disposal|trash|get rid of)\b/,
    build: () => ({}),
  },
  {
    operation: 'storage.report',
    test: /\b(how full|storage report|check the storage|storage status|capacity)\b/,
    build: () => ({}),
  },
  {
    operation: 'inventory.search',
    test: /\b(do i have|carrying|in my inventory|find my)\b/,
    build: (text) => ({ query: extractQuery(text) }),
  },
  {
    operation: 'inventory.report',
    test: /\b(inventory|what am i carrying|show my items)\b/,
    build: () => ({}),
  },
  {
    operation: 'status.report',
    test: /\b(status|how are you|what are you doing|report)\b/,
    build: () => ({}),
  },
];

/**
 * Interprets an instruction.
 *
 * A recognised instruction yields one step. An unrecognised one yields no steps and a low
 * confidence — the caller refuses rather than guessing, which is the honest behaviour.
 */
export function interpret(instruction: string): Plan {
  const text = instruction.trim();
  const lower = text.toLowerCase();

  if (text.length === 0) {
    return { instruction: text, steps: [], source: 'deterministic', confidence: 0, reasoning: 'empty instruction', mutating: false };
  }

  for (const rule of RULES) {
    if (!rule.test.test(lower)) continue;
    const descriptor = operationById(rule.operation);
    if (!descriptor) continue;
    const args = rule.build(text);
    // Drop undefined arguments so the plan is clean.
    const cleanArgs: PlanArguments = {};
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined && value !== null && value !== '') (cleanArgs as Record<string, unknown>)[key] = value;
    }
    return {
      instruction: text,
      steps: [{ operation: rule.operation, arguments: cleanArgs, description: descriptor.description }],
      source: 'deterministic',
      confidence: 0.8,
      reasoning: `matched the pattern for ${rule.operation}`,
      mutating: descriptor.mutating,
    };
  }

  return {
    instruction: text,
    steps: [],
    source: 'deterministic',
    confidence: 0.1,
    reasoning: 'no known operation matches this instruction',
    mutating: false,
  };
}

export function describePlan(plan: Plan): string {
  if (plan.steps.length === 0) return `I do not know how to: "${plan.instruction}"`;
  return plan.steps.map((step) => step.description).join(', then ');
}

/** The prompt a model is given, so its output is constrained to the same vocabulary. */
export function plannerSystemPrompt(): string {
  const catalogue = OPERATIONS.map(
    (operation) => `- ${operation.id}: ${operation.description} (arguments: ${operation.arguments.join(', ') || 'none'}; mutating: ${operation.mutating})`,
  ).join('\n');
  return [
    'You translate a Minecraft operator instruction into exactly one operation from a fixed list.',
    'Reply with JSON only, shaped as {"operation": "<id>", "arguments": {...}, "reasoning": "<short>"}.',
    'If no operation fits, reply {"operation": null, "reasoning": "<why>"}.',
    'Never invent an operation id. Never include code. Only these operations exist:',
    catalogue,
  ].join('\n');
}
