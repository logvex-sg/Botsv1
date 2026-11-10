/**
 * Audit trail tab.
 *
 * Every mutating action the Host takes — creating a profile, running a preset, firing a rule — is
 * recorded with an actor, a target and a plain-language detail. The trail is append-only and is the
 * answer to "what changed and when".
 */
import { useState } from 'react';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, Empty, Pill } from '../../components/ui';
import { formatDateTime, relativeTime } from '../../lib/format';
import type { AuditEntry } from '../../../shared/types';
import { useCollection } from './MultiversePage';

interface Props {
  push: (message: string, tone?: string) => void;
}

const TONE = (action: string): string =>
  action.includes('delete') ? 'error'
    : action.includes('create') ? 'success'
      : action.includes('run') || action.includes('fire') ? 'info'
        : 'muted';

export function AuditTab({ push }: Props) {
  const [limit, setLimit] = useState(200);
  const { items: entries, loading, error, reload } = useCollection(() => fleet.listAudit(limit), [limit]);
  const [filter, setFilter] = useState('');

  const visible = filter.trim().length === 0
    ? entries
    : entries.filter((entry) =>
        [entry.action, entry.target, entry.detail, entry.actor].some((field) =>
          field.toLowerCase().includes(filter.trim().toLowerCase())));

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Audit trail"
        sub={`${visible.length} of ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
        actions={
          <>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              style={{ width: 180 }}
            />
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={100}>Last 100</option>
              <option value={200}>Last 200</option>
              <option value={500}>Last 500</option>
              <option value={1000}>Last 1000</option>
            </select>
            <Button small onClick={() => { void reload(); push('Audit trail reloaded'); }}>Reload</Button>
          </>
        }
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load the audit trail">{error}</Callout>}
        {!loading && visible.length === 0 && (
          <Empty>{entries.length === 0 ? 'No actions recorded yet.' : 'Nothing matches that filter.'}</Empty>
        )}

        {visible.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id}>
                  <td title={formatDateTime(entry.at)} style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {relativeTime(entry.at)}
                  </td>
                  <td>{entry.actor}</td>
                  <td><Pill tone={TONE(entry.action)}>{entry.action}</Pill></td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{entry.target || '—'}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Callout tone="info" title="The trail is append-only">
        Entries are never edited or removed from the UI. If something changed on the fleet, it is
        here — including actions taken by automation rules, which record the rule as the actor.
      </Callout>
    </div>
  );
}
