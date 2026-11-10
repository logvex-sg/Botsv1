/**
 * Containers tab.
 *
 * Containers are tracked separately from player inventories: a chest a worker inspected is a place,
 * not a player's carried items. Each row shows where it is and when it was last seen.
 */
import { Fragment, useState } from 'react';
import { fleet } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Button, Callout, Card, ConfirmDialog, Empty, Pill } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import { relativeTime } from '../../lib/format';
import type { ContainerRecord } from '../../../shared/types';
import { useCollection } from './MultiversePage';

interface Props {
  push: (message: string, tone?: string) => void;
}

export function ContainersTab({ push }: Props) {
  const store = useStore();
  const { items: containers, loading, error, reload } = useCollection(() => fleet.listContainers());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ContainerRecord | null>(null);

  const workerName = (workerId: string): string => {
    const worker = store.workers.find((w) => w.id === workerId);
    return worker ? worker.label || worker.username || workerId : workerId;
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Container records" sub={`${containers.length} container(s) inspected`}>
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load containers">{error}</Callout>}
        {!loading && containers.length === 0 && (
          <Empty>No containers recorded yet. They appear here when a worker inspects a chest or other container.</Empty>
        )}

        {containers.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Container</th>
                <th>Worker</th>
                <th>Position</th>
                <th>Items</th>
                <th>Last inspected</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {containers.map((container) => (
                <Fragment key={container.id}>
                  <tr>
                    <td style={{ fontWeight: 600 }}>{container.label || 'Container'}</td>
                    <td>{workerName(container.workerId)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {container.x}, {container.y}, {container.z}
                      <span style={{ color: 'var(--text-dim)' }}> · {container.dimension.replace('minecraft:', '')}</span>
                    </td>
                    <td>{container.items.length}</td>
                    <td style={{ color: 'var(--text-dim)' }}>{relativeTime(container.inspectedAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <Button small variant="ghost" onClick={() => setExpanded(expanded === container.id ? null : container.id)}>
                          {expanded === container.id ? 'Hide' : 'Items'}
                        </Button>
                        <Button small variant="ghost" onClick={() => setRemoving(container)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                  {expanded === container.id && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--bg-hover)' }}>
                        {container.items.length === 0
                          ? <span style={{ color: 'var(--text-dim)' }}>The container was empty when inspected.</span>
                          : <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                              {container.items.map((item, index) => (
                                <Pill key={`${item.id}-${index}`} tone="muted">{item.name || item.id} × {item.count}</Pill>
                              ))}
                            </div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Callout tone="info" title="Container records are places, not inventories">
        A container is recorded by position, so re-inspecting the same chest updates the one row
        rather than adding another. This is separate from the reported inventory of a player.
      </Callout>

      {removing && (
        <ConfirmDialog
          title="Delete this container record?"
          danger
          confirmLabel="Delete record"
          message="The record is removed from the Host's database only. Nothing is changed in the world."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const container = removing;
            setRemoving(null);
            try {
              await fleet.deleteContainer(container.id);
              await reload();
              push('Container record deleted');
            } catch (err) {
              const friendly = toFriendlyError(err);
              push(`${friendly.title} — ${friendly.hint}`, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
