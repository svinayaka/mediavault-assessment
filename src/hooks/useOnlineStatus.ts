import { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot, type NetworkStatus } from '@/api/networkStatus';

const serverSnapshot: NetworkStatus = {
  osOnline: true,
  serverReachable: true,
  lastFailureAt: null,
};

export interface OnlineStatus extends NetworkStatus {
  readonly isOnline: boolean;
}

/**
 * Subscribes to the external vanilla networkStatus store via useSyncExternalStore.
 * Combines OS online status (navigator.onLine) and synthetic server reachability.
 */
export function useOnlineStatus(): OnlineStatus {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => serverSnapshot,
  );

  return {
    ...snapshot,
    isOnline: snapshot.osOnline && snapshot.serverReachable,
  };
}
