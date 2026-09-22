import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * Root-level offline and reachability status banner.
 * Uses aria-live="polite" for screen reader announcements.
 * Distinguishes device offline from server unreachable.
 */
export function OfflineBanner() {
  const { isOnline, osOnline, serverReachable } = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  let message = '';
  let subtext = '';

  if (!osOnline) {
    message = 'You are currently offline';
    subtext = 'Check your network connection. You may need to retry actions when you reconnect.';
  } else if (!serverReachable) {
    message = 'Server is currently unreachable';
    subtext = 'Temporary connection drop. Reconnecting automatically…';
  }

  return (
    <div
      className="offline-banner"
      role="status"
      aria-live="polite"
    >
      <div className="offline-banner__content">
        <span className="offline-banner__dot" aria-hidden="true" />
        <div>
          <strong>{message}. </strong>
          <span>{subtext}</span>
        </div>
      </div>
    </div>
  );
}
