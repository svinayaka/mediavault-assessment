import test from 'node:test';
import assert from 'node:assert/strict';
import { requestWithRetry } from './retry.ts';
import { ApiError } from './errorClassifier.ts';
import {
  recordRateLimitCooldown,
  resetRateLimitForTesting,
  getRateLimitUntil,
} from './rateLimit.ts';
import {
  getSnapshot,
  resetNetworkStatusForTesting,
} from './networkStatus.ts';

test('requestWithRetry test suite', async (t) => {
  t.beforeEach(() => {
    resetRateLimitForTesting();
    resetNetworkStatusForTesting();
  });

  await t.test('1. retryable: false does NOT retry even on 503 Service Unavailable', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new ApiError('Service Unavailable', 503);
    };

    await assert.rejects(
      () => requestWithRetry(fn, { retryable: false }),
      (err: ApiError) => err.status === 503,
    );

    assert.equal(callCount, 1);
  });

  await t.test('2. retryable: true retries transient failures and succeeds on subsequent attempt', async () => {
    let callCount = 0;
    const fn = async (attempt: number) => {
      callCount++;
      if (attempt < 2) {
        throw new ApiError('Transient error', 503);
      }
      return { success: true, attempt };
    };

    const result = await requestWithRetry(fn, { retryable: true });
    assert.deepEqual(result, { success: true, attempt: 2 });
    assert.equal(callCount, 3);
    assert.equal(getSnapshot().serverReachable, true);
  });

  await t.test('3. Non-retryable error (400 stale_cursor) fails immediately without retry', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new ApiError('stale_cursor', 400, 'stale_cursor');
    };

    await assert.rejects(
      () => requestWithRetry(fn, { retryable: true }),
      (err: ApiError) => err.status === 400,
    );

    assert.equal(callCount, 1);
    // 400 reached the server, so serverReachable remains true
    assert.equal(getSnapshot().serverReachable, true);
  });

  await t.test('4. Retry-After header sets shared rateLimitUntil cooldown timestamp', async () => {
    let callCount = 0;
    const before = Date.now();
    const fn = async () => {
      callCount++;
      throw new ApiError('Rate limit exceeded', 429, 'rate_limit', 1500);
    };

    await assert.rejects(
      () => requestWithRetry(fn, { retryable: false }),
      (err: ApiError) => err.status === 429,
    );

    assert.equal(callCount, 1);
    assert.ok(getRateLimitUntil() >= before + 1400);
  });

  await t.test('5. Cooldown waiting does NOT burn retry attempts', async () => {
    // Set an active cooldown of 200ms
    recordRateLimitCooldown(Date.now() + 200);

    let callCount = 0;
    const fn = async (attempt: number) => {
      callCount++;
      if (attempt === 0) {
        throw new ApiError('Flaky 503', 503);
      }
      return 'ok';
    };

    const result = await requestWithRetry(fn, { retryable: true });
    assert.equal(result, 'ok');
    // First call succeeded on attempt index 1 (2 calls total)
    assert.equal(callCount, 2);
  });

  await t.test('6. AbortSignal cancels mid-backoff and rejects immediately with AbortError', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const fn = async () => {
      callCount++;
      // Abort after first failed attempt while backoff is waiting
      setTimeout(() => controller.abort(), 20);
      throw new ApiError('Transient failure', 503);
    };

    await assert.rejects(
      () => requestWithRetry(fn, { retryable: true, signal: controller.signal }),
      (err: DOMException) => err.name === 'AbortError',
    );

    assert.equal(callCount, 1);
  });

  await t.test('7. Capped at maxRetries (default 3 retries = 4 total attempts)', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new ApiError('Continuous 503', 503);
    };

    await assert.rejects(
      () => requestWithRetry(fn, { retryable: true }),
      (err: ApiError) => err.status === 503,
    );

    assert.equal(callCount, 4); // attempt 0, 1, 2, 3
  });
});
