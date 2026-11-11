/**
 * Natural-language command parsing for the hive.
 *
 * This is a *deterministic* parser, not a language model: it recognises the phrasings in the brief
 * by keyword and turns each into one structured {@link HiveCommand}. A phrase it does not recognise
 * is refused with what it *can* do, rather than guessed at. That is what keeps an operator's words
 * from becoming an arbitrary action: the parser only ever emits a command from the closed set below,
 * and every command is then validated by the coordinator before anything reaches a worker.
 *
 * The same instruction always yields the same command, which is what makes the parser testable.
 */
import type { FormationKind } from './formations';
import type { HiveRole } from './roles';

export type HiveCommandKind =
  | 'formation'      // set a formation and keep it
  | 'follow'         // follow the commander
  | 'circle'         // circle the commander (a formation shorthand)
  | 'protect'        // hold a defensive ring
  | 'scatter'        // spread out
  | 'scout'          // explore an area
  | 'assign'         // send N workers to a named role/task
  | 'stop'           // stop all tasks (keep the hive)
  | 'recall'         // bring everyone back to the commander
  | 'regroup'        // return to formation
  | 'store'          // organise storage
  | 'guard'          // monitor an area
  | 'role'           // set a worker's role
  | 'status'         // report, no action
  | 'unknown';

export interface HiveCommand {
  kind: HiveCommandKind;
  /** The original instruction, for the history panel. */
  instruction: string;
  /** Formation, when the command sets one. */
  formation?: FormationSpecPatch;
  /** How many workers the command targets, when it says so. */
  count?: number;
  /** A role the command assigns. */
  role?: HiveRole;
  /** A named area or direction ("north", "spawn", "the northern area"). */
  area?: string;
  /** A direction derived from the instruction, when one is named. */
  direction?: 'north' | 'south' | 'east' | 'west';
  /** A radius, when the instruction names one ("within 50 blocks"). */
  radius?: number;
  /** Whether the instruction explicitly targets every worker. */
  everyone: boolean;
  /** A confidence in [0, 1]. */
  confidence: number;
  /** When the command is only a question, the answer to show. */
  note?: string;
}

export interface FormationSpecPatch {
  kind: FormationKind;
  spacing?: number;
  radius?: number;
  rotation?: number;
  depth?: number;
}

interface Rule {
  kind: HiveCommandKind;
  phrases: string[];
  build?: (instruction: string, matched: string) => Partial<HiveCommand>;
}

const DIRECTION_WORDS: { word: string; direction: HiveCommand['direction'] }[] = [
  { word: 'north', direction: 'north' },
  { word: 'south', direction: 'south' },
  { word: 'east', direction: 'east' },
  { word: 'west', direction: 'west' },
];

const RULES: Rule[] = [
  {
    kind: 'circle',
    phrases: ['circle around me', 'circle me', 'circle around', 'surround me', 'ring around me'],
    build: () => ({ formation: { kind: 'circle' }, everyone: true }),
  },
  {
    kind: 'protect',
    phrases: ['protect my position', 'protect me', 'guard my position', 'defend my position', 'protect the position'],
    build: () => ({ formation: { kind: 'escort' }, role: 'GUARD', everyone: true }),
  },
  {
    kind: 'scatter',
    phrases: ['spread out around spawn', 'spread out', 'spread across', 'scatter'],
    build: () => ({ formation: { kind: 'scatter' }, everyone: true }),
  },
  {
    kind: 'follow',
    phrases: ['everyone follow me', 'follow me', 'follow the commander', 'stay with me', 'on me'],
    build: () => ({ formation: { kind: 'follow' }, everyone: true }),
  },
  {
    kind: 'regroup',
    phrases: ['everyone return to formation', 'return to formation', 'regroup', 'back to formation', 'reform'],
    build: () => ({ everyone: true }),
  },
  {
    kind: 'recall',
    phrases: ['bring everyone back', 'recall the entire hive', 'recall everyone', 'everyone return', 'bring them back', 'come back'],
    build: () => ({ everyone: true }),
  },
  {
    kind: 'stop',
    phrases: ['stop all tasks', 'stop everything', 'halt', 'abort all', 'cancel all tasks'],
    build: () => ({ everyone: true }),
  },
  {
    kind: 'store',
    phrases: ['organize storage', 'organise storage', 'organize the storage', 'organise the storage', 'sort storage', 'sort the chests'],
    build: () => ({ role: 'STORAGE' }),
  },
  {
    kind: 'guard',
    phrases: ['guard this area', 'guard the area', 'monitor the area', 'watch this area', 'hold this position'],
    build: () => ({ role: 'GUARD' }),
  },
  {
    kind: 'status',
    phrases: ['status', 'report', 'where is everyone', 'what are you doing', 'sitrep'],
    build: () => ({ everyone: true, note: 'Hive status follows.' }),
  },
];

const SCOUT_PHRASES = ['scout', 'explore', 'survey', 'recon', 'search the area'];
const ASSIGN_VERBS = ['send', 'assign', 'have', 'give', 'dispatch', 'task'];
const ROLE_WORDS: { word: string; role: HiveRole }[] = [
  { word: 'scout', role: 'SCOUT' },
  { word: 'builder', role: 'BUILDER' },
  { word: 'build', role: 'BUILDER' },
  { word: 'miner', role: 'MINER' },
  { word: 'mine', role: 'MINER' },
  { word: 'logistics', role: 'LOGISTICS' },
  { word: 'storage', role: 'STORAGE' },
  { word: 'guard', role: 'GUARD' },
  { word: 'support', role: 'SUPPORT' },
  { word: 'escort', role: 'ESCORT' },
  { word: 'generalist', role: 'GENERALIST' },
  { word: 'commander', role: 'COMMANDER' },
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Parses one instruction into a command.
 *
 * The parse is ordered: the most specific phrasings are tried first, so "everyone follow me" is a
 * `follow` even though it also contains "everyone". A phrase that matches nothing is `unknown`, and
 * the caller refuses it honestly.
 */
export function parseCommand(instruction: string): HiveCommand {
  const text = instruction.trim().toLowerCase();
  const everyone = /\b(everyone|everyone|all|whole hive|entire hive|every worker|the hive)\b/.test(text);
  const count = extractCount(text);
  const direction = DIRECTION_WORDS.find((entry) => text.includes(entry.word))?.direction;
  const radius = extractRadius(text);
  const role = ROLE_WORDS.find((entry) => new RegExp(`\\b${entry.word}\\b`).test(text))?.role;

  for (const rule of RULES) {
    const matched = rule.phrases.find((phrase) => text.includes(phrase));
    if (matched) {
      const base = rule.build ? rule.build(instruction, matched) : {};
      return {
        kind: rule.kind,
        instruction,
        everyone: base.everyone ?? everyone,
        confidence: 0.9,
        ...base,
        ...(direction ? { direction } : {}),
        ...(radius ? { radius } : {}),
      };
    }
  }

  // "HIVE, circle around me and scout the surrounding area" is two commands in one. The
  // coordinator accepts a single structured command per call, so a compound instruction is reduced
  // to its first, most actionable clause and the rest is left for a follow-up. Splitting on " and "
  // keeps "send two workers" intact while still finding the leading verb.
  const scoutMatch = SCOUT_PHRASES.find((phrase) => text.includes(phrase));
  if (scoutMatch) {
    return {
      kind: 'scout',
      instruction,
      everyone: everyone || count === undefined,
      ...(count !== undefined ? { count } : {}),
      ...(direction ? { direction } : {}),
      ...(radius ? { radius } : {}),
      confidence: 0.85,
    };
  }

  const assignVerb = ASSIGN_VERBS.find((verb) => new RegExp(`\\b${verb}\\b`).test(text));
  if (assignVerb) {
    const targetRole = role ?? inferRoleFromText(text);
    if (targetRole) {
      return {
        kind: 'assign',
        instruction,
        role: targetRole,
        ...(count !== undefined ? { count } : { count: 1 }),
        ...(direction ? { direction } : {}),
        area: extractArea(text),
        everyone: false,
        confidence: 0.75,
      };
    }
  }

  if (role && (text.includes('make') || text.includes('set') || text.includes('be a') || text.includes('role'))) {
    return { kind: 'role', instruction, role, everyone: false, confidence: 0.7 };
  }

  return {
    kind: 'unknown',
    instruction,
    everyone,
    confidence: 0,
    note:
      'I did not recognise that instruction. I understand: follow me, circle around me, protect my position, ' +
      'spread out, scout the area, send two workers to scout, have one worker organise storage, return to formation, ' +
      'bring everyone back, stop all tasks, recall the entire hive.',
  };
}

function inferRoleFromText(text: string): HiveRole | undefined {
  if (text.includes('storage') || text.includes('organise') || text.includes('organize') || text.includes('chest')) return 'STORAGE';
  if (text.includes('scout') || text.includes('explore')) return 'SCOUT';
  if (text.includes('guard') || text.includes('protect')) return 'GUARD';
  if (text.includes('build')) return 'BUILDER';
  if (text.includes('mine')) return 'MINER';
  if (text.includes('haul') || text.includes('transport') || text.includes('bring items')) return 'LOGISTICS';
  return undefined;
}

function extractCount(text: string): number | undefined {
  const digit = /\b(\d{1,3})\s*(?:workers?|bots?|members?)?\b/.exec(text);
  if (digit) return Math.max(1, Math.min(64, Number(digit[1])));
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  if (/\b(a|an|one)\b/.test(text) && /\bworker|bot|member\b/.test(text)) return 1;
  return undefined;
}

function extractRadius(text: string): number | undefined {
  const match = /\b(\d{1,4})\s*(?:blocks?|metres?|meters?|m\b)/.exec(text);
  if (match) return Math.max(1, Math.min(512, Number(match[1])));
  return undefined;
}

function extractArea(text: string): string | undefined {
  const match = /\b(?:the\s+)?([a-z]+(?:\s+[a-z]+)?)\s+area\b/.exec(text);
  if (match) return match[1].trim();
  if (text.includes('spawn')) return 'spawn';
  return undefined;
}

/** Splits a compound instruction into its clauses, for the UI to show what was understood. */
export function splitClauses(instruction: string): string[] {
  return instruction
    .split(/\band\b|,/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}
