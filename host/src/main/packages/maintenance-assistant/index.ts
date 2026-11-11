/**
 * Maintenance assistant: turning a plain-language request into an operation.
 *
 * The assistant is a *deterministic intent classifier*, not a language model. It recognises the
 * requests from the brief by their keywords and maps each to one of the storage operations, so the
 * behaviour is predictable, testable and never hallucinates an action. A request that matches no
 * intent is answered honestly with what it *could* do, rather than guessing.
 *
 * Pure: unit-testable.
 */
import { OPERATIONS, operationById } from '../workflow-engine';

export interface Intent {
  /** The operation id the request maps to, or null when it is only a question. */
  operation: string | null;
  /** A normalised query extracted from the request (e.g. "building materials"), or ''. */
  query: string;
  /** A confidence in [0, 1]; the highest-scoring intent wins. */
  score: number;
  /** The matched request text. */
  request: string;
}

/** A recognisable request pattern. */
interface Rule {
  /** Phrases (lower-cased substrings) that indicate this intent. */
  phrases: string[];
  operation: string | null;
  /** Words to strip when extracting a query from the request. */
  strip?: string[];
}

/**
 * The intent table.
 *
 * Each rule's phrases are matched as substrings, so "organise all my shulkers" and "sort my
 * shulker boxes" both reach the shulker-organise operation.
 */
const RULES: Rule[] = [
  { phrases: ['find empty shulker', 'empty shulker box', 'empty shulkers'], operation: 'shulker-cleanup' },
  { phrases: ['organize all my shulker', 'organise all my shulker', 'organize my shulker', 'organise my shulker', 'sort my shulker', 'sort shulker', 'organize shulker', 'organise shulker'], operation: 'shulker-organise' },
  { phrases: ['unpack shulker', 'empty a shulker', 'unpack my shulker'], operation: 'shulker-unpack' },
  { phrases: ['shulker with mixed', 'mixed contents', 'mixed shulker'], operation: 'shulker-organise' },
  { phrases: ['consolidate my', 'consolidate', 'merge partial', 'partial stacks', 'partial filled', 'partially filled'], operation: 'consolidate' },
  { phrases: ['restock', 'top up', 'refill my', 'refill the'], operation: 'restock' },
  { phrases: ['find all full', 'full container', 'which chests are full'], operation: 'maintain' },
  { phrases: ['obsolete portal', 'check my registered portal', 'portal maintenance', 'clean up my portal', 'cleanup portal', 'remove portal', 'obsolete entries'], operation: 'portal-cleanup' },
  { phrases: ['cannot be sorted', 'cannot sort', 'unsortable', 'un-sortable', 'cannot be organised', 'nothing sorts'], operation: 'maintain' },
  { phrases: ['clean up my registered storage', 'clean up my storage', 'cleanup my storage', 'storage room', 'clean my storage'], operation: 'maintain' },
  { phrases: ['move all building', 'move building materials', 'building materials into', 'assigned storage', 'move items into'], operation: 'sort' },
  { phrases: ['organize my storage', 'organise my storage', 'sort my storage', 'sort my chests', 'organize my chests', 'organise my chests'], operation: 'sort' },
  { phrases: ['dispose', 'throw away', 'get rid of', 'delete my cobble', 'dump my'], operation: 'dispose' },
  { phrases: ['storage maintenance report', 'maintenance report', 'complete report', 'full report'], operation: 'maintain' },
  { phrases: ['inspect', 'scan my containers', 'scan containers', 'check my containers'], operation: 'inspect' },
  { phrases: ['distribute', 'spread out', 'balance my chests'], operation: 'distribute' },
];

const QUERY_STRIP = [
  'move all', 'move', 'restock', 'find', 'show me', 'show', 'get', 'check', 'organize', 'organise',
  'sort', 'consolidate', 'clean up', 'cleanup', 'my', 'all', 'the', 'into', 'to', 'in', 'for',
  'please', 'boxes', 'box', 'shulkers', 'shulker', 'materials', 'items', 'storage', 'chests', 'chest',
];

/** Extracts a candidate item/query phrase from a request, or '' when none is obvious. */
export function extractQuery(request: string): string {
  let text = ` ${request.toLowerCase().replace(/[^a-z0-9_ ]/g, ' ')} `;
  for (const word of QUERY_STRIP) text = text.split(` ${word} `).join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Classifies a request.
 *
 * The longest matching phrase wins, so "find empty shulkers" beats a bare "shulker". When nothing
 * matches, the operation is null and the caller shows the assistant's capability list.
 */
export function classify(request: string): Intent {
  const text = request.toLowerCase();
  let best: Intent = { operation: null, query: '', score: 0, request };
  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      if (!text.includes(phrase)) continue;
      const score = phrase.length;
      if (score > best.score) {
        best = { operation: rule.operation, query: extractQuery(request), score, request };
      }
    }
  }
  return best;
}

/** The list of things the assistant understands, for the "what can you do" answer. */
export function capabilities(): string[] {
  return OPERATIONS.map((operation) => `${operation.id}: ${operation.description}`);
}

/**
 * Produces a plain-language answer for a request.
 *
 * When the request maps to an operation, the answer names it; otherwise it lists what the assistant
 * can do. The caller attaches the real plan to a matched operation, so the answer never claims a
 * plan exists when none was produced.
 */
export function answer(request: string): { operation: string | null; text: string } {
  const intent = classify(request);
  if (!intent.operation) {
    return {
      operation: null,
      text: `I did not recognise that request. I can: ${OPERATIONS.map((operation) => operation.label.toLowerCase()).join(', ')}.`,
    };
  }
  const operation = operationById(intent.operation);
  return {
    operation: intent.operation,
    text: operation ? `${operation.label}: ${operation.description}` : `Unknown operation ${intent.operation}.`,
  };
}
