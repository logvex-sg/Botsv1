/**
 * Settings.
 *
 * Grouped, plain-language settings with tooltips. Only the essentials are shown by default; the
 * technical options live behind an Advanced section. A Restore Defaults button returns everything
 * to a known-good state, and every change is explained in a sentence rather than a code name.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Callout, Card, ConfirmDialog, Expandable, Field, Pill, Segmented, Tip } from '../components/ui';
import { DEFAULT_SETTINGS, type AppSettings, type UiMode } from '../../shared/types';
import { toFriendlyError } from '../lib/errors';

interface Props {
  push: (message: string, tone?: string) => void;
  uiMode: UiMode;
}

export function SettingsPage({ push, uiMode }: Props) {
  const store = useStore();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [token, setToken] = useState('');
  const [revealToken, setRevealToken] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (store.settings) setDraft(store.settings);
  }, [store.settings]);

  useEffect(() => {
    void fleet.getApiToken().then(setToken).catch(() => setToken(''));
  }, []);

  const save = async (): Promise<void> => {
    if (!draft) return;
    setError(null);
    try {
      await fleet.saveSettings(draft);
      push('Settings saved', 'success');
      await store.refresh();
    } catch (err) {
      const friendly = toFriendlyError(err);
      setError(friendly.title);
      push(friendly.title, 'error');
    }
  };

  const regenerate = async (): Promise<void> => {
    setConfirmRegen(false);
    const next = await fleet.regenerateApiToken();
    setToken(next);
    setRevealToken(true);
    push('New connection key generated', 'success');
  };

  const restoreDefaults = async (): Promise<void> => {
    setConfirmReset(false);
    if (!draft) return;
    // Keep the user's Hunter link and theme; reset everything else to sensible defaults.
    const reset: AppSettings = {
      ...DEFAULT_SETTINGS,
      theme: draft.theme,
      uiMode: draft.uiMode,
      hunterAddonUrl: draft.hunterAddonUrl,
      hunterAddonToken: draft.hunterAddonToken,
    };
    setDraft(reset);
    await fleet.saveSettings(reset);
    await store.refresh();
    push('Settings restored to defaults', 'success');
  };

  const exportConfig = async (): Promise<void> => {
    const result = await fleet.exportConfig();
    push(`Exported configuration to ${result.path}`, 'success');
  };

  const importConfig = async (): Promise<void> => {
    try {
      const result = await fleet.importConfig();
      if (result) {
        push(`Imported ${result.imported} records`, 'success');
        await store.refresh();
      }
    } catch (err) {
      push(toFriendlyError(err).title, 'error');
    }
  };

  const backup = async (): Promise<void> => {
    const result = await fleet.backupDatabase();
    if (result) push(`Backup saved to ${result.path}`, 'success');
  };

  if (!draft) return <div className="empty">Loading settings…</div>;

  return (
    <div className="col" style={{ gap: 16 }}>
      {error && <Callout tone="error" title={error} />}

      {/* Everyday settings first */}
      <div className="grid cols-2">
        <Card title="Appearance" sub="How the app looks and how much it shows.">
          <Field label="Mode">
            <Segmented<UiMode>
              value={draft.uiMode}
              onChange={(mode) => setDraft({ ...draft, uiMode: mode })}
              options={[{ value: 'beginner', label: 'Beginner' }, { value: 'advanced', label: 'Advanced' }]}
            />
            <span className="hint">
              {draft.uiMode === 'beginner'
                ? 'Simple screens, fewer options, plain language.'
                : 'Every option, including deployment queues and role configuration.'}
            </span>
          </Field>
          <Field label="Theme">
            <Segmented<'dark' | 'light'>
              value={draft.theme}
              onChange={(theme) => setDraft({ ...draft, theme })}
              options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
            />
          </Field>
        </Card>

        <Card title="Notifications" sub="What the app tells you about.">
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={draft.notify} onChange={(e) => setDraft({ ...draft, notify: e.target.checked })} />
            <span className="card-sub">Show notifications for warnings and errors</span>
            <Tip text="Important problems (a bot failed, a connection dropped) appear as a message so you do not have to watch the screen." />
          </label>
          <label className="row" style={{ gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={draft.autosave} onChange={(e) => setDraft({ ...draft, autosave: e.target.checked })} />
            <span className="card-sub">Save changes automatically</span>
            <Tip text="When on, edits are stored as soon as you make them instead of waiting for a Save button." />
          </label>
        </Card>
      </div>

      <Card title="Logvex Hunter link" sub="Connect the Hunter addon to share targets and see combat events.">
        <div className="grid cols-2">
          <Field label="Companion address" hint="Where the Hunter addon is listening. The default is correct for a local game.">
            <input type="text" value={draft.hunterAddonUrl} onChange={(e) => setDraft({ ...draft, hunterAddonUrl: e.target.value })} placeholder="http://127.0.0.1:8720" />
          </Field>
          <Field label="Companion key" hint="The key shown by the addon in-game. Leave blank if the addon does not use one.">
            <input type="password" value={draft.hunterAddonToken} onChange={(e) => setDraft({ ...draft, hunterAddonToken: e.target.value })} />
          </Field>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Pill tone={store.hunterConnected ? 'success' : 'muted'}>{store.hunterConnected ? 'connected' : 'not connected'}</Pill>
          <Button small onClick={async () => {
            const s = await fleet.hunterStatus();
            push(s.connected ? 'Hunter is reachable' : 'Hunter could not be reached', s.connected ? 'success' : 'error');
          }}>Test connection</Button>
        </div>
      </Card>

      <div className="row" style={{ gap: 10 }}>
        <Button variant="primary" onClick={save}>Save settings</Button>
        <Button onClick={() => setConfirmReset(true)}>Restore defaults</Button>
      </div>

      {/* Advanced options are hidden unless the user asks for them. */}
      {(uiMode === 'advanced' || draft.apiEnabled !== DEFAULT_SETTINGS.apiEnabled) && (
        <Expandable title="Advanced" defaultOpen={uiMode === 'advanced'}>
          <Card title="Local connection" sub="How other tools on this computer talk to the app.">
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={draft.apiEnabled} onChange={(e) => setDraft({ ...draft, apiEnabled: e.target.checked })} />
              <span className="card-sub">Allow other tools to connect</span>
            </label>
            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <Field label="Address">
                <input type="text" value={draft.apiHost} onChange={(e) => setDraft({ ...draft, apiHost: e.target.value })} />
              </Field>
              <Field label="Port">
                <input type="number" value={draft.apiPort} onChange={(e) => setDraft({ ...draft, apiPort: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Connection key" hint="Used like a password by the Hunter addon. It never leaves this computer.">
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="text"
                  value={revealToken ? token : '•'.repeat(Math.min(32, token.length))}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button small onClick={() => setRevealToken((v) => !v)}>{revealToken ? 'Hide' : 'Show'}</Button>
                <Button small onClick={() => setConfirmRegen(true)}>New key</Button>
              </div>
            </Field>
          </Card>

          <Card title="Performance & maintenance" sub="Fine tuning — the defaults work well for most people.">
            <div className="grid cols-3">
              <Field label="Max memory (MB)">
                <input type="number" value={draft.maxMemoryMb} onChange={(e) => setDraft({ ...draft, maxMemoryMb: Number(e.target.value) })} />
              </Field>
              <Field label="Backup every (minutes)">
                <input type="number" value={draft.backupIntervalMinutes} onChange={(e) => setDraft({ ...draft, backupIntervalMinutes: Number(e.target.value) })} />
              </Field>
              <Field label="Log level">
                <select value={draft.logLevel} onChange={(e) => setDraft({ ...draft, logLevel: e.target.value as never })}>
                  <option value="debug">Debug (verbose)</option>
                  <option value="info">Info</option>
                  <option value="warn">Warnings</option>
                  <option value="error">Errors only</option>
                </select>
              </Field>
            </div>
          </Card>

          <Card title="Backup & transfer" sub="Export or import your configuration. Passwords are never included.">
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <Button onClick={exportConfig}>Export configuration</Button>
              <Button onClick={importConfig}>Import configuration</Button>
              <Button onClick={backup}>Back up database</Button>
            </div>
          </Card>
        </Expandable>
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Restore default settings?"
          confirmLabel="Restore defaults"
          message="Your connection key, saved accounts, servers and bots are not touched. Only the options on this page return to their defaults."
          onCancel={() => setConfirmReset(false)}
          onConfirm={restoreDefaults}
        />
      )}

      {confirmRegen && (
        <ConfirmDialog
          title="Generate a new connection key?"
          danger
          confirmLabel="Generate new key"
          message="Any tool already connected with the old key will be disconnected until you update it with the new one."
          onCancel={() => setConfirmRegen(false)}
          onConfirm={regenerate}
        />
      )}
    </div>
  );
}
