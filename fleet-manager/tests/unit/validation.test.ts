import { describe, it, expect } from 'vitest';
import { validateDeployment } from '../../src/main/services/deployment/validation';
import { validateRoleConfig } from '../../src/main/services/roles/roles';
import type { Account, DeploymentConfig, ServerProfile } from '../../src/shared/types';

function account(over: Partial<Account> = {}): Account {
  return {
    id: 'a1', username: 'Bot', displayName: 'Bot', authMode: 'offline', role: 'HUNTER',
    groupId: null, hasCredential: false, lastLogin: null, lastLoginOk: false,
    serverProfileId: null, notes: '', createdAt: 0, updatedAt: 0, ...over,
  };
}

function server(): ServerProfile {
  return { id: 's1', name: 'S', host: 'h', port: 25565, version: '', authMode: 'offline', connectionTimeoutMs: 15000, options: {}, createdAt: 0, updatedAt: 0 };
}

function config(over: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    id: 'd1', name: 'D', description: '', serverProfileId: 's1',
    entries: [{ accountId: 'a1', role: 'GEARER', instanceName: 'GEARER-01', delayMs: 0, roleConfig: {} }],
    maxConcurrent: 1, connectionTimeoutMs: 15000, retryAttempts: 2, retryDelayMs: 5000,
    manualApproval: false, pauseBetweenMs: 5000, resourceLimitMb: 4096, notifyOnEvent: true,
    createdAt: 0, updatedAt: 0, ...over,
  };
}

const base = {
  accounts: [account()], servers: [server()], instances: [] as never[],
  hasCredential: async () => true, validateRole: validateRoleConfig,
};

describe('validateDeployment', () => {
  it('passes a well-formed deployment', async () => {
    const report = await validateDeployment({ ...base, config: config() });
    expect(report.ok).toBe(true);
  });

  it('flags a missing server profile', async () => {
    const report = await validateDeployment({ ...base, config: config({ serverProfileId: null }) });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'server')).toBe(true);
  });

  it('flags an empty deployment', async () => {
    const report = await validateDeployment({ ...base, config: config({ entries: [] }) });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'empty')).toBe(true);
  });

  it('flags missing credentials for online accounts', async () => {
    const report = await validateDeployment({
      ...base, accounts: [account({ authMode: 'microsoft' })], hasCredential: async () => false, config: config(),
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'credential')).toBe(true);
  });

  it('flags duplicate instance names', async () => {
    const report = await validateDeployment({
      ...base,
      config: config({ entries: [
        { accountId: 'a1', role: 'GEARER', instanceName: 'X', delayMs: 0, roleConfig: {} },
        { accountId: 'a1', role: 'GEARER', instanceName: 'X', delayMs: 0, roleConfig: {} },
      ] }),
    });
    expect(report.issues.some((i) => i.code === 'duplicate-name')).toBe(true);
  });

  it('warns about excessive resource use', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ accountId: 'a1', role: 'GEARER' as const, instanceName: `X${i}`, delayMs: 0, roleConfig: {} }));
    const report = await validateDeployment({ ...base, config: config({ entries, resourceLimitMb: 1024 }) });
    expect(report.issues.some((i) => i.code === 'resources')).toBe(true);
  });

  it('surfaces role config problems', async () => {
    const report = await validateDeployment({
      ...base,
      config: config({ entries: [{ accountId: 'a1', role: 'HUNTER', instanceName: 'H', delayMs: 0, roleConfig: { authorizedCombat: false } }] }),
    });
    expect(report.issues.some((i) => i.code.startsWith('role-'))).toBe(true);
  });
});
