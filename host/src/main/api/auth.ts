/**
 * API authentication and rate limiting.
 *
 * The local API is loopback-only by default and protected by a bearer token generated on first
 * run. Tokens are compared in constant time. A token-bucket rate limiter protects the API from
 * accidental floods (and from a runaway integration).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

export class ApiAuth {
  private token: string;

  constructor(token?: string) {
    this.token = token && token.length > 0 ? token : randomBytes(24).toString('hex');
  }

  /** The token, for display in the UI settings (never logged). */
  getToken(): string {
    return this.token;
  }

  regenerate(): string {
    this.token = randomBytes(24).toString('hex');
    return this.token;
  }

  setToken(token: string): void {
    if (token && token.length > 0) this.token = token;
  }

  /** Extracts a token from an Authorization header or a `token` query parameter. */
  static extract(header: string | undefined, url: string | undefined): string | null {
    if (header && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
    if (url) {
      const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
      const params = new URLSearchParams(query);
      const token = params.get('token');
      if (token) return token;
    }
    return null;
  }

  verify(candidate: string | null): boolean {
    if (!candidate) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity = 60,
    private readonly refillPerSecond = 30,
  ) {}

  /** Returns true when the request is allowed. */
  allow(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    const elapsed = Math.max(0, now - bucket.updated) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    bucket.updated = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}
