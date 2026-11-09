/**
 * Shared pieces for the worker pages.
 *
 * Every worker surface needs the same three things: a status chip that distinguishes "online now"
 * from "last seen a while ago", a freshness stamp for reported inventory, and a colour for a group.
 * Keeping them here means the wording is identical everywhere, which matters because the whole
 * point of these screens is that the operator can trust what they say.
 */
import type { WorkerView } from '../../../shared/types';
import { Dot, Pill } from '../../components/ui';
import { relativeTime } from '../../lib/format';

export function workerTitle(worker: WorkerView): string {
  return worker.label || worker.username || worker.id;
}

/** The word shown for a worker's derived status, so every screen says the same thing. */
export function statusLabel(worker: WorkerView): string {
  switch (worker.status) {
    case 'ONLINE':
      return 'Online';
    case 'BUSY':
      return 'Working';
    case 'UNRESPONSIVE':
      return 'Unresponsive';
    case 'DEGRADED':
      return worker.stopped ? 'Stopped' : 'Paused';
    case 'OFFLINE':
    default:
      return 'Offline';
  }
}

export function statusTone(worker: WorkerView): string {
  switch (worker.status) {
    case 'ONLINE':
      return 'online';
    case 'BUSY':
      return 'accent';
    case 'UNRESPONSIVE':
    case 'DEGRADED':
      return 'warning';
    default:
      return 'muted';
  }
}

export function StatusChip({ worker }: { worker: WorkerView }) {
  const dot = worker.status === 'ONLINE'
    ? 'ONLINE'
    : worker.status === 'OFFLINE'
      ? 'OFFLINE'
      : worker.status === 'BUSY'
        ? 'ONLINE'
        : 'ERROR';
  return (
    <span className="row" style={{ gap: 6 }}>
      <Dot state={dot} />
      <Pill tone={statusTone(worker)}>{statusLabel(worker)}</Pill>
    </span>
  );
}

/**
 * How old a reported inventory is.
 *
 * Always shown next to a count: the host never has a live view of another client's inventory, only
 * the last snapshot it was sent, and a number without its age would be misleading.
 */
export function Freshness({ capturedAt }: { capturedAt: number }) {
  if (!capturedAt) return <span style={{ color: 'var(--text-dim)' }}>never reported</span>;
  const ageMs = Date.now() - capturedAt;
  const stale = ageMs > 60_000;
  return (
    <span style={{ color: stale ? 'var(--warning)' : 'var(--text-dim)' }} title={new Date(capturedAt).toLocaleString()}>
      {relativeTime(capturedAt)}
      {stale ? ' · stale' : ''}
    </span>
  );
}

export function groupColor(color: string | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : 'var(--accent)';
}

export function GroupChip({ name, color }: { name: string; color?: string }) {
  return (
    <span className="pill" style={{ borderColor: groupColor(color), color: groupColor(color) }}>
      {name}
    </span>
  );
}

/** Turns "minecraft:diamond_sword" into "Diamond Sword" when no display name is available. */
export function prettyId(id: string): string {
  if (!id) return '';
  const path = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  return path
    .split('_')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}
