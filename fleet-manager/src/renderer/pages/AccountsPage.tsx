/**
 * Account Manager page.
 *
 * Create/edit accounts, store credentials in the OS vault, assign roles and groups, and log in.
 * Credentials are entered once and stored; the page only ever shows whether one exists.
 */
import { useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Empty, Field, Modal, Pill, RolePill, Dot } from '../components/ui';
import { relativeTime } from '../lib/format';
import { toFriendlyError } from '../lib/errors';
import { BOT_ROLES, type Account, type AuthMode, type BotRole } from '../../shared/types';
import type { AccountView } from '../../main/services/accounts/account-manager';

interface Props { push: (message: string, tone?: string) => void }

const blank = (): Partial<Account> => ({
  username: '', displayName: '', authMode: 'offline', role: 'HUNTER', notes: '',
});

export function AccountsPage({ push }: Props) {
  const store = useStore();
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const [credentialFor, setCredentialFor] = useState<AccountView | null>(null);
  const [secret, setSecret] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<BotRole | 'ALL'>('ALL');

  const filtered = store.accounts.filter((account) => {
    if (roleFilter !== 'ALL' && account.role !== roleFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return account.username.toLowerCase().includes(q) || account.displayName.toLowerCase().includes(q);
  });

  const save = async (): Promise<void> => {
    if (!editing) return;
    try {
      if (editing.id) {
        await fleet.updateAccount(editing.id, editing);
        push(`Updated ${editing.username}`, 'success');
      } else {
        await fleet.createAccount(editing);
        push(`Created ${editing.username}`, 'success');
      }
      setEditing(null);
      await store.refreshAccounts();
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    }
  };

  const remove = async (account: AccountView): Promise<void> => {
    if (!confirm(`Delete account "${account.username}"? Its stored credential will also be removed.`)) return;
    await fleet.deleteAccount(account.id);
    push(`Deleted ${account.username}`);
    await store.refreshAccounts();
  };

  const login = async (account: AccountView): Promise<void> => {
    const result = await fleet.loginAccount(account.id);
    if (result.ok) push(`Login prepared for ${account.username}`, 'success');
    else push(result.error ?? 'Login failed', 'error');
    await store.refreshAccounts();
  };

  const saveCredential = async (): Promise<void> => {
    if (!credentialFor) return;
    try {
      await fleet.setCredential(credentialFor.id, secret);
      setSecret('');
      setCredentialFor(null);
      push(`Credential stored for ${credentialFor.username}`, 'success');
      await store.refreshAccounts();
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Accounts"
        sub="Each bot uses its own account profile and credential."
        actions={<Button variant="primary" onClick={() => setEditing(blank())}>+ New account</Button>}
      >
        <div className="row" style={{ marginBottom: 14 }}>
          <input type="text" placeholder="Search accounts…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as BotRole | 'ALL')} style={{ maxWidth: 160 }}>
            <option value="ALL">All roles</option>
            {BOT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <div className="spacer" />
          <span className="card-sub">{filtered.length} of {store.accounts.length}</span>
        </div>

        {filtered.length === 0 ? (
          <Empty>No accounts match. Create one to get started.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Status</th><th>Username</th><th>Role</th><th>Auth</th>
                <th>Credential</th><th>Last login</th><th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((account) => (
                <tr key={account.id}>
                  <td><Dot state={account.lastLoginOk ? 'ONLINE' : 'OFFLINE'} /></td>
                  <td>
                    <strong>{account.username}</strong>
                    {account.displayName && account.displayName !== account.username && (
                      <div className="card-sub" style={{ fontSize: 11 }}>{account.displayName}</div>
                    )}
                  </td>
                  <td><RolePill role={account.role} /></td>
                  <td><Pill tone="muted">{account.authMode}</Pill></td>
                  <td>
                    {account.authMode === 'offline'
                      ? <Pill tone="muted">not required</Pill>
                      : <Pill tone={account.hasCredential ? 'success' : 'error'}>{account.hasCredential ? 'stored' : 'missing'}</Pill>}
                  </td>
                  <td className="card-sub">{relativeTime(account.lastLogin)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <Button small onClick={() => login(account)}>Login</Button>
                      <Button small onClick={() => setCredentialFor(account)}>Credential</Button>
                      <Button small onClick={() => setEditing(account)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => remove(account)}>✕</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <Modal
          title={editing.id ? `Edit ${editing.username}` : 'New account'}
          onClose={() => setEditing(null)}
          footer={<>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save}>{editing.id ? 'Save' : 'Create'}</Button>
          </>}
        >
          <Field label="Minecraft username">
            <input type="text" value={editing.username ?? ''} onChange={(e) => setEditing({ ...editing, username: e.target.value })} />
          </Field>
          <Field label="Display name">
            <input type="text" value={editing.displayName ?? ''} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} />
          </Field>
          <Field label="Authentication mode" hint="Offline mode only works on servers configured to allow it.">
            <select value={editing.authMode} onChange={(e) => setEditing({ ...editing, authMode: e.target.value as AuthMode })}>
              <option value="offline">Offline</option>
              <option value="microsoft">Microsoft</option>
            </select>
          </Field>
          <Field label="Assigned role">
            <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as BotRole })}>
              {BOT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </Field>
          <Field label="Notes">
            <textarea value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      {credentialFor && (
        <Modal
          title={`Credential for ${credentialFor.username}`}
          onClose={() => { setCredentialFor(null); setSecret(''); }}
          footer={<>
            <Button onClick={() => { setCredentialFor(null); setSecret(''); }}>Cancel</Button>
            <Button variant="primary" onClick={saveCredential} disabled={secret.length === 0}>Store</Button>
          </>}
        >
          <p className="card-sub" style={{ marginBottom: 14 }}>
            Stored securely in the operating-system credential vault. It is never written to disk in
            plaintext and never displayed again after saving.
          </p>
          <Field label="Secret / access token">
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  );
}
