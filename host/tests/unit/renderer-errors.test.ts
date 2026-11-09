import { describe, it, expect } from 'vitest';
import { toFriendlyError } from '../../src/renderer/lib/errors';

describe('toFriendlyError', () => {
  it('maps a port conflict to an actionable hint', () => {
    const friendly = toFriendlyError(new Error('listen EADDRINUSE: address already in use 127.0.0.1:8791'));
    expect(friendly.title).toMatch(/port/i);
    expect(friendly.hint).toMatch(/port/i);
    expect(friendly.technical).toContain('EADDRINUSE');
  });

  it('maps a refused connection', () => {
    const friendly = toFriendlyError(new Error('fetch failed: ECONNREFUSED 1.2.3.4:25565'));
    expect(friendly.title).toMatch(/reach the server/i);
  });

  it('maps a missing credential', () => {
    const friendly = toFriendlyError(new Error('no stored credential for account acc-1'));
    expect(friendly.title).toMatch(/password/i);
  });

  it('maps a combat authorisation failure', () => {
    const friendly = toFriendlyError(new Error('HUNTER requires authorizedCombat'));
    expect(friendly.title).toMatch(/combat/i);
  });

  it('falls back to a generic message and keeps the original text', () => {
    const friendly = toFriendlyError(new Error('something unexpected exploded'));
    expect(friendly.title).toBe('Something went wrong');
    expect(friendly.technical).toContain('something unexpected exploded');
  });

  it('accepts non-Error values without throwing', () => {
    const friendly = toFriendlyError({ code: 42 });
    expect(friendly.title).toBe('Something went wrong');
    expect(friendly.technical).toContain('42');
  });
});
