/**
 * Navigation through `mineflayer-pathfinder`.
 *
 * The planner decides whether a walk is allowed; this adapter performs it, bounds it with a timeout,
 * and classifies a failure into the vocabulary the recovery planner understands. It never retries on
 * its own — recovery policy lives one level up so it is testable without a server.
 */

import { BotError, navigationError, timeoutError } from '../core/errors';
import type { Logger } from '../core/logger';
import { distanceBetween, planNavigation, type NavigationFailure, type NavigationLimitsView } from '../core/engine/navigation-engine';
import type { Position, Vec3 } from '../core/types';
import type { MineflayerBot } from './connection';

export interface PathfinderLike {
  setGoal(goal: unknown, dynamic?: boolean): void;
  goto(goal: unknown): Promise<void>;
  setMovements?(movements: unknown): void;
  stop?(): void;
  isMoving?(): boolean;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners?(event?: string): void;
}

export interface NavigationBot extends MineflayerBot {
  pathfinder?: PathfinderLike;
  entity?: { position: { x: number; y: number; z: number } };
  blockAt?(position: unknown): { name?: string } | null;
}

export interface GoalsFactory {
  GoalBlock(x: number, y: number, z: number): unknown;
  GoalNear(x: number, y: number, z: number, range: number): unknown;
}

/**
 * Builds a goal, tolerating both a class and a plain function.
 *
 * `mineflayer-pathfinder` exposes its goals as ES classes, which cannot be called without `new`;
 * the test doubles are plain functions. Trying `new` first and falling back to a direct call lets
 * one code path serve both without the caller having to know which it holds.
 */
function buildGoal(factory: (...args: number[]) => unknown, args: number[]): unknown {
  try {
    const Constructable = factory as unknown as new (...values: number[]) => unknown;
    return new Constructable(...args);
  } catch {
    return factory(...args);
  }
}

export interface MovementsFactory {
  (bot: unknown): unknown;
}

export interface NavigationAdapterOptions {
  bot: NavigationBot;
  logger: Logger;
  goals: GoalsFactory;
  movements?: MovementsFactory;
  limits: NavigationLimitsView;
  vec: (position: Vec3) => unknown;
}

export interface WalkResult {
  reached: boolean;
  distance: number;
  durationMs: number;
  failure?: NavigationFailure;
  reason: string;
}

export class NavigationAdapter {
  private readonly bot: NavigationBot;
  private readonly logger: Logger;
  private readonly goals: GoalsFactory;
  private readonly movements?: MovementsFactory;
  private limits: NavigationLimitsView;
  private readonly vec: (position: Vec3) => unknown;

  constructor(options: NavigationAdapterOptions) {
    this.bot = options.bot;
    this.logger = options.logger.child('navigation');
    this.goals = options.goals;
    this.movements = options.movements;
    this.limits = options.limits;
    this.vec = options.vec;
  }

  setLimits(limits: NavigationLimitsView): void {
    this.limits = limits;
    this.applyMovements();
  }

  /** Applies the movement limits the pathfinder uses (digging, placing, swimming). */
  private applyMovements(): void {
    if (!this.movements || !this.bot.pathfinder?.setMovements) return;
    try {
      const movements = this.movements(this.bot) as { canDig?: boolean; allow1by1towers?: boolean; canOpenDoors?: boolean; dontCreateFlow?: boolean; allowParkour?: boolean; canSwim?: boolean; allowSprinting?: boolean };
      movements.canDig = this.limits.allowDigging;
      movements.allow1by1towers = this.limits.allowPlacing;
      movements.canOpenDoors = true;
      movements.dontCreateFlow = true;
      movements.allowParkour = true;
      movements.canSwim = true;
      movements.allowSprinting = true;
      this.bot.pathfinder.setMovements(movements);
    } catch (error) {
      this.logger.debug('could not apply movements', { error: String(error) });
    }
  }

  private currentPosition(): Position | null {
    const position = this.bot.entity?.position;
    if (!position) return null;
    return { x: position.x, y: position.y, z: position.z };
  }

  /** Plans, then performs, a walk to a block position. */
  async walkTo(target: Vec3, options: { range?: number; timeoutMs?: number; signal?: { isCancelled: boolean } } = {}): Promise<WalkResult> {
    const from = this.currentPosition();
    if (!from) throw navigationError('the bot has no position yet; it is not spawned');
    if (!this.bot.pathfinder) throw navigationError('the pathfinder plugin is not loaded on this bot');

    const range = options.range ?? 1;
    const plan = planNavigation(from, target, this.limits, { range, timeoutMs: options.timeoutMs });
    if (!plan.allowed) throw navigationError(plan.reason, { target, distance: plan.distance });

    const goal = range <= 1
      ? buildGoal(this.goals.GoalBlock, [target.x, target.y, target.z])
      : buildGoal(this.goals.GoalNear, [target.x, target.y, target.z, range]);

    this.applyMovements();
    const started = Date.now();

    return new Promise<WalkResult>((resolve) => {
      let settled = false;
      const finish = (result: WalkResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        try {
          this.bot.pathfinder?.stop?.();
        } catch {
          /* best effort */
        }
        finish({ reached: false, distance: plan.distance, durationMs: Date.now() - started, failure: 'timeout', reason: `the walk timed out after ${plan.timeoutMs}ms` });
      }, plan.timeoutMs);

      // A cancellation token is checked on a short interval so a cancelled walk stops promptly.
      const cancelInterval: ReturnType<typeof setInterval> | null = options.signal
        ? setInterval(() => {
            if (options.signal?.isCancelled && !settled) {
              if (cancelInterval) clearInterval(cancelInterval);
              try {
                this.bot.pathfinder?.stop?.();
              } catch {
                /* best effort */
              }
              finish({ reached: false, distance: plan.distance, durationMs: Date.now() - started, failure: 'cancelled', reason: 'the walk was cancelled' });
            }
          }, 200)
        : null;

      const onGoalReached = (): void => {
        if (cancelInterval) clearInterval(cancelInterval);
        const position = this.currentPosition();
        const distance = position ? distanceBetween(position, target) : plan.distance;
        finish({ reached: true, distance: Math.round(distance * 100) / 100, durationMs: Date.now() - started, reason: 'arrived' });
      };

      const onPathUpdate = (result: { status?: string } | undefined): void => {
        if (!result || result.status === 'noPath') {
          if (cancelInterval) clearInterval(cancelInterval);
          finish({ reached: false, distance: plan.distance, durationMs: Date.now() - started, failure: 'unreachable', reason: 'no path to the destination' });
        } else if (result.status === 'timeout') {
          if (cancelInterval) clearInterval(cancelInterval);
          finish({ reached: false, distance: plan.distance, durationMs: Date.now() - started, failure: 'timeout', reason: 'the pathfinder timed out' });
        }
      };

      this.bot.pathfinder?.on?.('goal_reached', onGoalReached);
      this.bot.pathfinder?.on?.('path_update', onPathUpdate as (...args: unknown[]) => void);

      this.bot.pathfinder!.goto(goal).then(
        () => {
          if (cancelInterval) clearInterval(cancelInterval);
          onGoalReached();
        },
        (error: unknown) => {
          if (cancelInterval) clearInterval(cancelInterval);
          const message = String(error);
          const failure: NavigationFailure = /no path|nopath/i.test(message) ? 'unreachable' : /cancel/i.test(message) ? 'cancelled' : 'stuck';
          finish({ reached: false, distance: plan.distance, durationMs: Date.now() - started, failure, reason: message });
        },
      );
    });
  }

  /** Stops any current walk immediately. */
  stop(): void {
    try {
      this.bot.pathfinder?.stop?.();
    } catch {
      /* best effort */
    }
  }

  isMoving(): boolean {
    try {
      return this.bot.pathfinder?.isMoving?.() ?? false;
    } catch {
      return false;
    }
  }

  /** Straight-line distance to a target, or null when the bot has no position. */
  distanceTo(target: Vec3): number | null {
    const from = this.currentPosition();
    if (!from) return null;
    return Math.round(distanceBetween(from, target) * 100) / 100;
  }

  blockNameAt(position: Vec3): string | null {
    if (!this.bot.blockAt) return null;
    return this.bot.blockAt(this.vec(position))?.name ?? null;
  }
}

export { timeoutError, BotError };
