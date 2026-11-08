/**
 * Pre-deployment validation.
 *
 * Pure function: given a deployment configuration and the current world state, it produces a
 * report of errors (which block deployment) and warnings (which do not). Keeping it pure makes it
 * straightforward to unit-test every rule.
 */
import type {
  Account,
  BotRole,
  DeploymentConfig,
  InstanceRecord,
  ServerProfile,
  ValidationIssue,
  ValidationReport,
} from '../../../shared/types';
import type { RoleConfigIssue } from '../roles/roles';

export interface DeploymentValidationInput {
  config: DeploymentConfig;
  accounts: Account[];
  servers: ServerProfile[];
  instances: InstanceRecord[];
  hasCredential: (accountId: string) => Promise<boolean>;
  validateRole: (role: BotRole, config: Record<string, unknown>) => RoleConfigIssue[];
  /** When true, API availability is checked; defaults to true. */
  apiAvailable?: boolean;
}

export async function validateDeployment(input: DeploymentValidationInput): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const { config } = input;

  if (!config.name || config.name.trim().length === 0) {
    issues.push({ level: 'error', code: 'name', message: 'Deployment name is required.' });
  }
  if (!config.entries || config.entries.length === 0) {
    issues.push({ level: 'error', code: 'empty', message: 'Select at least one account to deploy.' });
  }

  if (!config.serverProfileId) {
    issues.push({ level: 'error', code: 'server', message: 'A server profile must be selected.' });
  } else if (!input.servers.some((s) => s.id === config.serverProfileId)) {
    issues.push({ level: 'error', code: 'server-missing', message: 'The selected server profile no longer exists.' });
  }

  if (config.maxConcurrent < 1) {
    issues.push({ level: 'error', code: 'concurrency', message: 'Maximum concurrency must be at least 1.' });
  }
  if (config.connectionTimeoutMs < 1000) {
    issues.push({ level: 'warning', code: 'timeout', message: 'Connection timeout below 1s may cause false failures.' });
  }
  if (config.resourceLimitMb > 0 && config.entries.length * 256 > config.resourceLimitMb) {
    issues.push({
      level: 'warning',
      code: 'resources',
      message: `Estimated memory (${config.entries.length * 256} MB) exceeds the configured limit of ${config.resourceLimitMb} MB.`,
    });
  }

  const instanceNames = new Set<string>();
  for (const entry of config.entries ?? []) {
    const account = input.accounts.find((a) => a.id === entry.accountId);
    if (!account) {
      issues.push({ level: 'error', code: 'account-missing', message: `Account for "${entry.instanceName}" was not found.`, subject: entry.instanceName });
      continue;
    }
    if (account.authMode !== 'offline' && !(await input.hasCredential(account.id))) {
      issues.push({ level: 'error', code: 'credential', message: `No stored credential for ${account.username}.`, subject: entry.instanceName });
    }
    if (instanceNames.has(entry.instanceName)) {
      issues.push({ level: 'error', code: 'duplicate-name', message: `Duplicate instance name "${entry.instanceName}".`, subject: entry.instanceName });
    }
    instanceNames.add(entry.instanceName);

    const roleIssues = input.validateRole(entry.role, entry.roleConfig ?? {});
    for (const issue of roleIssues) {
      issues.push({
        level: 'error',
        code: `role-${issue.field}`,
        message: `${entry.role}: ${issue.message}`,
        subject: entry.instanceName,
      });
    }

    const existing = input.instances.find((i) => i.name === entry.instanceName);
    if (existing && existing.state === 'RUNNING') {
      issues.push({ level: 'warning', code: 'already-running', message: `"${entry.instanceName}" is already running.`, subject: entry.instanceName });
    }
  }

  if (input.apiAvailable === false) {
    issues.push({ level: 'error', code: 'api', message: 'The local API is not available.' });
  }

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, issues };
}

/** Synchronous variant used by the UI before credentials are known (optimistic). */
export function validateDeploymentSync(input: Omit<DeploymentValidationInput, 'hasCredential'> & { credentials: Record<string, boolean> }): ValidationReport {
  const issues: ValidationIssue[] = [];
  const { config } = input;
  if (!config.entries || config.entries.length === 0) {
    issues.push({ level: 'error', code: 'empty', message: 'Select at least one account to deploy.' });
  }
  for (const entry of config.entries ?? []) {
    const account = input.accounts.find((a) => a.id === entry.accountId);
    if (!account) continue;
    if (account.authMode !== 'offline' && input.credentials[account.id] === false) {
      issues.push({ level: 'error', code: 'credential', message: `No stored credential for ${account.username}.` });
    }
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}
