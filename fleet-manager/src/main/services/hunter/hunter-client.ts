/**
 * Client for the Logvex Hunter Meteor addon companion API.
 *
 * The addon exposes a small authenticated HTTP/SSE surface. This client wraps the endpoints the
 * Fleet Manager needs: health, snapshot, target lists, module status and remote commands. It is
 * resilient: a missing or unreachable addon degrades to "disconnected" rather than throwing into
 * the UI, and it never sends credentials it was not configured with.
 */
import { EventEmitter } from 'node:events';

export interface HunterConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

export interface HunterHealth {
  ok: boolean;
  version?: string;
  url: string;
  error?: string;
}

export interface HunterTarget {
  uuid?: string | null;
  username: string;
  category?: string;
  priority?: number;
  notes?: string;
  kills?: number;
  deaths?: number;
  encounters?: number;
  lastSeen?: number;
  lastPosition?: { x: number; y: number; z: number } | null;
  dimension?: string;
}

export interface HunterModuleStatus {
  name: string;
  enabled: boolean;
  category?: string;
}

export interface HunterSetting {
  name: string;
  title: string;
  description?: string;
  type: 'boolean' | 'integer' | 'double' | 'enum' | 'string' | 'other';
  value: string;
  default: string;
  modified: boolean;
  min?: number;
  max?: number;
  suggestions?: string[];
}

export interface HunterModuleDetail {
  name: string;
  title: string;
  description?: string;
  category?: string;
  enabled: boolean;
  hunter: boolean;
  settings: HunterSetting[];
}

export interface HunterProfile {
  name: string;
  active: boolean;
  range: number;
  scanInterval: number;
  sortMode: string;
  autoSelect: boolean;
  protectFriends: boolean;
  protectIgnored: boolean;
}

export interface HunterHudElement {
  name: string;
  title: string;
  group: string;
  active: boolean;
  hunter: boolean;
}

export interface HunterSnapshot {
  players?: unknown[];
  targets?: HunterTarget[];
  modules?: HunterModuleStatus[];
  stats?: Record<string, unknown>;
  bot?: Record<string, unknown>;
  [key: string]: unknown;
}

export class HunterClient extends EventEmitter {
  private config: HunterConfig;
  private connected = false;
  private lastSync: number | null = null;

  constructor(config: HunterConfig) {
    super();
    this.config = { timeoutMs: 4000, ...config };
  }

  configure(config: Partial<HunterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  isConnected(): boolean {
    return this.connected;
  }

  lastSyncAt(): number | null {
    return this.lastSync;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
    return headers;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init?.headers as Record<string, string> | undefined) },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.connected = true;
      this.lastSync = Date.now();
      return (await response.json()) as T;
    } catch (error) {
      this.connected = false;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<HunterHealth> {
    try {
      const body = await this.request<{ version?: string }>('/health');
      return { ok: true, version: body.version, url: this.config.baseUrl };
    } catch (error) {
      return { ok: false, url: this.config.baseUrl, error: (error as Error).message };
    }
  }

  async snapshot(): Promise<HunterSnapshot> {
    return this.request<HunterSnapshot>('/api/v1/snapshot');
  }

  async targets(): Promise<HunterTarget[]> {
    const snapshot = await this.snapshot();
    return snapshot.targets ?? [];
  }

  async modules(): Promise<HunterModuleStatus[]> {
    const body = await this.request<{ modules?: HunterModuleStatus[] }>('/api/v1/modules');
    return body.modules ?? [];
  }

  async players(): Promise<unknown[]> {
    const body = await this.request<{ players?: unknown[] }>('/api/v1/players');
    return body.players ?? [];
  }

  /** Sends an administrative command to the addon (e.g. "status"). */
  async command(command: string): Promise<unknown> {
    return this.request('/api/v1/command', {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async notify(message: string): Promise<unknown> {
    return this.request('/api/v1/notify', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  /** Full detail (including settings) for one module. */
  async module(name: string): Promise<HunterModuleDetail> {
    const body = await this.request<{ module: HunterModuleDetail }>(`/api/v1/modules/${encodeURIComponent(name)}`);
    return body.module;
  }

  /** Changes one setting of one module. */
  async setSetting(module: string, setting: string, value: string): Promise<{ result: string }> {
    return this.request('/api/v1/settings', {
      method: 'POST',
      body: JSON.stringify({ module, setting, value }),
    });
  }

  async profiles(): Promise<HunterProfile[]> {
    const body = await this.request<{ profiles?: HunterProfile[] }>('/api/v1/profiles');
    return body.profiles ?? [];
  }

  /** Switches the active profile. */
  async useProfile(name: string): Promise<{ result: string }> {
    return this.request(`/api/v1/profiles/${encodeURIComponent(name)}`, { method: 'POST', body: '{}' });
  }

  async hud(): Promise<HunterHudElement[]> {
    const body = await this.request<{ hud?: HunterHudElement[] }>('/api/v1/hud');
    return body.hud ?? [];
  }

  /** Toggles a HUD element on or off. */
  async toggleHud(name: string): Promise<{ result: string }> {
    return this.request(`/api/v1/hud/${encodeURIComponent(name)}`, { method: 'POST', body: '{}' });
  }

  /** Runs a hunter lifecycle action (start, stop, emergency-stop, clear-stop, pause, resume, save, status). */
  async hunter(action: string): Promise<{ result: string }> {
    return this.request(`/api/v1/hunter/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' });
  }
}
