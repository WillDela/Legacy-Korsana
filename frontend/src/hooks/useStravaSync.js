import { useCallback, useEffect, useRef, useState } from 'react';
import { stravaAPI } from '../api/strava';
import { getErrorMessage } from '../api/client';
import { formatStravaSyncMessage } from '../lib/stravaRedirect';

// useStravaSync centralizes the sync-in-flight state, the auto-clearing status
// message, and the try/catch/finally around stravaAPI.syncActivities() that
// Dashboard, Calendar, and Settings previously each reimplemented separately.
// It intentionally does NOT own `stravaConnected` (page-local — drives
// Connect-vs-Sync button branching) or OAuth-redirect detection (page-local —
// some pages do extra work in that effect, e.g. switching tabs).
export function useStravaSync({ onSuccess, onNotConnected } = {}) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState({ text: '', type: '' });
  const timerRef = useRef(null);

  const showMessage = useCallback((text, type = 'success', timeoutMs = 5000) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSyncMessage({ text, type });
    if (timeoutMs > 0) {
      timerRef.current = window.setTimeout(() => {
        setSyncMessage({ text: '', type: '' });
        timerRef.current = null;
      }, timeoutMs);
    }
  }, []);

  const sync = useCallback(async ({ afterConnect = false } = {}) => {
    setSyncing(true);
    try {
      const result = await stravaAPI.syncActivities();
      showMessage(formatStravaSyncMessage(result, { afterConnect }), 'success', 5000);
      await onSuccess?.(result);
      return { ok: true, result };
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 404) {
        showMessage('Strava is not connected yet. Finish setup in Settings.', 'error', 5000);
        onNotConnected?.();
      } else if (err?.code === 'ECONNABORTED') {
        showMessage('Sync timed out. Try again.', 'error', 5000);
      } else {
        showMessage(getErrorMessage(err), 'error', 5000);
      }
      return { ok: false, error: err };
    } finally {
      setSyncing(false);
    }
  }, [onSuccess, onNotConnected, showMessage]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { syncing, syncMessage, sync, showMessage };
}
