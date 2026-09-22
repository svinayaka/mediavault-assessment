export interface NetworkStatus {
  readonly osOnline: boolean;
  readonly serverReachable: boolean;
  readonly lastFailureAt: number | null;
}

export const MAX_CONSECUTIVE_FAILURES = 3;
export const NETWORK_FAILURE_WINDOW_MS = 10_000;

let state: NetworkStatus = {
  osOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  serverReachable: true,
  lastFailureAt: null,
};

let recentFailures: number[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Prunes failure timestamps outside the rolling 10s window.
 */
function pruneRecentFailures(now: number) {
  recentFailures = recentFailures.filter((ts) => now - ts < NETWORK_FAILURE_WINDOW_MS);
}

/**
 * Report a terminal outcome reaching the server (2xx, 3xx, 4xx).
 * Proves server reachability and resets consecutive failure counters.
 */
export function reportNetworkSuccess(): void {
  const hadFailures = recentFailures.length > 0;
  recentFailures = [];

  if (!state.serverReachable || hadFailures) {
    state = {
      ...state,
      serverReachable: true,
    };
    notify();
  }
}

/**
 * Report a terminal retryable-class failure (exhausted 5xx, exhausted 429, or network TypeError).
 * If MAX_CONSECUTIVE_FAILURES occurs within NETWORK_FAILURE_WINDOW_MS, marks serverReachable = false.
 */
export function reportNetworkFailure(): void {
  const now = Date.now();
  pruneRecentFailures(now);
  recentFailures.push(now);

  const reachable = recentFailures.length < MAX_CONSECUTIVE_FAILURES;
  const changed = state.serverReachable !== reachable || state.lastFailureAt !== now;

  state = {
    ...state,
    serverReachable: reachable,
    lastFailureAt: now,
  };

  if (changed) {
    notify();
  }
}

/**
 * Initialize window online/offline event listeners.
 * Called once at application boot in main.tsx.
 */
export function initializeNetworkStatus(): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleOnline = () => {
    state = { ...state, osOnline: true };
    notify();
  };

  const handleOffline = () => {
    state = { ...state, osOnline: false };
    notify();
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getSnapshot(): NetworkStatus {
  return state;
}

export function resetNetworkStatusForTesting(): void {
  state = {
    osOnline: true,
    serverReachable: true,
    lastFailureAt: null,
  };
  recentFailures = [];
  notify();
}
