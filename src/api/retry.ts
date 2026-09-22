import {
  classifyError,
  isAbortError,
  MAX_RETRIES,
  ApiError,
} from './errorClassifier.ts';
import {
  recordRateLimitCooldown,
  waitForCooldown,
  abortableSleep,
} from './rateLimit.ts';
import {
  reportNetworkSuccess,
  reportNetworkFailure,
} from './networkStatus.ts';

export { abortableSleep } from './rateLimit.ts';

export interface RetryOptions {
  /**
   * Endpoint policy: whether this endpoint is safe to retry.
   * Defaults to false (safe-by-default). Read helpers (GET) and OCC mutations (PATCH)
   * explicitly pass true.
   */
  readonly retryable?: boolean;
  /**
   * Maximum number of retry attempts. Defaults to 3.
   */
  readonly maxRetries?: number;
  /**
   * AbortSignal to cancel in-flight requests, backoff timers, or cooldown waits.
   */
  readonly signal?: AbortSignal;
}

function checkAborted(signal?: AbortSignal, err?: unknown): void {
  if (signal?.aborted || (err !== undefined && isAbortError(err))) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }
}

function handleRateLimitCooldown(retryAfterMs?: number): void {
  if (retryAfterMs) {
    recordRateLimitCooldown(Date.now() + retryAfterMs);
  }
}

function reportNonRetryableNetworkStatus(err: unknown): void {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
    // 4xx errors prove server reachability
    reportNetworkSuccess();
  }
}

/**
 * Executes an async operation with structural error classification, exponential backoff + jitter,
 * rate limit cooldown waiting, and two-layer retry gating.
 */
export async function requestWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const isEndpointRetryable = options?.retryable ?? false;
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const signal = options?.signal;

  let attempt = 0;

  while (true) {
    // 1. Wait for any global/shared rate limit cooldown without consuming retry attempts
    await waitForCooldown(signal);
    checkAborted(signal);

    try {
      const result = await fn(attempt);
      // Terminal success outcome reached server
      reportNetworkSuccess();
      return result;
    } catch (err: unknown) {
      // Cancellation is not a failure — rethrow immediately without recording network failure
      checkAborted(signal, err);

      const classification = classifyError(err, attempt);
      handleRateLimitCooldown(classification.retryAfterMs);

      const canRetry = isEndpointRetryable && classification.retryable && attempt < maxRetries;
      if (canRetry) {
        attempt++;
        await abortableSleep(classification.backoffMs, signal);
        continue;
      }

      // Terminal failure path
      if (classification.retryable) {
        reportNetworkFailure();
      } else {
        reportNonRetryableNetworkStatus(err);
      }
      throw err;
    }
  }
}
