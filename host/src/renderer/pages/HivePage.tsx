/**
 * HIVE MODE dashboard.
 *
 * The one place an operator sees and steers the whole swarm. It is a real interface over the real
 * coordinator: every button calls an IPC method that reaches {@link HiveService}, and every figure
 * comes from the coordinator's own state — there are no placeholder controls.
 *
 * The layout answers the questions an operator actually has, in order: is the hive on, who is in it,
 * where is everyone, what is each one doing, what has the swarm seen, and what did I just tell it.
 * The live map is a canvas that redraws on the coordinator's state, so a swarm of a dozen workers
 * still reads at a glance.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fleet } from '../lib/api';
import { toFriendlyError } from '../lib/errors';
import { Button, Callout, Card, Dot, Empty, Field, Modal, Pill, ProgressBar, Stat } from '../components/ui';
import type { HiveMapData, HiveOverview } from '../../main/hive/hive-service';
import type { HiveRole } from '../../main/packages/hive';

interface Props {
  push: (message: string, tone?: string) => void;
}

const ROLES: HiveRole[] = ['COMMANDER', 'ESCORT', 'SCOUT', 'BUILDER', 'MINER', 'LOGISTICS', 'STORAGE', 'GUARD', 'SUPPORT', 'GENERALIST'];
const FORMATIONS = ['follow', 'circle', 'line', 'diamond', 'escort', 'scatter'] as const;

const EXAMPLE_COMMANDS = [
  'Everyone follow me.',
  'Circle around me.',
  'Protect my position.',
  'Spread out around spawn.',
  'Scout the surrounding area.',
  'Send two Workers to explore the northern area.',
  'Have one Worker organize storage.',
  'Bring everyone back.',
  'Stop all tasks.',
];

export function HivePage({ push }: Props) {
  const [overview, setOverview] = useState<HiveOverview | null>(null);
  const [map, setMap] = useState<HiveMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [managing, setManaging] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [nextOverview, nextMap] = await Promise.all([fleet.hiveOverview(), fleet.hiveMap()]);
      setOverview(nextOverview);
      setMap(nextMap);
      setError(null);
    } catch (err) {
      setError(toFriendlyError(err).title);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [reload]);

  const run = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await reload();
      push(label);
    } catch (err) {
      push(toFriendlyError(err).title, 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitCommand = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const outcome = await fleet.hiveCommand(trimmed);
      await reload();
      push(outcome.message, outcome.accepted ? undefined : 'error');
      if (outcome.accepted) setInstruction('');
    } catch (err) {
      push(toFriendlyError(err).title, 'error');
    } finally {
      setBusy(false);
    }
  };

  const members = useMemo(() => {
    if (!overview) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return overview.members;
    return overview.members.filter(
      (member) =>
        member.label.toLowerCase().includes(needle) ||
        member.role.toLowerCase().includes(needle) ||
        member.workerId.toLowerCase().includes(needle),
    );
  }, [overview, filter]);

  if (loading && !overview) return <Empty>Reading the hive…</Empty>;
  if (error && !overview) return <Callout tone="error" title="Could not reach the hive coordinator">{error}</Callout>;
  if (!overview) return <Empty>No hive state.</Empty>;

  const enabled = overview.enabled;
  const commander = overview.members.find((member) => member.isCommander);

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* ---------------------------------------------------------- controls */}
      <Card
        title="HIVE MODE"
        sub={enabled ? 'The hive is coordinating. Workers share objectives, formation and what they see.' : 'The hive is idle. Enable it to begin coordinating the connected workers.'}
        actions={
          <div className="row" style={{ gap: 8 }}>
            {!enabled && <Button variant="primary" disabled={busy} onClick={() => void run('HIVE MODE enabled', () => fleet.hiveSetEnabled(true))}>Start hive</Button>}
            {enabled && <Button disabled={busy} onClick={() => void run('HIVE MODE disabled', () => fleet.hiveSetEnabled(false))}>Stop hive</Button>}
            <Button variant="danger" disabled={busy} onClick={() => void run('Emergency stop — all tasks cancelled', () => fleet.hiveEmergencyStop('dashboard'))}>Emergency stop</Button>
            <Button small onClick={() => void run('Hive state exported', () => fleet.hiveExport('json'))}>Export</Button>
          </div>
        }
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <Stat value={<span className="row" style={{ gap: 6 }}><Dot state={enabled ? 'ONLINE' : 'OFFLINE'} />{enabled ? 'Active' : 'Idle'}</span>} label="Hive status" />
          <Stat value={`${overview.online}/${overview.total}`} label="Members online" />
          <Stat value={overview.formation.kind} label="Formation" />
          <Stat value={overview.objectives.length} label="Objectives" />
          <Stat value={overview.exploration.percentComplete + '%'} label="Area explored" />
          <Stat value={overview.recentObservations.length} label="Observations" />
        </div>
        <div className="row between" style={{ marginTop: 14, gap: 12, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Formation</span>
            <select
              value={overview.formation.kind}
              disabled={busy}
              onChange={(e) => void run(`Formation set to ${e.target.value}`, () => fleet.hiveSetFormation({ kind: e.target.value as typeof FORMATIONS[number] }))}
            >
              {FORMATIONS.map((formation) => <option key={formation} value={formation}>{formation}</option>)}
            </select>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Commander</span>
            <span style={{ fontWeight: 600 }}>{commander ? commander.label : 'none elected'}</span>
            {commander && <Pill tone="success">{commander.role}</Pill>}
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------- command bar */}
      <Card
        title="Command the hive"
        sub="Type a plain instruction. The hive understands the phrasings listed below; anything else is refused rather than guessed at."
      >
        <div className="row" style={{ gap: 8 }}>
          <input
            style={{ flex: 1 }}
            value={instruction}
            placeholder="Everyone follow me."
            disabled={busy}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submitCommand(instruction); }}
          />
          <Button variant="primary" disabled={busy || !instruction.trim()} onClick={() => void submitCommand(instruction)}>Send</Button>
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {EXAMPLE_COMMANDS.map((example) => (
            <button key={example} className="pill muted" style={{ cursor: 'pointer' }} onClick={() => void submitCommand(example)}>{example}</button>
          ))}
        </div>
      </Card>

      <div className="grid cols-2" style={{ gap: 16 }}>
        {/* ---------------------------------------------------------- live map */}
        <Card title="Live map" sub="Worker positions, formation targets, explored sectors and shared sightings.">
          <HiveCanvas map={map} />
          <div className="row wrap" style={{ gap: 12, marginTop: 10, fontSize: 12, color: 'var(--text-dim)' }}>
            <Legend color="#f5c542" label="Commander" />
            <Legend color="#4fc3f7" label="Member" />
            <Legend color="rgba(129,199,132,0.25)" label="Explored sector" />
            <Legend color="rgba(229,115,115,0.9)" label="Player seen" />
          </div>
        </Card>

        {/* ---------------------------------------------------------- roster */}
        <Card
          title="Swarm roster"
          sub="Every worker the hive knows, with its role, health and current task."
          actions={<Button small onClick={() => setManaging(true)} disabled={overview.total === 0}>Assign roles</Button>}
        >
          <input
            value={filter}
            placeholder="Filter by name, id or role…"
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          {members.length === 0 && <Empty>No members match the filter.</Empty>}
          {members.length > 0 && (
            <table>
              <thead>
                <tr><th>Worker</th><th>Role</th><th>Status</th><th>Health</th><th>Task</th><th>Dist.</th></tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.workerId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{member.label}{member.isCommander && ' ★'}</div>
                      <div className="card-sub" style={{ fontSize: 11 }}>{member.workerId} · {member.dimension || 'unknown'}</div>
                    </td>
                    <td><Pill tone={member.role === 'COMMANDER' ? 'success' : 'info'}>{member.role}</Pill></td>
                    <td><span className="row" style={{ gap: 6 }}><Dot state={member.online ? 'ONLINE' : 'OFFLINE'} />{member.online ? (member.busy ? 'busy' : 'idle') : 'offline'}</span></td>
                    <td>
                      <div style={{ minWidth: 60 }}>{member.health}/{member.maxHealth}</div>
                      <ProgressBar value={(member.health / Math.max(1, member.maxHealth)) * 100} color={member.health <= 6 ? 'var(--error)' : 'var(--success)'} />
                    </td>
                    <td>{member.currentTask || <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                    <td>{member.distanceToCommander === null ? '—' : `${member.distanceToCommander}m`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid cols-2" style={{ gap: 16 }}>
        {/* ---------------------------------------------------------- objectives */}
        <Card title="Shared objectives" sub="One queue the whole swarm works from. Two workers never hold the same objective.">
          {overview.objectives.length === 0 && <Empty>No objectives. Give the hive a task or scout order.</Empty>}
          {overview.objectives.length > 0 && (
            <table>
              <thead>
                <tr><th>Objective</th><th>Kind</th><th>Holder</th><th>State</th><th>Progress</th></tr>
              </thead>
              <tbody>
                {overview.objectives.map((objective) => (
                  <tr key={objective.id}>
                    <td>{objective.label}</td>
                    <td><Pill tone="muted">{objective.kind}</Pill></td>
                    <td>{objective.assignedTo ?? <span style={{ color: 'var(--text-faint)' }}>unassigned</span>}</td>
                    <td><Pill tone={objective.state === 'done' ? 'success' : objective.state === 'assigned' ? 'info' : 'warning'}>{objective.state}</Pill></td>
                    <td><ProgressBar value={objective.progress * 100} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* ---------------------------------------------------------- shared intelligence */}
        <Card title="Shared intelligence" sub="What the swarm has seen, visible to every worker. Positions are what a worker reported from normal play, never a hidden one.">
          {overview.recentObservations.length === 0 && <Empty>Nothing reported yet. Scouts fill this in as they explore.</Empty>}
          {overview.recentObservations.length > 0 && (
            <table>
              <thead>
                <tr><th>Seen</th><th>Where</th><th>By</th><th>When</th></tr>
              </thead>
              <tbody>
                {overview.recentObservations.slice(0, 12).map((observation) => (
                  <tr key={observation.id}>
                    <td><Pill tone={observation.kind === 'player' ? 'warning' : 'muted'}>{observation.kind}</Pill> {observation.label}</td>
                    <td>{observation.x}, {observation.y}, {observation.z}</td>
                    <td>{observation.workerId}</td>
                    <td>{new Date(observation.at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* ---------------------------------------------------------- history */}
      <Card title="Command history" sub="Every instruction the hive received, and whether it acted on it.">
        {overview.commands.length === 0 && <Empty>No commands yet.</Empty>}
        {overview.commands.length > 0 && (
          <table>
            <thead>
              <tr><th>When</th><th>Instruction</th><th>Understood as</th><th>Result</th></tr>
            </thead>
            <tbody>
              {overview.commands.map((command) => (
                <tr key={command.id}>
                  <td>{new Date(command.at).toLocaleTimeString()}</td>
                  <td>{command.instruction}</td>
                  <td><Pill tone={command.accepted ? 'success' : 'error'}>{command.kind}</Pill></td>
                  <td style={{ color: 'var(--text-dim)' }}>{command.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {managing && (
        <RoleManager
          overview={overview}
          busy={busy}
          onClose={() => setManaging(false)}
          onAssign={(workerId, role, commander) =>
            run(`${workerId} set to ${role}`, async () => {
              await fleet.hiveSetRole(workerId, role, { commander });
            })
          }
          onMakeCommander={(workerId) => run(`${workerId} is the commander`, () => fleet.hiveSetCommander(workerId))}
        />
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

/** A modal to set each worker's role and pick the commander. */
function RoleManager({ overview, busy, onClose, onAssign, onMakeCommander }: {
  overview: HiveOverview;
  busy: boolean;
  onClose: () => void;
  onAssign: (workerId: string, role: HiveRole, commander: boolean) => Promise<void>;
  onMakeCommander: (workerId: string) => Promise<void>;
}) {
  return (
    <Modal title="Assign roles" onClose={onClose} wide footer={<Button onClick={onClose}>Done</Button>}>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        A role tells the hive what a worker is for. The commander is the anchor a formation holds
        around; every other worker follows its own role.
      </p>
      <table>
        <thead>
          <tr><th>Worker</th><th>Role</th><th></th></tr>
        </thead>
        <tbody>
          {overview.members.map((member) => (
            <tr key={member.workerId}>
              <td>
                <div style={{ fontWeight: 600 }}>{member.label}{member.isCommander && ' ★'}</div>
                <div className="card-sub" style={{ fontSize: 11 }}>{member.online ? 'online' : 'offline'}</div>
              </td>
              <td>
                <select
                  value={member.role}
                  disabled={busy}
                  onChange={(e) => void onAssign(member.workerId, e.target.value as HiveRole, member.isCommander)}
                >
                  {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </td>
              <td>
                {!member.isCommander && (
                  <Button small disabled={busy} onClick={() => void onMakeCommander(member.workerId)}>Make commander</Button>
                )}
                {member.isCommander && <Pill tone="success">commander</Pill>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/**
 * The live map.
 *
 * A single canvas redrawn whenever the coordinator's state changes. It plots sector squares first,
 * then members and their formation targets, then sightings. The coordinate space is fitted to the
 * data each frame, so it works whether the swarm is spread over ten blocks or a thousand.
 */
function HiveCanvas({ map }: { map: HiveMapData | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || 480;
    const height = canvas.clientHeight || 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--bg-hover') || '#1c1f26';
    ctx.fillRect(0, 0, width, height);

    if (!map) return;

    const points: { x: number; z: number }[] = [
      ...map.members.map((m) => ({ x: m.position.x, z: m.position.z })),
      ...map.sectors.flatMap((s) => [{ x: s.minX, z: s.minZ }, { x: s.maxX, z: s.maxZ }]),
      ...map.landmarks.map((l) => ({ x: l.position.x, z: l.position.z })),
      ...map.players.map((p) => ({ x: p.position.x, z: p.position.z })),
    ];
    if (points.length === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px system-ui';
      ctx.fillText('No positions reported yet.', 16, 28);
      return;
    }

    const pad = 28;
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minZ = Math.min(...points.map((p) => p.z));
    const maxZ = Math.max(...points.map((p) => p.z));
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanZ);
    const offsetX = (width - spanX * scale) / 2 - minX * scale;
    const offsetY = (height - spanZ * scale) / 2 - minZ * scale;
    const sx = (x: number): number => x * scale + offsetX;
    const sy = (z: number): number => z * scale + offsetY;

    // Sectors
    for (const sector of map.sectors) {
      ctx.fillStyle =
        sector.state === 'explored' ? 'rgba(129,199,132,0.22)'
          : sector.state === 'assigned' ? 'rgba(79,195,247,0.18)'
            : 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      const w = (sector.maxX - sector.minX) * scale;
      const h = (sector.maxZ - sector.minZ) * scale;
      ctx.fillRect(sx(sector.minX), sy(sector.minZ), w, h);
      ctx.strokeRect(sx(sector.minX), sy(sector.minZ), w, h);
    }

    // Formation targets
    for (const member of map.members) {
      if (!member.target) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(member.position.x), sy(member.position.z));
      ctx.lineTo(sx(member.target.x), sy(member.target.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Landmarks
    for (const landmark of map.landmarks) {
      ctx.fillStyle = 'rgba(186,104,200,0.85)';
      ctx.fillRect(sx(landmark.position.x) - 3, sy(landmark.position.z) - 3, 6, 6);
    }

    // Players
    for (const player of map.players) {
      ctx.fillStyle = 'rgba(229,115,115,0.9)';
      ctx.beginPath();
      ctx.arc(sx(player.position.x), sy(player.position.z), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fca5a5';
      ctx.font = '10px system-ui';
      ctx.fillText(player.name, sx(player.position.x) + 7, sy(player.position.z) + 3);
    }

    // Members
    for (const member of map.members) {
      const x = sx(member.position.x);
      const y = sy(member.position.z);
      ctx.fillStyle = member.online ? member.color : 'rgba(120,120,120,0.6)';
      ctx.beginPath();
      ctx.arc(x, y, member.role === 'COMMANDER' ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (member.busy) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '10px system-ui';
      ctx.fillText(member.label, x + 8, y - 6);
    }
  }, [map]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: 320, borderRadius: 8, display: 'block' }} />;
}
