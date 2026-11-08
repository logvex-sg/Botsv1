/**
 * Message protocol between the main process and a bot worker.
 *
 * A worker is a separate Node process per bot, so a crash in one bot cannot take down the fleet.
 * All messages are plain JSON; secrets are passed once at spawn and never echoed back.
 */
import type { BotRole } from '../../shared/types';

export interface WorkerStartCommand {
  kind: 'start';
  instanceId: string;
  role: BotRole;
  username: string;
  host: string;
  port: number;
  version: string;
  auth: 'offline' | 'microsoft';
  /** Only present for offline accounts; Microsoft auth uses the device-code flow. */
  accessToken?: string;
  connectTimeoutMs: number;
  roleConfig: Record<string, unknown>;
}

export interface WorkerStopCommand {
  kind: 'stop';
}

export interface WorkerCommandAction {
  kind: 'command';
  command: string;
}

export type WorkerCommand = WorkerStartCommand | WorkerStopCommand | WorkerCommandAction;

export interface WorkerTelemetry {
  memoryBytes: number;
  cpuPercent: number;
  ping: number;
  position?: { x: number; y: number; z: number };
  dimension?: string;
  health?: number;
  food?: number;
}

export type WorkerEvent =
  | { kind: 'ready' }
  | { kind: 'connecting' }
  | { kind: 'spawn'; username: string }
  | { kind: 'login' }
  | { kind: 'connected'; version: string }
  | { kind: 'health'; health: number; food: number }
  | { kind: 'position'; position: { x: number; y: number; z: number }; dimension: string }
  | { kind: 'chat'; username: string; message: string }
  | { kind: 'playerJoined'; username: string; uuid: string | null }
  | { kind: 'playerLeft'; username: string; uuid: string | null }
  | { kind: 'players'; players: { username: string; uuid: string | null; ping: number }[] }
  | { kind: 'inventory'; items: { name: string; count: number; slot: number; durability?: number }[]; armor: string[] }
  | { kind: 'telemetry'; telemetry: WorkerTelemetry }
  | { kind: 'kick'; reason: string }
  | { kind: 'error'; message: string; fatal: boolean }
  | { kind: 'end'; reason: string }
  | { kind: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  | { kind: 'roleEvent'; type: string; payload: Record<string, unknown> };

export interface WorkerEnvelope {
  instanceId: string;
  event: WorkerEvent;
}
