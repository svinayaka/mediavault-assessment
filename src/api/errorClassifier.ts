export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterMs?: number;
  readonly unconfirmed?: boolean;

  constructor(
    message: string,
    status: number,
    code?: string,
    retryAfterMs?: number,
    unconfirmed?: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.unconfirmed = unconfirmed;
  }
}

export interface ErrorClassification {
  /**
   * Structural error classification: whether this error is transient in nature.
   * NOTE: A request only retries if BOTH `classification.retryable` is true AND
   * the calling endpoint explicitly opts in via `options.retryable: true`.
   */
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly backoffMs: number;
  readonly reason:
    | 'rate_limit'
    | 'service_unavailable'
    | 'server_error'
    | 'network_error'
    | 'conflict'
    | 'bad_request'
    | 'validation'
    | 'client_error'
    | 'abort'
    | 'unknown';
}

export interface ErrorContext {
  readonly operation: 'search' | 'load_more' | 'bulk_update' | 'save_asset' | 'load_asset';
  readonly count?: number;
}

export const BASE_DELAY_MS = 200;
export const MAX_DELAY_MS = 3000;
export const MAX_RETRIES = 3;

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number };
  return e.name === 'AbortError' || e.code === 20;
}

function getRandomFraction(): number {
  const array = new Uint32Array(1);
  globalThis.crypto.getRandomValues(array);
  return (array[0] ?? 0) / (0xffffffff + 1);
}

export function computeBackoffWithJitter(
  attempt: number,
  baseMs = BASE_DELAY_MS,
  maxMs = MAX_DELAY_MS,
): number {
  // Exponential backoff: base * 2^attempt with full random jitter
  const expDelay = baseMs * Math.pow(2, attempt);
  const jittered = getRandomFraction() * expDelay;
  return Math.min(maxMs, Math.max(baseMs, Math.floor(jittered)));
}

interface ExtractedErrorMeta {
  readonly status?: number;
  readonly retryAfterMs?: number;
}

function extractErrorMeta(err: unknown): ExtractedErrorMeta {
  if (err instanceof ApiError) {
    return { status: err.status, retryAfterMs: err.retryAfterMs };
  }
  if (typeof err === 'object' && err !== null) {
    const rec = err as Record<string, unknown>;
    return {
      status: typeof rec.status === 'number' ? rec.status : undefined,
      retryAfterMs: typeof rec.retryAfterMs === 'number' ? rec.retryAfterMs : undefined,
    };
  }
  return {};
}

function classifyHttpStatus(
  status: number,
): { retryable: boolean; reason: ErrorClassification['reason'] } | undefined {
  if (status === 429) {
    return { retryable: true, reason: 'rate_limit' };
  }
  if (status === 503) {
    return { retryable: true, reason: 'service_unavailable' };
  }
  if (status === 500 || status >= 502) {
    return { retryable: true, reason: 'server_error' };
  }
  if (status === 400) {
    return { retryable: false, reason: 'bad_request' };
  }
  if (status === 409) {
    return { retryable: false, reason: 'conflict' };
  }
  if (status === 422) {
    return { retryable: false, reason: 'validation' };
  }
  if (status >= 400 && status < 500) {
    return { retryable: false, reason: 'client_error' };
  }
  return undefined;
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.name === 'TypeError');
}

function calculateBackoff(attempt: number, retryAfterMs?: number): number {
  const delay = computeBackoffWithJitter(attempt);
  return retryAfterMs ? Math.max(delay, retryAfterMs) : delay;
}

/**
 * Pure, isolated classifier for network and API errors.
 * Inspects error structure (status code, properties, error name) without string regex matching.
 *
 * Transient errors (503, 429, 500, network drops, unknown) are classified as retryable.
 * Permanent errors (400, 409, 422, AbortError) are strictly non-retryable.
 */
export function classifyError(err: unknown, attempt = 0): ErrorClassification {
  if (isAbortError(err)) {
    return {
      retryable: false,
      backoffMs: 0,
      reason: 'abort',
    };
  }

  const { status, retryAfterMs } = extractErrorMeta(err);
  const backoffMs = calculateBackoff(attempt, retryAfterMs);

  if (status !== undefined) {
    const httpClassification = classifyHttpStatus(status);
    if (httpClassification) {
      return {
        retryable: httpClassification.retryable,
        retryAfterMs,
        backoffMs: httpClassification.retryable ? backoffMs : 0,
        reason: httpClassification.reason,
      };
    }
  }

  // Network drops (e.g. TypeError: Failed to fetch)
  if (isNetworkError(err)) {
    return {
      retryable: true,
      backoffMs,
      reason: 'network_error',
    };
  }

  // Unknown / unclassified errors default to transient/retryable (if caller opts in)
  return {
    retryable: true,
    backoffMs,
    reason: 'unknown',
  };
}

const SERVER_ERROR_MESSAGES: Record<ErrorContext['operation'], string> = {
  search: 'Temporary server interruption. Refreshing search results…',
  load_more: 'Temporary server interruption. Click Retry to continue loading.',
  bulk_update: 'Temporary server issue during bulk update. Retryable items can be retried.',
  save_asset: 'Temporary server error while saving. Please try again.',
  load_asset: 'Temporary server error loading asset. Please try again.',
};

const STATIC_ERROR_MESSAGES: Partial<Record<ErrorClassification['reason'], string>> = {
  conflict: 'This asset was modified elsewhere. Review latest changes before saving.',
  bad_request: 'The requested query or page is no longer valid. Resetting view.',
  network_error: 'Network connection interrupted. Reconnecting when your network returns…',
};

function getRateLimitMessage(context: ErrorContext): string {
  if (context.operation === 'bulk_update' && context.count) {
    return `Server is busy. Pausing bulk update for ${context.count} items…`;
  }
  const messages: Record<ErrorContext['operation'], string> = {
    search: 'Server is busy. Automatically updating search results in a moment…',
    load_more: 'Server is busy. Retrying to load more assets…',
    bulk_update: 'Server is busy. Retrying bulk update in a moment…',
    save_asset: 'Server is busy. Retrying asset save…',
    load_asset: 'Server is busy. Retrying to load asset details…',
  };
  return messages[context.operation];
}

/**
 * Transforms raw errors and status codes into human-friendly, actionable user copy.
 * Avoids leaking raw backend implementation strings (e.g. "429: Too many requests...").
 */
export function getActionableErrorMessage(err: unknown, context: ErrorContext): string {
  if (isAbortError(err)) {
    return '';
  }

  const classification = classifyError(err);
  const { reason } = classification;

  if (reason === 'rate_limit') {
    return getRateLimitMessage(context);
  }

  if (reason === 'service_unavailable' || reason === 'server_error') {
    return SERVER_ERROR_MESSAGES[context.operation];
  }

  const staticMessage = STATIC_ERROR_MESSAGES[reason];
  if (staticMessage) {
    return staticMessage;
  }

  if (err instanceof ApiError && err.unconfirmed) {
    return 'Network dropped during save; write outcome is unconfirmed. Reload asset to verify.';
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return 'An unexpected issue occurred. Please try again.';
}

