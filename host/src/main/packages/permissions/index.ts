/**
 * Permissions: granular authorisation for every storage operation.
 *
 * The spec asks for levels (view → administer), protected objects, and a rule that a destructive
 * operation needs explicit configuration, an authorisation check, a preview and a confirmation.
 * This engine is that policy in one place: it maps an action to the level it needs, checks a
 * subject's grant, refuses to touch a protected object without administration, and decides whether
 * a destructive action still needs a confirmation on top of the level check.
 *
 * It is pure policy: it returns decisions, it never performs an action. Every caller that mutates
 * anything asks here first, so the rule is enforced once.
 */

/**
 * The permission ladder. Each level implies every level below it.
 *
 * The order is the contract: inserting a level means inserting it in rank order and nowhere else.
 */
export const PERMISSION_LEVELS = [
  'view',
  'inspect',
  'sort',
  'transfer',
  'manage_shulkers',
  'manage_networks',
  'manage_structures',
  'maintenance',
  'manage_workers',
  'configure_automation',
  'administer',
] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** The numeric rank of a level, higher is more powerful. Unknown levels rank below `view`. */
export function rank(level: string): number {
  const index = (PERMISSION_LEVELS as readonly string[]).indexOf(level);
  return index < 0 ? -1 : index;
}

/** Whether `held` is at least `required`. */
export function atLeast(held: string, required: PermissionLevel): boolean {
  return rank(held) >= rank(required);
}

/**
 * The actions a subject can attempt, each with the level it needs.
 *
 * The keys are stable ids; the UI and the automation builder refer to actions by these, so the
 * policy lives here rather than scattered across callers.
 */
export const ACTIONS = {
  'storage.view': 'view',
  'storage.inspect': 'inspect',
  'storage.search': 'inspect',
  'inventory.sort': 'sort',
  'inventory.consolidate': 'sort',
  'items.transfer': 'transfer',
  'items.dispose': 'transfer',
  'shulker.fill': 'manage_shulkers',
  'shulker.unload': 'manage_shulkers',
  'shulker.consolidate': 'manage_shulkers',
  'shulker.destroy': 'administer',
  'network.create': 'manage_networks',
  'network.edit': 'manage_networks',
  'network.delete': 'manage_networks',
  'structure.register': 'manage_structures',
  'structure.edit': 'manage_structures',
  'structure.remove': 'maintenance',
  'portal.remove': 'maintenance',
  'maintenance.run': 'maintenance',
  'workers.assign': 'manage_workers',
  'workers.control': 'manage_workers',
  'automation.configure': 'configure_automation',
  'automation.run': 'configure_automation',
  'config.administer': 'administer',
} as const satisfies Record<string, PermissionLevel>;

export type ActionId = keyof typeof ACTIONS;

/** The level an action needs. */
export function requiredLevel(action: ActionId): PermissionLevel {
  return ACTIONS[action];
}

/** Actions that change or destroy something, and therefore need a confirmation on top of the level. */
const DESTRUCTIVE_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>([
  'items.dispose',
  'shulker.destroy',
  'network.delete',
  'structure.remove',
  'portal.remove',
  'workers.control',
  'config.administer',
]);

/** Whether an action is destructive and so needs an explicit confirmation. */
export function isDestructive(action: ActionId): boolean {
  return DESTRUCTIVE_ACTIONS.has(action);
}

/** A subject's grant: who they are and the highest level they hold. */
export interface Grant {
  subject: string;
  level: PermissionLevel;
  /** Optional per-action overrides: an explicit allow/deny for one action, whatever the level. */
  overrides?: Partial<Record<ActionId, boolean>>;
}

/** The object an action targets, with whatever protection flags the operator set on it. */
export interface TargetObject {
  kind: 'container' | 'network' | 'shulker' | 'item' | 'structure' | 'region' | 'worker';
  id: string;
  /** A protected object may only be touched by an administrator. */
  protected?: boolean;
  /** A locked object is never touched by automation, at any level. */
  locked?: boolean;
}

export interface Decision {
  allowed: boolean;
  /** The level the action needed. */
  required: PermissionLevel;
  /** The level the subject held. */
  held: PermissionLevel;
  /** When not allowed, the single human-readable reason. */
  reason: string;
  /** When allowed but destructive, whether a confirmation is still required. */
  needsConfirmation: boolean;
}

/** Whether a grant may perform an action at all, ignoring any target object. */
export function allows(grant: Grant, action: ActionId): Decision {
  const override = grant.overrides?.[action];
  const needed = requiredLevel(action);
  const base: Decision = {
    allowed: false,
    required: needed,
    held: grant.level,
    reason: '',
    needsConfirmation: isDestructive(action),
  };
  if (override === false) {
    return { ...base, reason: `an explicit rule denies ${action} for ${grant.subject}` };
  }
  if (override === true) {
    return { ...base, allowed: true };
  }
  if (atLeast(grant.level, needed)) {
    return { ...base, allowed: true };
  }
  return { ...base, reason: `${action} needs ${needed}, but ${grant.subject} holds ${grant.level}` };
}

/**
 * Whether a grant may perform an action on a specific object.
 *
 * A locked object is refused at every level (automation never overrides a lock), and a protected
 * object needs the top level unless an explicit override allows it. The level check from
 * {@link allows} still applies.
 */
export function authorize(grant: Grant, action: ActionId, target?: TargetObject): Decision {
  const base = allows(grant, action);
  if (!base.allowed) return base;
  if (!target) return base;

  if (target.locked) {
    return { ...base, allowed: false, reason: `${target.kind} ${target.id} is locked` };
  }
  if (target.protected && grant.overrides?.[action] !== true && grant.level !== 'administer') {
    return { ...base, allowed: false, reason: `${target.kind} ${target.id} is protected and needs an administrator` };
  }
  return base;
}

/**
 * Whether a destructive action still needs a confirmation.
 *
 * A caller passes `confirmed: true` once the operator has approved the specific preview. An
 * administrator's explicit override may waive the confirmation, so an unattended admin task does
 * not stall, but the default is always to ask.
 */
export function requiresConfirmation(grant: Grant, action: ActionId, options: { confirmed?: boolean } = {}): boolean {
  if (!isDestructive(action)) return false;
  if (options.confirmed) return false;
  return grant.overrides?.[action] !== true;
}

/** The set of levels a grant reaches, from `view` up to its own level. */
export function reachable(grant: Grant): PermissionLevel[] {
  const top = rank(grant.level);
  return PERMISSION_LEVELS.filter((level) => rank(level) <= top);
}

/** Every action a grant may perform, ignoring target objects. */
export function permittedActions(grant: Grant): ActionId[] {
  return (Object.keys(ACTIONS) as ActionId[]).filter((action) => allows(grant, action).allowed);
}

/** A compact, stable description of a grant for the UI and logs. */
export function describeGrant(grant: Grant): string {
  const overrides = Object.entries(grant.overrides ?? {})
    .map(([action, allow]) => `${action}=${allow ? 'allow' : 'deny'}`)
    .sort()
    .join(', ');
  return overrides ? `${grant.subject}: ${grant.level} (${overrides})` : `${grant.subject}: ${grant.level}`;
}

/** Reads an untrusted level string, falling back to `view` (the least authority). */
export function normalizeLevel(value: unknown): PermissionLevel {
  return typeof value === 'string' && (PERMISSION_LEVELS as readonly string[]).includes(value)
    ? (value as PermissionLevel)
    : 'view';
}
