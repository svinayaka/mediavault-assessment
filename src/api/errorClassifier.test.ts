import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyError,
  getActionableErrorMessage,
  ApiError,
  computeBackoffWithJitter,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
} from './errorClassifier.ts';

test('errorClassifier test matrix', async (t) => {
  await t.test('1. 503 Service Unavailable → retryable with retryAfterMs when present', () => {
    const err = new ApiError('Service Unavailable', 503, 'service_unavailable', 2000);
    const res = classifyError(err, 0);
    assert.equal(res.retryable, true);
    assert.equal(res.reason, 'service_unavailable');
    assert.equal(res.retryAfterMs, 2000);
    assert.ok(res.backoffMs >= 2000);
  });

  await t.test('2. 429 Too Many Requests → retryable with retryAfterMs', () => {
    const err = new ApiError('Rate limit exceeded', 429, 'rate_limit', 3000);
    const res = classifyError(err, 1);
    assert.equal(res.retryable, true);
    assert.equal(res.reason, 'rate_limit');
    assert.equal(res.retryAfterMs, 3000);
    assert.ok(res.backoffMs >= 3000);
  });

  await t.test('3. 500 Internal Server Error → retryable (transient server error)', () => {
    const err = new ApiError('Internal Server Error', 500);
    const res = classifyError(err, 0);
    assert.equal(res.retryable, true);
    assert.equal(res.reason, 'server_error');
    assert.ok(res.backoffMs >= BASE_DELAY_MS);
  });

  await t.test('4. 400 Bad Request / Stale Cursor → non-retryable', () => {
    const err = new ApiError('stale_cursor', 400, 'stale_cursor');
    const res = classifyError(err, 0);
    assert.equal(res.retryable, false);
    assert.equal(res.reason, 'bad_request');
    assert.equal(res.backoffMs, 0);
  });

  await t.test('5. 409 Conflict → non-retryable', () => {
    const err = new ApiError('version_conflict', 409, 'version_conflict');
    const res = classifyError(err, 0);
    assert.equal(res.retryable, false);
    assert.equal(res.reason, 'conflict');
    assert.equal(res.backoffMs, 0);
  });

  await t.test('6. 422 Unprocessable Entity → non-retryable', () => {
    const err = new ApiError('validation_error', 422, 'validation_error');
    const res = classifyError(err, 0);
    assert.equal(res.retryable, false);
    assert.equal(res.reason, 'validation');
    assert.equal(res.backoffMs, 0);
  });

  await t.test('7. AbortError → non-retryable cancellation', () => {
    const abortErr = new DOMException('The operation was aborted', 'AbortError');
    const res = classifyError(abortErr, 0);
    assert.equal(res.retryable, false);
    assert.equal(res.reason, 'abort');
    assert.equal(res.backoffMs, 0);
  });

  await t.test('8. TypeError ("Failed to fetch") → retryable network drop', () => {
    const netErr = new TypeError('Failed to fetch');
    const res = classifyError(netErr, 0);
    assert.equal(res.retryable, true);
    assert.equal(res.reason, 'network_error');
    assert.ok(res.backoffMs >= BASE_DELAY_MS);
  });

  await t.test('9. Unknown object → defaults to retryable with reason "unknown"', () => {
    const customErr = { weirdShape: true };
    const res = classifyError(customErr, 0);
    assert.equal(res.retryable, true);
    assert.equal(res.reason, 'unknown');
  });

  await t.test('10. Other 5xx (502/504) → retryable server error', () => {
    const err = new ApiError('Bad Gateway', 502);
    const res = classifyError(err, 0);
    assert.equal(res.retryable, true);
    assert.equal(res.reason, 'server_error');
  });

  await t.test('11. Structural Test 1: Error("503 Service Unavailable") is NOT matched by string', () => {
    const stringErr = new Error('503 Service Unavailable');
    const res = classifyError(stringErr, 0);
    // Must fall through to unknown because status is not a structural property
    assert.equal(res.reason, 'unknown');
    assert.notEqual(res.reason, 'service_unavailable');
  });

  await t.test('12. Structural Test 2: { message: "Rate limit exceeded", status: 200 } is NOT matched by string', () => {
    const spoofErr = { message: 'Rate limit exceeded', status: 200 };
    const res = classifyError(spoofErr, 0);
    assert.equal(res.reason, 'unknown');
    assert.notEqual(res.reason, 'rate_limit');
  });

  await t.test('13. Backoff calculation enforces min and max bounds', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const backoff = computeBackoffWithJitter(attempt);
      assert.ok(backoff >= BASE_DELAY_MS);
      assert.ok(backoff <= MAX_DELAY_MS);
    }
  });

  await t.test('14. Actionable error message generation produces clean, contextual copy', () => {
    const rateLimitErr = new ApiError('429: Too many requests in the last 10 seconds.', 429);
    const msg = getActionableErrorMessage(rateLimitErr, { operation: 'search' });
    assert.match(msg, /Server is busy/i);
    assert.doesNotMatch(msg, /429/);
    assert.doesNotMatch(msg, /10 seconds/);

    // Rate limit with bulk_update count
    const bulkMsgWithCount = getActionableErrorMessage(rateLimitErr, { operation: 'bulk_update', count: 5 });
    assert.equal(bulkMsgWithCount, 'Server is busy. Pausing bulk update for 5 items…');

    // Rate limit with bulk_update without count
    const bulkMsgNoCount = getActionableErrorMessage(rateLimitErr, { operation: 'bulk_update' });
    assert.equal(bulkMsgNoCount, 'Server is busy. Retrying bulk update in a moment…');

    // Server error / service unavailable
    const serverErr = new ApiError('Service Unavailable', 503);
    assert.equal(
      getActionableErrorMessage(serverErr, { operation: 'load_more' }),
      'Temporary server interruption. Click Retry to continue loading.',
    );

    // Conflict
    const conflictErr = new ApiError('Conflict', 409);
    assert.equal(
      getActionableErrorMessage(conflictErr, { operation: 'save_asset' }),
      'This asset was modified elsewhere. Review latest changes before saving.',
    );

    // Network error
    const netErr = new TypeError('Failed to fetch');
    assert.equal(
      getActionableErrorMessage(netErr, { operation: 'search' }),
      'Network connection interrupted. Reconnecting when your network returns…',
    );

    // Abort error
    const abortErr = new DOMException('Aborted', 'AbortError');
    assert.equal(getActionableErrorMessage(abortErr, { operation: 'search' }), '');

    // Unconfirmed write
    const unconfirmedErr = new ApiError('Unconfirmed', 0, 'write_unconfirmed', undefined, true);
    const unconfirmedMsg = getActionableErrorMessage(unconfirmedErr, { operation: 'save_asset' });
    assert.match(unconfirmedMsg, /unconfirmed/i);
  });
});
