/**
 * Validation boundary for storage tasks, mirroring the mod's `core/StorageRequests`.
 *
 * Every field a host can send is parsed here before it reaches the game. Limits are clamped, and
 * anything non-finite or of the wrong shape is rejected outright. This is why the host cannot ask
 * the worker to move "infinite" items or open a container at `NaN`.
 */

import { validationError } from '../errors';
import { SHULKER_SLOTS } from '../engine/shulker-engine';

export { SHULKER_SLOTS };
import type { Vec3 } from '../types';

export const MAX_LIMIT = 3456;
export const MAX_RADIUS = 64;
export const DEFAULT_PORTAL_RADIUS = 24;

export type MoveDirection = 'withdraw' | 'deposit';

export interface ContainerReadRequest {
  position: Vec3;
  dimension?: string;
  label?: string;
}

export interface ContainerMoveRequest {
  direction: MoveDirection;
  query: string;
  limit: number;
  target?: Vec3;
  dimension?: string;
  label?: string;
}

export interface ShulkerReadRequest {
  slot: number;
  hasSlot: boolean;
}

export interface ShulkerUnpackRequest {
  slot: number;
  hasSlot: boolean;
}

export interface ShulkerPackRequest {
  query: string;
  limit: number;
  slot: number;
  hasSlot: boolean;
}

export interface RestockRequest {
  query: string;
  limit: number;
  source?: Vec3;
  dimension?: string;
}

export interface PortalScanRequest {
  action: 'scan' | 'remove';
  radius: number;
  target?: Vec3;
}

export interface NavigateRequest {
  position: Vec3;
  range: number;
  timeoutMs?: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function int(value: unknown): number | null {
  if (finite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positionFrom(payload: Record<string, unknown>): Vec3 | null {
  const x = int(payload.x);
  const y = int(payload.y);
  const z = int(payload.z);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function parseContainerRead(payload: Record<string, unknown>): ContainerReadRequest {
  const position = positionFrom(payload);
  if (!position) throw validationError('container-read requires finite x, y and z');
  const dimension = typeof payload.dimension === 'string' ? payload.dimension : undefined;
  const label = typeof payload.label === 'string' ? payload.label : undefined;
  return { position, dimension, label };
}

export function parseContainerMove(payload: Record<string, unknown>): ContainerMoveRequest {
  const rawDirection = String(payload.direction ?? 'withdraw').toLowerCase();
  let direction: MoveDirection;
  if (['withdraw', 'take', 'out', 'pull'].includes(rawDirection)) direction = 'withdraw';
  else if (['deposit', 'put', 'in', 'store'].includes(rawDirection)) direction = 'deposit';
  else throw validationError(`unknown container-move direction: ${rawDirection}`);

  const query = nonEmptyString(payload.query) ?? nonEmptyString(payload.item);
  if (!query) throw validationError('container-move requires a query');

  const rawLimit = int(payload.limit) ?? 1;
  if (rawLimit <= 0) throw validationError('container-move limit must be positive');
  const limit = clamp(rawLimit, 1, MAX_LIMIT);

  const target = positionFrom(payload) ?? undefined;
  return {
    direction,
    query,
    limit,
    target,
    dimension: typeof payload.dimension === 'string' ? payload.dimension : undefined,
    label: typeof payload.label === 'string' ? payload.label : undefined,
  };
}

export function parseShulkerRead(payload: Record<string, unknown>): ShulkerReadRequest {
  const raw = int(payload.slot);
  const hasSlot = raw !== null && raw >= 0;
  return { slot: hasSlot ? (raw as number) : -1, hasSlot };
}

export function parseShulkerUnpack(payload: Record<string, unknown>): ShulkerUnpackRequest {
  const raw = int(payload.slot);
  const hasSlot = raw !== null && raw >= 0;
  return { slot: hasSlot ? (raw as number) : -1, hasSlot };
}

export function parseShulkerPack(payload: Record<string, unknown>): ShulkerPackRequest {
  const query = nonEmptyString(payload.query) ?? nonEmptyString(payload.item);
  if (!query) throw validationError('shulker-pack requires a query');
  const rawLimit = int(payload.limit) ?? 1;
  if (rawLimit <= 0) throw validationError('shulker-pack limit must be positive');
  const limit = clamp(rawLimit, 1, MAX_LIMIT);
  const rawSlot = int(payload.slot);
  const hasSlot = rawSlot !== null && rawSlot >= 0;
  return { query, limit, slot: hasSlot ? (rawSlot as number) : -1, hasSlot };
}

export function parseRestock(payload: Record<string, unknown>): RestockRequest {
  const query = nonEmptyString(payload.query) ?? nonEmptyString(payload.item);
  if (!query) throw validationError('restock requires a query');
  const rawLimit = int(payload.limit) ?? 64;
  if (rawLimit <= 0) throw validationError('restock limit must be positive');
  const limit = clamp(rawLimit, 1, MAX_LIMIT);
  const source = positionFrom(payload) ?? undefined;
  return { query, limit, source, dimension: typeof payload.dimension === 'string' ? payload.dimension : undefined };
}

export function parsePortalScan(payload: Record<string, unknown>): PortalScanRequest {
  const rawAction = String(payload.action ?? 'scan').toLowerCase();
  const action: 'scan' | 'remove' = ['remove', 'break', 'clear', 'destroy'].includes(rawAction) ? 'remove' : 'scan';
  const radius = clamp(int(payload.radius) ?? DEFAULT_PORTAL_RADIUS, 1, MAX_RADIUS);
  const target = positionFrom(payload) ?? undefined;
  return { action, radius, target };
}

export function parseNavigate(payload: Record<string, unknown>): NavigateRequest {
  const position = positionFrom(payload);
  if (!position) throw validationError('navigate requires finite x, y and z');
  const range = clamp(int(payload.range) ?? 1, 0, 32);
  const timeoutMs = int(payload.timeoutMs);
  return { position, range, timeoutMs: timeoutMs !== null && timeoutMs > 0 ? timeoutMs : undefined };
}
