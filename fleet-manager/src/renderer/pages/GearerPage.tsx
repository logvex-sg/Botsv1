/**
 * Gearer Manager page.
 *
 * Manage equipment profiles and preview how a live inventory would be evaluated against them.
 * Purely observational: nothing here drops or moves items.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Empty, Field, Modal, Pill } from '../components/ui';
import type { EquipmentProfileRecord } from '../../shared/types';
import type { EquipmentEvaluation, InventorySnapshot } from '../../main/services/equipment/equipment-manager';

interface Props { push: (message: string, tone?: string) => void }

const blank = (): Partial<EquipmentProfileRecord> => ({
  name: 'New profile',
  serverProfileId: null,
  weapons: ['netherite_sword', 'diamond_sword', 'iron_sword'],
  minArmorPieces: 4,
  minTotems: 1,
  minFood: 8,
  lowDurabilityPercent: 15,
  sortOrder: [],
  warningThresholds: {},
});

export function GearerPage({ push }: Props) {
  const store = useStore();
  const [editing, setEditing] = useState<Partial<EquipmentProfileRecord> | null>(null);
  const [evaluating, setEvaluating] = useState<EquipmentProfileRecord | null>(null);
  const [evaluation, setEvaluation] = useState<EquipmentEvaluation | null>(null);
  const [sample, setSample] = useState<InventorySnapshot>({
    items: [
      { name: 'netherite_sword', count: 1, durabilityUsed: 10, maxDurability: 2031 },
      { name: 'totem_of_undying', count: 2 },
      { name: 'cooked_beef', count: 16 },
    ],
    armor: ['netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots'],
    mainHand: 'netherite_sword',
  });

  const save = async (): Promise<void> => {
    if (!editing) return;
    try {
      if (editing.id) await fleet.updateEquipment(editing.id, editing);
      else await fleet.createEquipment(editing);
      push('Equipment profile saved', 'success');
      setEditing(null);
      await store.refresh();
    } catch (error) {
      push((error as Error).message, 'error');
    }
  };

  const remove = async (profile: EquipmentProfileRecord): Promise<void> => {
    if (!confirm(`Delete equipment profile "${profile.name}"?`)) return;
    await fleet.deleteEquipment(profile.id);
    await store.refresh();
  };

  const runEvaluation = async (): Promise<void> => {
    if (!evaluating) return;
    setEvaluation(await fleet.evaluateEquipment(evaluating.id, sample));
  };

  useEffect(() => {
    if (evaluating) void runEvaluation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, evaluating?.id]);

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Equipment profiles"
        sub="Loadouts and warning thresholds used by GEARER bots."
        actions={<Button variant="primary" onClick={() => setEditing(blank())}>+ New profile</Button>}
      >
        {store.equipment.length === 0 ? (
          <Empty>No equipment profiles yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Armour</th><th>Totems</th><th>Food</th><th>Durability warn</th><th>Weapons</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {store.equipment.map((profile) => (
                <tr key={profile.id}>
                  <td><strong>{profile.name}</strong></td>
                  <td>{profile.minArmorPieces}</td>
                  <td>{profile.minTotems}</td>
                  <td>{profile.minFood}</td>
                  <td>{profile.lowDurabilityPercent}%</td>
                  <td className="card-sub" style={{ fontSize: 11 }}>{profile.weapons.slice(0, 3).join(', ')}{profile.weapons.length > 3 ? '…' : ''}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <Button small onClick={() => setEvaluating(profile)}>Evaluate</Button>
                      <Button small onClick={() => setEditing(profile)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => remove(profile)}>✕</Button>
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
          title={editing.id ? `Edit ${editing.name}` : 'New equipment profile'}
          onClose={() => setEditing(null)}
          footer={<>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save</Button>
          </>}
        >
          <Field label="Profile name">
            <input type="text" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <Field label="Weapons (comma separated, priority order)">
            <input
              type="text"
              value={(editing.weapons ?? []).join(', ')}
              onChange={(e) => setEditing({ ...editing, weapons: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          <div className="grid cols-2">
            <Field label="Min armour pieces">
              <input type="number" min={0} max={4} value={editing.minArmorPieces ?? 4} onChange={(e) => setEditing({ ...editing, minArmorPieces: Number(e.target.value) })} />
            </Field>
            <Field label="Min totems">
              <input type="number" min={0} value={editing.minTotems ?? 1} onChange={(e) => setEditing({ ...editing, minTotems: Number(e.target.value) })} />
            </Field>
            <Field label="Min food">
              <input type="number" min={0} value={editing.minFood ?? 8} onChange={(e) => setEditing({ ...editing, minFood: Number(e.target.value) })} />
            </Field>
            <Field label="Low durability %">
              <input type="number" min={0} max={100} value={editing.lowDurabilityPercent ?? 15} onChange={(e) => setEditing({ ...editing, lowDurabilityPercent: Number(e.target.value) })} />
            </Field>
          </div>
        </Modal>
      )}

      {evaluating && (
        <Modal
          title={`Evaluate ${evaluating.name}`}
          wide
          onClose={() => { setEvaluating(null); setEvaluation(null); }}
          footer={<Button onClick={() => { setEvaluating(null); setEvaluation(null); }}>Close</Button>}
        >
          <p className="card-sub" style={{ marginBottom: 12 }}>
            Edit the sample inventory to preview warnings. This never affects a live bot.
          </p>
          <div className="grid cols-2" style={{ marginBottom: 14 }}>
            <Field label="Armour pieces (comma separated)">
              <input
                type="text"
                value={sample.armor.join(', ')}
                onChange={(e) => setSample({ ...sample, armor: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>
            <Field label="Main hand">
              <input type="text" value={sample.mainHand ?? ''} onChange={(e) => setSample({ ...sample, mainHand: e.target.value })} />
            </Field>
          </div>
          <Field label="Items (name:count, comma separated)">
            <input
              type="text"
              value={sample.items.map((i) => `${i.name}:${i.count}`).join(', ')}
              onChange={(e) => setSample({
                ...sample,
                items: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
                  const [name, count] = pair.split(':');
                  return { name: name.trim(), count: Number(count) || 1 };
                }),
              })}
            />
          </Field>

          {evaluation && (
            <div className="col" style={{ gap: 10, marginTop: 8 }}>
              <div className="row">
                <Pill tone={evaluation.ready ? 'success' : 'error'}>{evaluation.ready ? 'READY' : 'NOT READY'}</Pill>
                <span className="card-sub">{evaluation.armorPieces} armour · {evaluation.totems} totems · {evaluation.food} food</span>
              </div>
              {evaluation.warnings.length === 0 ? (
                <Empty>No warnings — equipment meets the profile.</Empty>
              ) : evaluation.warnings.map((warning, index) => (
                <div key={index} className="row" style={{ gap: 8 }}>
                  <Pill tone={warning.severity === 'critical' ? 'error' : warning.severity === 'warning' ? 'warning' : 'info'}>{warning.severity}</Pill>
                  <span>{warning.message}</span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
