/**
 * Automation rules tab.
 *
 * A rule is WHEN an event happens AND its conditions hold THEN a task runs. Conditions are a small,
 * fixed set of comparisons — there is no scripting language — so a rule an operator writes can only
 * ever dispatch a task, never run arbitrary code.
 */
import { useEffect, useState } from 'react';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import { relativeTime } from '../../lib/format';
import type { AutomationRule, RuleCondition } from '../../../shared/types';
import { useCollection } from './MultiversePage';

interface Props {
  push: (message: string, tone?: string) => void;
}

const OPERATORS: RuleCondition['operator'][] = ['eq', 'neq', 'contains', 'gt', 'lt'];

/** The events a rule can listen for. Kept in step with the Host's event names. */
const EVENTS = [
  'WORKER_REGISTERED', 'WORKER_DISCONNECTED', 'WORKER_INVENTORY', 'WORKER_STATUS',
  'WORKER_TASK_FINISHED', 'WORKER_TASK_FAILED', 'WORKER_PAIRED', 'WORKER_CONTROL',
  'SCHEDULE_FIRED', 'SERVER_PROFILE_CHANGED',
];

export function RulesTab({ push }: Props) {
  const { items: rules, loading, error, reload } = useCollection(() => fleet.listRules());
  const [kinds, setKinds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [removing, setRemoving] = useState<AutomationRule | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fleet.getWorkerTaskKinds().then(setKinds).catch(() => setKinds([]));
  }, []);

  const guarded = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await reload();
      push(success);
    } catch (err) {
      const friendly = toFriendlyError(err);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (rule: AutomationRule): Promise<void> =>
    guarded(() => fleet.updateRule(rule.id, { enabled: !rule.enabled }), rule.enabled ? 'Rule disabled' : 'Rule enabled');

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Automation rules"
        sub={`${rules.length} rule(s) · evaluated on every Host event`}
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New rule</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load rules">{error}</Callout>}
        {!loading && rules.length === 0 && (
          <Empty>No rules yet. A rule reacts to a Host event and dispatches a task, with no code to write.</Empty>
        )}

        {rules.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>When</th>
                <th>Then</th>
                <th>Cooldown</th>
                <th>Runs</th>
                <th>Last fired</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} style={rule.enabled ? undefined : { opacity: 0.6 }}>
                  <td style={{ fontWeight: 600 }}>{rule.name}</td>
                  <td>
                    <div className="col" style={{ gap: 2 }}>
                      <Pill tone="info">{rule.event}</Pill>
                      {rule.conditions.length > 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                          {rule.conditions.map((c) => `${c.field} ${c.operator} ${c.value}`).join(' and ')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td><Pill tone="muted">{rule.action}</Pill></td>
                  <td>{rule.cooldownMs > 0 ? `${Math.round(rule.cooldownMs / 1000)}s` : '—'}</td>
                  <td>{rule.runCount}{rule.maxRuns !== null ? ` / ${rule.maxRuns}` : ''}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{rule.lastRunAt ? relativeTime(rule.lastRunAt) : 'never'}</td>
                  <td>
                    <Button small variant={rule.enabled ? 'default' : 'ghost'} onClick={() => void toggle(rule)}>
                      {rule.enabled ? 'On' : 'Off'}
                    </Button>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small variant="ghost" onClick={() => setEditing(rule)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => setRemoving(rule)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Callout tone="info" title="Rules act on the worker the event came from">
        A rule with no explicit targets dispatches its task to the worker whose event triggered it —
        for example, an inventory sweep when a client joins. Conditions are plain comparisons, so
        there is nothing to escape and nothing that can run outside the task system.
      </Callout>

      {(creating || editing) && (
        <RuleModal
          rule={editing}
          kinds={kinds}
          busy={busy}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (input) => {
            const target = editing;
            await guarded(
              async () => (target ? fleet.updateRule(target.id, input) : fleet.createRule(input)),
              target ? 'Rule updated' : 'Rule created',
            );
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete “${removing.name}”?`}
          danger
          confirmLabel="Delete rule"
          message="The rule is removed and will not fire again. Nothing it already dispatched is affected."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const rule = removing;
            setRemoving(null);
            await guarded(() => fleet.deleteRule(rule.id), 'Rule deleted');
          }}
        />
      )}
    </div>
  );
}

function RuleModal({
  rule, kinds, busy, onClose, onSubmit,
}: {
  rule: AutomationRule | null;
  kinds: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string; event: string; conditions: RuleCondition[]; action: string;
    cooldownMs: number; maxRuns: number | null; enabled: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(rule?.name ?? '');
  const [event, setEvent] = useState(rule?.event ?? EVENTS[0]);
  const [action, setAction] = useState(rule?.action ?? kinds[0] ?? 'inventory');
  const [conditions, setConditions] = useState<RuleCondition[]>(rule?.conditions ?? []);
  const [cooldownSeconds, setCooldownSeconds] = useState(String(rule?.cooldownMs ? Math.round(rule.cooldownMs / 1000) : 0));
  const [maxRuns, setMaxRuns] = useState(rule?.maxRuns !== null && rule?.maxRuns !== undefined ? String(rule.maxRuns) : '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const updateCondition = (index: number, patch: Partial<RuleCondition>): void => {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  return (
    <Modal
      title={rule ? `Edit ${rule.name}` : 'New automation rule'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || name.trim().length === 0}
            onClick={() => void onSubmit({
              name: name.trim(),
              event,
              action,
              conditions,
              cooldownMs: (Number.parseInt(cooldownSeconds, 10) || 0) * 1000,
              maxRuns: maxRuns.trim() === '' ? null : Number.parseInt(maxRuns, 10),
              enabled,
            })}
          >
            {rule ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Inventory on join" autoFocus />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="When this event happens">
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              {EVENTS.map((evt) => <option key={evt} value={evt}>{evt}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Then run this task">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <Field label="Conditions" hint="All conditions must hold. Fields read from the event payload.">
        <div className="col" style={{ gap: 8 }}>
          {conditions.map((condition, index) => (
            <div key={index} className="row" style={{ gap: 8 }}>
              <input
                value={condition.field}
                onChange={(e) => updateCondition(index, { field: e.target.value })}
                placeholder="field"
                style={{ flex: 2 }}
              />
              <select value={condition.operator} onChange={(e) => updateCondition(index, { operator: e.target.value as RuleCondition['operator'] })}>
                {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
              <input
                value={condition.value}
                onChange={(e) => updateCondition(index, { value: e.target.value })}
                placeholder="value"
                style={{ flex: 2 }}
              />
              <Button small variant="ghost" onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}>✕</Button>
            </div>
          ))}
          <Button small onClick={() => setConditions((prev) => [...prev, { field: '', operator: 'eq', value: '' }])}>
            Add condition
          </Button>
        </div>
      </Field>

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Cooldown (seconds)" hint="Minimum gap between runs of this rule.">
            <input value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Max runs" hint="Blank for unlimited.">
            <input value={maxRuns} onChange={(e) => setMaxRuns(e.target.value.replace(/[^0-9]/g, ''))} placeholder="unlimited" />
          </Field>
        </div>
      </div>

      <Field label="Enabled">
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Fire while the Host is open</span>
        </label>
      </Field>
    </Modal>
  );
}
