/**
 * Role definitions, per-role configuration schemas and permission profiles.
 *
 * A role describes what a bot is allowed to do. The permission profile is the single source of
 * truth consulted by the role coordinator before any role-specific action is accepted. Roles are
 * intentionally conservative: nothing here attacks, evades server controls or acts on players
 * outside an explicitly authorised PvP test environment.
 */
import type { BotRole } from '../../../shared/types';

export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'stringList';
  options?: string[];
  default: unknown;
  description: string;
  /** When true, the field must be explicitly set before the role may start. */
  required?: boolean;
}

export interface RoleDefinition {
  role: BotRole;
  title: string;
  color: string;
  description: string;
  fields: ConfigField[];
  /** Event types this role may emit. */
  emits: string[];
  permissions: {
    /** May observe other players / targets. */
    observe: boolean;
    /** May act on the world (equipment sorting, stasis setup). */
    act: boolean;
    /** May engage in controlled PvP testing (requires explicit authorisation). */
    combat: boolean;
    /** May issue administrative chat commands. */
    admin: boolean;
  };
}

const EQUIPMENT_PROFILE: ConfigField = {
  key: 'equipmentProfileId',
  label: 'Equipment profile',
  type: 'string',
  default: '',
  description: 'The saved equipment loadout this Gearer enforces.',
};

const WARNING_THRESHOLD: ConfigField = {
  key: 'durabilityWarningPercent',
  label: 'Durability warning %',
  type: 'number',
  default: 15,
  description: 'Raise a warning when an equipped item drops below this durability percentage.',
};

export const ROLE_DEFINITIONS: Record<BotRole, RoleDefinition> = {
  GEARER: {
    role: 'GEARER',
    title: 'Gearer',
    color: '#4fd1c5',
    description: 'Manages and monitors armour, weapons, tools and inventory supplies.',
    fields: [
      EQUIPMENT_PROFILE,
      {
        key: 'autoSort',
        label: 'Auto-sort inventory',
        type: 'boolean',
        default: false,
        description: 'Reorder the inventory to match the profile. Never drops items.',
      },
      {
        key: 'monitorIntervalMs',
        label: 'Monitor interval (ms)',
        type: 'number',
        default: 5000,
        description: 'How often equipment is re-evaluated.',
      },
      WARNING_THRESHOLD,
      {
        key: 'reportStatus',
        label: 'Report equipment status',
        type: 'boolean',
        default: true,
        description: 'Publish EQUIPMENT_READY / EQUIPMENT_WARNING events to the fleet.',
      },
    ],
    emits: ['EQUIPMENT_READY', 'EQUIPMENT_WARNING', 'INVENTORY_CHANGED'],
    permissions: { observe: false, act: true, combat: false, admin: false },
  },
  STASIS: {
    role: 'STASIS',
    title: 'Stasis',
    color: '#9f7aea',
    description: 'Monitors stasis locations, readiness and state changes.',
    fields: [
      {
        key: 'stasisLocationId',
        label: 'Stasis location',
        type: 'string',
        default: '',
        description: 'The saved stasis location this controller monitors.',
      },
      {
        key: 'monitorIntervalMs',
        label: 'Monitor interval (ms)',
        type: 'number',
        default: 10000,
        description: 'How often the location is re-verified.',
      },
      {
        key: 'notifyOnChange',
        label: 'Notify on state change',
        type: 'boolean',
        default: true,
        description: 'Raise a notification whenever the stasis state changes.',
      },
      {
        key: 'confirmActions',
        label: 'Require confirmation',
        type: 'boolean',
        default: true,
        description: 'Ask for confirmation before any state-changing action.',
      },
      {
        key: 'timeoutMs',
        label: 'Action timeout (ms)',
        type: 'number',
        default: 15000,
        description: 'Abort a state change that does not complete within this time.',
      },
    ],
    emits: ['STASIS_READY', 'STASIS_UNAVAILABLE', 'STASIS_STATE_CHANGED'],
    permissions: { observe: true, act: true, combat: false, admin: false },
  },
  HUNTER: {
    role: 'HUNTER',
    title: 'Hunter',
    color: '#f56565',
    description: 'Observes targets and, only in an authorised PvP test environment, engages them.',
    fields: [
      {
        key: 'targetListId',
        label: 'Target list',
        type: 'string',
        default: '',
        description: 'The permitted target list for controlled testing.',
      },
      {
        key: 'meteorProfile',
        label: 'Meteor integration profile',
        type: 'string',
        default: 'default',
        description: 'The Logvex Hunter / Meteor profile to apply.',
      },
      {
        key: 'observeIntervalMs',
        label: 'Observation interval (ms)',
        type: 'number',
        default: 2000,
        description: 'How often targets are polled.',
      },
      {
        key: 'combatEnabled',
        label: 'Combat testing enabled',
        type: 'boolean',
        default: false,
        description: 'Master switch for controlled combat testing. Off by default.',
      },
      {
        key: 'authorizedCombat',
        label: 'Explicit combat authorisation',
        type: 'boolean',
        default: false,
        description: 'Confirms this HUNTER may engage targets in a private test environment.',
        required: true,
      },
      {
        key: 'allowlist',
        label: 'Target allowlist',
        type: 'stringList',
        default: [],
        description: 'Only these target usernames/UUIDs may be engaged.',
      },
    ],
    emits: ['TARGET_DETECTED', 'TARGET_UPDATED', 'TARGET_DISAPPEARED', 'TARGET_REAPPEARED',
      'TARGET_CLASSIFIED', 'ENCOUNTER_STARTED', 'ENCOUNTER_FINISHED', 'COMBAT_EVENT'],
    permissions: { observe: true, act: false, combat: true, admin: false },
  },
};

export function roleDefinition(role: BotRole): RoleDefinition {
  return ROLE_DEFINITIONS[role];
}

export function defaultRoleConfig(role: BotRole): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of ROLE_DEFINITIONS[role].fields) out[field.key] = field.default;
  return out;
}

export interface RoleConfigIssue {
  field: string;
  message: string;
}

/** Validates a role configuration against the role's schema. */
export function validateRoleConfig(role: BotRole, config: Record<string, unknown>): RoleConfigIssue[] {
  const issues: RoleConfigIssue[] = [];
  for (const field of ROLE_DEFINITIONS[role].fields) {
    const value = config[field.key];
    if (field.required) {
      const missing = value === undefined || value === null || value === '' || value === false;
      if (missing) issues.push({ field: field.key, message: `${field.label} must be set.` });
    }
    if (value !== undefined && value !== null) {
      if (field.type === 'number' && typeof value !== 'number') {
        issues.push({ field: field.key, message: `${field.label} must be a number.` });
      }
      if (field.type === 'stringList' && !Array.isArray(value)) {
        issues.push({ field: field.key, message: `${field.label} must be a list.` });
      }
    }
  }
  return issues;
}

/** Applies schema defaults to any missing keys, returning a new object. */
export function withRoleDefaults(role: BotRole, config: Record<string, unknown>): Record<string, unknown> {
  return { ...defaultRoleConfig(role), ...config };
}
