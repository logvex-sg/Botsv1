/**
 * Capabilities package tests: normalisation, requirement checking and the "never offer a task the
 * worker cannot run" rule.
 */
import { describe, expect, it } from 'vitest';
import { availableTaskKinds, canRun, normalize, requirementsFor } from '../../src/shared/capabilities';

describe('normalize', () => {
  it('keeps known capability names', () => {
    expect(normalize(['inventory', 'efly']).capabilities.sort()).toEqual(['efly', 'inventory']);
  });

  it('maps reported task kinds onto the capabilities they require', () => {
    const result = normalize(['container-read', 'shulker-read', 'portal-scan']).capabilities.sort();
    expect(result).toEqual(['container_access', 'portal_scan', 'shulker_read']);
  });

  it('understands a real worker report that mixes kinds and keys', () => {
    const result = normalize(['status', 'inventory', 'regear', 'efly', 'container-move']).capabilities.sort();
    // status needs nothing; inventory -> inventory; regear -> regear+inventory;
    // efly -> efly; container-move -> container_move+container_access.
    expect(result).toEqual(['container_access', 'container_move', 'efly', 'inventory', 'regear']);
  });

  it('drops unknown names so a worker cannot smuggle in an unknown capability', () => {
    expect(normalize(['inventory', 'root', 'exec']).capabilities).toEqual(['inventory']);
  });

  it('de-duplicates and tolerates a non-array', () => {
    expect(normalize(['inventory', 'inventory']).capabilities).toEqual(['inventory']);
    expect(normalize(null).capabilities).toEqual([]);
    expect(normalize({ evil: true }).capabilities).toEqual([]);
  });
});

describe('canRun', () => {
  it('allows a read-only task with no requirements', () => {
    expect(canRun([], 'status').ok).toBe(true);
  });

  it('refuses a task whose capability the worker does not advertise', () => {
    const result = canRun(['inventory'], 'efly');
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('efly');
    expect(result.reason).toContain('efly');
  });

  it('requires both regear and inventory for a regear task', () => {
    expect(requirementsFor('regear')).toEqual(['regear', 'inventory']);
    expect(canRun(['regear'], 'regear').ok).toBe(false);
    expect(canRun(['regear', 'inventory'], 'regear').ok).toBe(true);
  });

  it('accepts a full CapabilitySet object as well as a bare list', () => {
    expect(canRun({ version: 1, capabilities: ['chat'] }, 'chat').ok).toBe(true);
  });

  it('accepts a raw worker report of task kinds', () => {
    expect(canRun(['container-read'], 'container-read').ok).toBe(true);
    expect(canRun(['container-read'], 'container-move').ok).toBe(false);
    expect(canRun(['shulker-read', 'container-read'], 'shulker-read').ok).toBe(true);
  });
});

describe('availableTaskKinds', () => {
  it('offers only the kinds a bare worker can run', () => {
    expect(availableTaskKinds([])).toEqual(['status']);
  });

  it('offers the full set for a fully capable worker', () => {
    const full = ['inventory', 'item_counting', 'item_search', 'equipment_inspection', 'regear',
      'position_reporting', 'command', 'chat', 'efly'] as const;
    expect(availableTaskKinds([...full]).length).toBe(10);
  });
});
