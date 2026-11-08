/**
 * Account manager.
 *
 * Owns the account CRUD surface, duplicate detection, credential lifecycle and login bookkeeping.
 * Credentials live only in the {@link CredentialVault}; the rest of the application only ever sees
 * a boolean `hasCredential` flag. Nothing here logs or returns a secret.
 */
import type { AccountRepository } from '../../db/repositories';
import type { CredentialVault } from '../../security/credential-vault';
import type { Account, AuthMode, BotRole } from '../../../shared/types';

export interface AccountInput {
  username: string;
  displayName?: string;
  authMode?: AuthMode;
  role?: BotRole;
  groupId?: string | null;
  serverProfileId?: string | null;
  notes?: string;
}

export interface AccountView extends Account {
  /** True when the account's credentials are present and the account is deployable. */
  deployable: boolean;
  /** Human-readable reason the account cannot be deployed, if any. */
  blockedReason: string | null;
}

export class DuplicateAccountError extends Error {
  constructor(username: string) {
    super(`An account named "${username}" already exists.`);
    this.name = 'DuplicateAccountError';
  }
}

export class AccountManager {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly vault: CredentialVault,
  ) {}

  list(): Account[] {
    return this.accounts.list();
  }

  /** Accounts enriched with credential availability for the UI. */
  async listWithStatus(): Promise<AccountView[]> {
    const accounts = this.accounts.list();
    const out: AccountView[] = [];
    for (const account of accounts) {
      out.push(await this.decorate(account));
    }
    return out;
  }

  private async decorate(account: Account): Promise<AccountView> {
    const hasCredential = await this.vault.has(account.id);
    let blockedReason: string | null = null;
    if (account.authMode !== 'offline' && !hasCredential) {
      blockedReason = 'No stored credential. Add one before deploying.';
    }
    return { ...account, hasCredential, deployable: blockedReason == null, blockedReason };
  }

  async create(input: AccountInput): Promise<AccountView> {
    const username = input.username?.trim();
    if (!username) throw new Error('Username is required.');
    if (this.accounts.findByUsername(username)) throw new DuplicateAccountError(username);
    const account = this.accounts.create({
      username,
      displayName: input.displayName ?? username,
      authMode: input.authMode ?? 'offline',
      role: input.role ?? 'HUNTER',
      groupId: input.groupId ?? null,
      lastLogin: null,
      lastLoginOk: false,
      serverProfileId: input.serverProfileId ?? null,
      notes: input.notes ?? '',
    });
    return this.decorate(account);
  }

  async update(id: string, patch: Partial<AccountInput>): Promise<AccountView | undefined> {
    const existing = this.accounts.get(id);
    if (!existing) return undefined;
    if (patch.username && patch.username.trim().toLowerCase() !== existing.username.toLowerCase()) {
      const clash = this.accounts.findByUsername(patch.username);
      if (clash && clash.id !== id) throw new DuplicateAccountError(patch.username);
    }
    const updated = this.accounts.update(id, patch as Partial<Account>);
    return updated ? this.decorate(updated) : undefined;
  }

  async remove(id: string): Promise<boolean> {
    await this.vault.delete(id);
    return this.accounts.remove(id);
  }

  /** Stores a credential. The secret never leaves the vault. */
  async setCredential(id: string, secret: string): Promise<void> {
    if (!this.accounts.get(id)) throw new Error('Account not found.');
    if (!secret || secret.length === 0) throw new Error('Credential must not be empty.');
    await this.vault.set(id, secret);
  }

  async clearCredential(id: string): Promise<void> {
    await this.vault.delete(id);
  }

  async hasCredential(id: string): Promise<boolean> {
    return this.vault.has(id);
  }

  /** Used by the login manager; never exposed over IPC. */
  async revealCredential(id: string): Promise<string | null> {
    return this.vault.get(id);
  }

  async markLogin(id: string, ok: boolean): Promise<void> {
    this.accounts.markLogin(id, ok);
  }

  /** Detects duplicates for a candidate username without creating anything. */
  findDuplicate(username: string): Account | undefined {
    return this.accounts.findByUsername(username);
  }
}
