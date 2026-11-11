import { describe, expect, it } from 'vitest';
import {
  Backoff,
  CancellationToken,
  OperationLock,
  RateLimiter,
  withRetry,
  withTimeout,
} from '../../src/core/reliability';
import { BotError } from '../../src/core/errors';

describe('OperationLock', () => {
  it('acquires and releases a resource for its owner', () => {
    const lock = new OperationLock();
    expect(lock.tryAcquire('chest', 'worker-a')).toBe(true);
    expect(lock.isHeld('chest')).toBe(true);
    expect(lock.holder('chest')).toBe('worker-a');
    lock.release('chest', 'worker-a');
    expect(lock.isHeld('chest')).toBe(false);
  });

  it('fails a double acquire of the same resource', () => {
    const lock = new OperationLock();
    expect(lock.tryAcquire('chest', 'worker-a')).toBe(true);
    expect(lock.tryAcquire('chest', 'worker-b')).toBe(false);
    expect(lock.holder('chest')).toBe('worker-a');
  });

  it('only lets the owner release the resource', () => {
    const lock = new OperationLock();
    lock.tryAcquire('chest', 'worker-a');
    lock.release('chest', 'worker-b');
    expect(lock.isHeld('chest')).toBe(true);
    lock.release('chest', 'worker-a');
    expect(lock.isHeld('chest')).toBe(false);
  });

  it('releases every resource held by one owner only', () => {
    const lock = new OperationLock();
    lock.tryAcquire('chest', 'worker-a');
    lock.tryAcquire('vault', 'worker-a');
    lock.tryAcquire('furnace', 'worker-b');
    lock.releaseAll('worker-a');
    expect(lock.isHeld('chest')).toBe(false);
    expect(lock.isHeld('vault')).toBe(false);
    expect(lock.isHeld('furnace')).toBe(true);
  });

  it('detects stale locks using the injected clock', () => {
    let now = 1_000;
    const lock = new OperationLock(() => now);
    lock.tryAcquire('chest', 'worker-a');
    now = 1_500;
    expect(lock.stale(1_000)).toEqual([]);
    now = 3_000;
    expect(lock.stale(1_000)).toEqual(['chest']);
  });

  it('clears every lock', () => {
    const lock = new OperationLock();
    lock.tryAcquire('a', 'x');
    lock.tryAcquire('b', 'y');
    lock.clear();
    expect(lock.heldResources()).toEqual([]);
  });
});

describe('RateLimiter', () => {
  it('takes tokens until the bucket is exhausted', () => {
    let now = 0;
    const limiter = new RateLimiter(60, () => now, 2);
    expect(limiter.tryTake()).toBe(true);
    expect(limiter.tryTake()).toBe(true);
    expect(limiter.tryTake()).toBe(false);
  });

  it('refills over time according to the injected clock', () => {
    let now = 0;
    const limiter = new RateLimiter(60, () => now, 2); // one token per second
    limiter.tryTake();
    limiter.tryTake();
    expect(limiter.tryTake()).toBe(false);
    now = 1_000;
    expect(limiter.available()).toBe(1);
    expect(limiter.tryTake()).toBe(true);
  });

  it('reports how long until a token is available', () => {
    let now = 0;
    const limiter = new RateLimiter(60, () => now, 1); // 1 token / 1000 ms
    limiter.tryTake();
    expect(limiter.retryAfterMs()).toBe(1_000);
    now = 500;
    expect(limiter.retryAfterMs()).toBe(500);
    expect(limiter.retryAfterMs()).toBe(500);
  });

  it('never blocks when the rate is non-positive', () => {
    const limiter = new RateLimiter(0, () => 0, 0);
    expect(limiter.tryTake()).toBe(true);
    expect(limiter.retryAfterMs()).toBe(0);
  });
});

describe('withRetry', () => {
  const retryable = () => new BotError('transient', { category: 'connection', retryable: true, mutation: 'none' });
  const noSleep = async () => undefined;

  it('passes through a first-try success without retrying', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return 'ok';
    }, { sleep: noSleep });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a retryable error up to the attempt limit', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw retryable();
      }, { attempts: 3, sleep: noSleep }),
    ).rejects.toBeInstanceOf(BotError);
    expect(calls).toBe(3);
  });

  it('succeeds on a later attempt', async () => {
    let calls = 0;
    const result = await withRetry(async (attempt) => {
      calls += 1;
      if (attempt < 2) throw retryable();
      return 'recovered';
    }, { attempts: 3, sleep: noSleep });
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('does NOT retry a non-retryable error', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new BotError('fatal', { category: 'validation', retryable: false });
      }, { attempts: 3, sleep: noSleep }),
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });

  it('does NOT retry a retryable error whose mutation is partial', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new BotError('may have landed', { category: 'container', retryable: true, mutation: 'partial' });
      }, { attempts: 3, sleep: noSleep }),
    ).rejects.toThrow('may have landed');
    expect(calls).toBe(1);
  });

  it('does NOT retry a retryable error whose mutation is applied', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new BotError('definitely landed', { category: 'container', retryable: true, mutation: 'applied' });
      }, { attempts: 3, sleep: noSleep }),
    ).rejects.toThrow('definitely landed');
    expect(calls).toBe(1);
  });

  it('invokes onRetry before each backoff', async () => {
    const retries: number[] = [];
    await expect(
      withRetry(async () => {
        throw retryable();
      }, {
        attempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 100,
        sleep: noSleep,
        onRetry: (_error, attempt) => retries.push(attempt),
      }),
    ).rejects.toBeInstanceOf(BotError);
    expect(retries).toEqual([1, 2]);
  });
});

describe('Backoff', () => {
  it('grows exponentially with zero jitter', () => {
    const backoff = new Backoff(100, 10_000, () => 0);
    expect(backoff.next().nextDelayMs).toBe(100);
    expect(backoff.next().nextDelayMs).toBe(200);
    expect(backoff.next().nextDelayMs).toBe(400);
  });

  it('caps the delay at the maximum', () => {
    const backoff = new Backoff(100, 500, () => 0);
    backoff.next();
    backoff.next();
    backoff.next();
    const capped = backoff.next();
    expect(capped.nextDelayMs).toBe(500);
    expect(backoff.next().nextDelayMs).toBe(500);
  });

  it('applies jitter', () => {
    const backoff = new Backoff(100, 10_000, () => 1);
    // 100 + 100 * 0.2 * 1 = 120
    expect(backoff.next().nextDelayMs).toBe(120);
  });

  it('resets the attempt counter', () => {
    const backoff = new Backoff(100, 10_000, () => 0);
    backoff.next();
    backoff.next();
    expect(backoff.attempts).toBe(2);
    backoff.reset();
    expect(backoff.attempts).toBe(0);
    expect(backoff.next().nextDelayMs).toBe(100);
  });
});

describe('withTimeout', () => {
  it('resolves a fast promise', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1_000, 'too slow')).resolves.toBe('done');
  });

  it('rejects a slow promise with a timeout BotError', async () => {
    const never = new Promise<string>(() => undefined);
    const error = await withTimeout(never, 10, 'took too long').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(BotError);
    expect((error as BotError).category).toBe('timeout');
    expect((error as BotError).message).toBe('took too long');
  });

  it('returns the original promise unchanged when ms is non-positive', async () => {
    await expect(withTimeout(Promise.resolve('instant'), 0, 'ignored')).resolves.toBe('instant');
  });
});

describe('CancellationToken', () => {
  it('starts uncancelled and flips on cancel', () => {
    const token = new CancellationToken();
    expect(token.isCancelled).toBe(false);
    token.cancel();
    expect(token.isCancelled).toBe(true);
  });

  it('throws a cancelled BotError only after cancellation', () => {
    const token = new CancellationToken();
    expect(() => token.throwIfCancelled()).not.toThrow();
    token.cancel();
    expect(() => token.throwIfCancelled()).toThrow(BotError);
    try {
      token.throwIfCancelled();
    } catch (error) {
      expect((error as BotError).category).toBe('cancelled');
    }
  });

  it('notifies a registered listener', () => {
    const token = new CancellationToken();
    let fired = 0;
    token.onCancel(() => {
      fired += 1;
    });
    token.cancel();
    expect(fired).toBe(1);
  });

  it('calling cancel twice is safe and fires the listener once', () => {
    const token = new CancellationToken();
    let fired = 0;
    token.onCancel(() => {
      fired += 1;
    });
    token.cancel();
    token.cancel();
    expect(fired).toBe(1);
  });

  it('fires a listener added after cancellation immediately', () => {
    const token = new CancellationToken();
    token.cancel();
    let fired = 0;
    token.onCancel(() => {
      fired += 1;
    });
    expect(fired).toBe(1);
  });

  it('allows a listener to be removed before cancellation', () => {
    const token = new CancellationToken();
    let fired = 0;
    const off = token.onCancel(() => {
      fired += 1;
    });
    off();
    token.cancel();
    expect(fired).toBe(0);
  });
});
