import { describe, it, expect } from 'vitest';
import { ApiAuth, RateLimiter } from '../../src/main/api/auth';

describe('ApiAuth', () => {
  it('generates a token when none is supplied', () => {
    const auth = new ApiAuth();
    expect(auth.getToken().length).toBeGreaterThan(10);
  });

  it('verifies the correct token and rejects others', () => {
    const auth = new ApiAuth('secret');
    expect(auth.verify('secret')).toBe(true);
    expect(auth.verify('wrong')).toBe(false);
    expect(auth.verify(null)).toBe(false);
  });

  it('extracts tokens from headers and query strings', () => {
    expect(ApiAuth.extract('Bearer abc', '/x')).toBe('abc');
    expect(ApiAuth.extract(undefined, '/x?token=abc')).toBe('abc');
    expect(ApiAuth.extract(undefined, '/x')).toBeNull();
  });

  it('regenerates tokens', () => {
    const auth = new ApiAuth('first');
    const next = auth.regenerate();
    expect(next).not.toBe('first');
    expect(auth.verify(next)).toBe(true);
    expect(auth.verify('first')).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('allows up to capacity then blocks', () => {
    const limiter = new RateLimiter(3, 0);
    expect(limiter.allow('k', 1000)).toBe(true);
    expect(limiter.allow('k', 1000)).toBe(true);
    expect(limiter.allow('k', 1000)).toBe(true);
    expect(limiter.allow('k', 1000)).toBe(false);
  });

  it('refills over time', () => {
    const limiter = new RateLimiter(1, 1);
    expect(limiter.allow('k', 0)).toBe(true);
    expect(limiter.allow('k', 0)).toBe(false);
    expect(limiter.allow('k', 1000)).toBe(true);
  });
});
