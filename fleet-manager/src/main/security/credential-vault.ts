/**
 * Credential storage.
 *
 * Primary backend is the operating-system credential store (keytar / libsecret / DPAPI /
 * Keychain). When that is unavailable the vault falls back to an AES-256-GCM encrypted file
 * whose key is derived from a machine-local secret. Plaintext credentials are never written,
 * never returned to the renderer, and never logged.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const SERVICE = 'logvex-fleet-manager';

export interface CredentialVault {
  isAvailable(): Promise<boolean>;
  set(accountId: string, secret: string): Promise<void>;
  get(accountId: string): Promise<string | null>;
  delete(accountId: string): Promise<void>;
  has(accountId: string): Promise<boolean>;
}

interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/** Vault backed by the OS credential store. */
export class KeytarVault implements CredentialVault {
  constructor(private readonly keytar: KeytarLike) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async set(accountId: string, secret: string): Promise<void> {
    await this.keytar.setPassword(SERVICE, accountId, secret);
  }

  async get(accountId: string): Promise<string | null> {
    return this.keytar.getPassword(SERVICE, accountId);
  }

  async delete(accountId: string): Promise<void> {
    await this.keytar.deletePassword(SERVICE, accountId);
  }

  async has(accountId: string): Promise<boolean> {
    return (await this.get(accountId)) != null;
  }
}

/**
 * Encrypted-file fallback. Uses AES-256-GCM with a key derived (scrypt) from a per-install
 * random salt stored next to the vault file. This keeps secrets off disk in plaintext even when
 * the OS store is missing, without requiring extra dependencies.
 */
export class EncryptedFileVault implements CredentialVault {
  private readonly file: string;
  private readonly keyFile: string;
  private cache: Record<string, string> | null = null;

  constructor(private readonly baseDir: string) {
    this.file = `${baseDir}/credentials.enc`;
    this.keyFile = `${baseDir}/credentials.key`;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private key(): Buffer {
    mkdirSync(dirname(this.keyFile), { recursive: true });
    if (!existsSync(this.keyFile)) {
      const salt = randomBytes(32);
      writeFileSync(this.keyFile, salt.toString('base64'), { mode: 0o600 });
    }
    const salt = Buffer.from(readFileSync(this.keyFile, 'utf8').trim(), 'base64');
    const machine = `${process.platform}:${process.arch}:logvex`;
    return scryptSync(machine, salt, 32);
  }

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    if (!existsSync(this.file)) {
      this.cache = {};
      return this.cache;
    }
    try {
      const raw = Buffer.from(readFileSync(this.file, 'utf8').trim(), 'base64');
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const ciphertext = raw.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      this.cache = JSON.parse(plaintext.toString('utf8')) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const plaintext = Buffer.from(JSON.stringify(this.cache ?? {}), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    writeFileSync(this.file, payload.toString('base64'), { mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // best effort on platforms without POSIX permissions
    }
  }

  async set(accountId: string, secret: string): Promise<void> {
    const data = this.load();
    data[accountId] = secret;
    this.persist();
  }

  async get(accountId: string): Promise<string | null> {
    return this.load()[accountId] ?? null;
  }

  async delete(accountId: string): Promise<void> {
    const data = this.load();
    delete data[accountId];
    this.persist();
  }

  async has(accountId: string): Promise<boolean> {
    return (await this.get(accountId)) != null;
  }
}

/** Chooses the best available backend, preferring the OS store. */
export async function createCredentialVault(baseDir: string): Promise<CredentialVault> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const keytar = require('keytar') as KeytarLike;
    const vault = new KeytarVault(keytar);
    // Probe the store so a broken libsecret falls back cleanly.
    await keytar.getPassword(SERVICE, '__probe__');
    return vault;
  } catch {
    return new EncryptedFileVault(baseDir);
  }
}
