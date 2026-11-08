import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedFileVault, KeytarVault } from '../../src/main/security/credential-vault';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'logvex-vault-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('EncryptedFileVault', () => {
  it('stores and retrieves a secret', async () => {
    const vault = new EncryptedFileVault(dir);
    await vault.set('a1', 'hunter2');
    expect(await vault.get('a1')).toBe('hunter2');
    expect(await vault.has('a1')).toBe(true);
  });

  it('never writes the secret in plaintext', async () => {
    const vault = new EncryptedFileVault(dir);
    await vault.set('a1', 'SUPER-SECRET-TOKEN');
    const raw = readFileSync(join(dir, 'credentials.enc'), 'utf8');
    expect(raw).not.toContain('SUPER-SECRET-TOKEN');
  });

  it('deletes secrets', async () => {
    const vault = new EncryptedFileVault(dir);
    await vault.set('a1', 'x');
    await vault.delete('a1');
    expect(await vault.get('a1')).toBeNull();
  });

  it('returns null for unknown accounts', async () => {
    const vault = new EncryptedFileVault(dir);
    expect(await vault.get('missing')).toBeNull();
  });

  it('persists across instances', async () => {
    await new EncryptedFileVault(dir).set('a1', 'persisted');
    expect(await new EncryptedFileVault(dir).get('a1')).toBe('persisted');
    expect(existsSync(join(dir, 'credentials.key'))).toBe(true);
  });
});

describe('KeytarVault', () => {
  it('delegates to the keytar interface', async () => {
    const store = new Map<string, string>();
    const fake = {
      setPassword: async (_s: string, a: string, p: string) => { store.set(a, p); },
      getPassword: async (_s: string, a: string) => store.get(a) ?? null,
      deletePassword: async (_s: string, a: string) => store.delete(a),
    };
    const vault = new KeytarVault(fake);
    await vault.set('a1', 'token');
    expect(await vault.get('a1')).toBe('token');
    await vault.delete('a1');
    expect(await vault.has('a1')).toBe(false);
  });
});
