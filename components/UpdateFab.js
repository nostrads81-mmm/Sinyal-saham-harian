import { useEffect, useRef, useState } from 'react';
import { isUpdateAvailable } from '../lib/version';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_CHECK_INTERVAL_MS = 15 * 1000;
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // no interaction for 5 minutes
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'];

// A small, always-there refresh button (mounted once in _app.js, floating
// above the bottom nav on every page). Most of the time it's just a manual
// "reload the app" shortcut. Once a newer deployment is detected it starts
// blinking - and if the user's gone idle since then (so there's nothing
// on screen left to lose), it reloads on its own rather than waiting on a
// click that may never come, e.g. an installed home-screen icon left open
// for days. Idle time alone, with no update pending, never triggers a
// reload - there'd be nothing to gain and a mid-edit form to lose.
export default function UpdateFab() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const hasUpdateRef = useRef(false);

  useEffect(() => {
    const markActive = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));

    async function check() {
      const found = await isUpdateAvailable().catch(() => false);
      if (found) {
        hasUpdateRef.current = true;
        setHasUpdate(true);
      }
    }

    // Catches a deploy that landed while this tab was in the background the
    // moment the user comes back to it, not just on the next fixed tick of
    // the interval below.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') check();
    }

    check();
    const checkInterval = setInterval(check, CHECK_INTERVAL_MS);
    // Runs far more often than the update check itself - it's cheap (no
    // network), and only needs to notice "still idle, update still
    // pending" soon after the threshold passes, not exactly at it.
    const idleInterval = setInterval(() => {
      if (!hasUpdateRef.current) return;
      if (Date.now() - lastActivityRef.current >= IDLE_THRESHOLD_MS) {
        window.location.reload();
      }
    }, IDLE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActive));
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(checkInterval);
      clearInterval(idleInterval);
    };
  }, []);

  return (
    <button
      type="button"
      className={`update-fab ${hasUpdate ? 'has-update' : ''}`}
      onClick={() => window.location.reload()}
      aria-label={hasUpdate ? 'Versi baru tersedia - muat ulang' : 'Muat ulang halaman'}
      title={hasUpdate ? 'Versi baru tersedia - klik untuk muat ulang' : 'Muat ulang halaman'}
    >
      &#8635;
    </button>
  );
}
