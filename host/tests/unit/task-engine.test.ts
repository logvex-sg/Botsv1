/**
 * Task engine tests: definitions, lifecycle transitions and request validation.
 */
import { describe, expect, it } from 'vitest';
import {
  TASK_LIBRARY,
  canAdvance,
  definitionFor,
  isTerminal,
  libraryByCategory,
  validateRequest,
} from '../../src/main/packages/task-engine';
import { TASK_KINDS } from '../../src/shared/workers';

describe('task library', () => {
  it('defines every task kind exactly once', () => {
    const kinds = TASK_LIBRARY.map((def) => def.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.length).toBe(TASK_KINDS.length);
  });

  it('covers every wire task kind the worker protocol knows', () => {
    for (const kind of TASK_KINDS) {
      expect(definitionFor(kind), `no task definition for "${kind}"`).toBeDefined();
    }
  });

  it('marks the mutating kinds as exclusive', () => {
    for (const kind of ['regear', 'command', 'chat', 'efly', 'container-move', 'shulker-pack', 'shulker-unpack', 'restock']) {
      expect(definitionFor(kind as never)?.mutating).toBe(true);
    }
  });

  it('keeps the read-only storage kinds non-exclusive', () => {
    for (const kind of ['container-read', 'shulker-read', 'portal-scan']) {
      expect(definitionFor(kind as never)?.mutating).toBe(false);
    }
  });

  it('groups tasks by category with no empty categories', () => {
    const groups = libraryByCategory();
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group.tasks.length).toBeGreaterThan(0);
  });
});

describe('task lifecycle', () => {
  it('advances along the happy path', () => {
    expect(canAdvance('QUEUED', 'VALIDATING')).toBe(true);
    expect(canAdvance('VALIDATING', 'RUNNING')).toBe(true);
    expect(canAdvance('RUNNING', 'COMPLETED')).toBe(true);
  });

  it('refuses to leave a terminal state', () => {
    expect(canAdvance('COMPLETED', 'RUNNING')).toBe(false);
    expect(canAdvance('FAILED', 'RUNNING')).toBe(false);
  });

  it('lets a running task pause and resume', () => {
    expect(canAdvance('RUNNING', 'PAUSED')).toBe(true);
    expect(canAdvance('PAUSED', 'RUNNING')).toBe(true);
  });

  it('identifies terminal states', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('RUNNING')).toBe(false);
  });
});

describe('validateRequest', () => {
  it('accepts a read-only task with no capabilities', () => {
    expect(validateRequest('status', []).ok).toBe(true);
  });

  it('refuses a task the worker cannot run, with a reason', () => {
    const result = validateRequest('efly', ['inventory']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('efly');
  });

  it('refuses an unknown kind', () => {
    expect(validateRequest('exec', []).ok).toBe(false);
  });
});
