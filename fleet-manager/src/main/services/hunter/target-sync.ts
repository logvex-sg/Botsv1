/**
 * Target synchronisation between the Fleet Manager target database and Logvex Hunter.
 *
 * Bidirectional but conflict-free: the Fleet Manager owns user edits (category, priority, notes)
 * while Hunter owns observed facts (last seen, position, encounter counters). Records are keyed by
 * UUID when available, else username, so the two sides converge without duplicating entries.
 */
import type { TargetRepository } from '../../db/repositories';
import type { TargetEntry } from '../../../shared/types';
import type { HunterClient, HunterTarget } from './hunter-client';

export interface SyncResult {
  pulled: number;
  pushed: number;
  skipped: number;
  errors: string[];
}

export class TargetSync {
  constructor(
    private readonly targets: TargetRepository,
    private readonly hunter: HunterClient,
    private readonly emit: (type: string, message: string, payload?: Record<string, unknown>) => void,
  ) {}

  /** Pulls Hunter's targets into the local database, merging observed facts. */
  async pull(): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, skipped: 0, errors: [] };
    let remote: HunterTarget[];
    try {
      remote = await this.hunter.targets();
    } catch (error) {
      result.errors.push((error as Error).message);
      return result;
    }

    for (const target of remote) {
      try {
        const existing = this.targets.findByIdentity(target.uuid ?? null, target.username);
        this.targets.upsert({
          uuid: target.uuid ?? null,
          username: target.username,
          category: existing?.category ?? target.category ?? 'TEMPORARY',
          priority: existing?.priority ?? target.priority ?? 5,
          notes: existing?.notes ?? target.notes ?? '',
          source: existing?.source ?? 'hunter',
          lastSeen: target.lastSeen ?? null,
          lastPosition: target.lastPosition ?? null,
          dimension: target.dimension ?? '',
          encounters: target.encounters ?? 0,
          kills: target.kills ?? 0,
          deaths: target.deaths ?? 0,
        });
        result.pulled++;
        this.emit('TARGET_UPDATED', `Pulled target ${target.username} from Hunter`, {
          username: target.username,
          uuid: target.uuid ?? null,
        });
      } catch (error) {
        result.skipped++;
        result.errors.push(`${target.username}: ${(error as Error).message}`);
      }
    }
    return result;
  }

  /** Pushes locally-classified targets back to Hunter. */
  async push(): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, skipped: 0, errors: [] };
    const local = this.targets.list().filter((t) => t.source === 'fleet' || t.notes.length > 0);
    for (const target of local) {
      try {
        await this.hunter.command(`target add ${target.username}`);
        result.pushed++;
      } catch (error) {
        result.skipped++;
        result.errors.push(`${target.username}: ${(error as Error).message}`);
      }
    }
    return result;
  }

  /** Reconciles a single target record without a full sync. */
  mergeOne(target: HunterTarget): TargetEntry {
    const existing = this.targets.findByIdentity(target.uuid ?? null, target.username);
    return this.targets.upsert({
      uuid: target.uuid ?? null,
      username: target.username,
      category: existing?.category ?? target.category ?? 'TEMPORARY',
      priority: existing?.priority ?? target.priority ?? 5,
      notes: existing?.notes ?? target.notes ?? '',
      source: 'hunter',
      lastSeen: target.lastSeen ?? null,
      lastPosition: target.lastPosition ?? null,
      dimension: target.dimension ?? '',
      encounters: target.encounters ?? 0,
      kills: target.kills ?? 0,
      deaths: target.deaths ?? 0,
    });
  }
}
