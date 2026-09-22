import { isAbortError } from './errorClassifier.ts';

let rateLimitUntil = 0;

/**
 * Record a rate-limit cooldown ending at targetTimestampMs (wall-clock Date.now()).
 * Monotonically extends rateLimitUntil using Math.max.
 */
export function recordRateLimitCooldown(targetTimestampMs: number): void {
  rateLimitUntil = Math.max(rateLimitUntil, targetTimestampMs);
}

/**
 * Abort-aware sleep helper. Rejects immediately with AbortError if signal is already aborted
 * or becomes aborted while sleeping.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
  }
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onAbort = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Waits out any active rate-limit cooldown before firing a request.
 * Throws AbortError immediately if signal is aborted.
 * NOTE: Waiting for cooldown does NOT count against retry attempt limits.
 */
export async function waitForCooldown(signal?: AbortSignal): Promise<void> {
  const remaining = rateLimitUntil - Date.now();
  if (remaining > 0) {
    try {
      await abortableSleep(remaining, signal);
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      throw err;
    }
  } else if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }
}

export function getRateLimitUntil(): number {
  return rateLimitUntil;
}

export function resetRateLimitForTesting(): void {
  rateLimitUntil = 0;
}
