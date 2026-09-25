// Detects when a newer deployment of this app is already live, so the UI
// can offer (and, once the user's been idle, apply on its own) a refresh
// instead of silently running stale code until the tab is closed and
// reopened - the standalone/PWA icon many phones use for this app doesn't
// reliably do that on its own. See next.config.js's generateBuildId for
// where the ID compared here actually comes from.

export function getCurrentBuildId() {
  if (typeof window === 'undefined') return null;
  return window.__NEXT_DATA__?.buildId || null;
}

// Next.js inlines the page's own data (including buildId) as
// `<script id="__NEXT_DATA__" type="application/json">{...}</script>` in
// the HTML it serves - fetching the page fresh and pulling that value back
// out is the cheapest way to ask "what build is the server on right now"
// without a dedicated API route.
export function extractBuildId(html) {
  const match = String(html || '').match(/"buildId":"([^"]+)"/);
  return match ? match[1] : null;
}

export async function fetchLatestBuildId() {
  // cache: 'no-store' only bypasses the browser's own cache - it does
  // nothing about a CDN/edge cache in front of the origin, which can still
  // serve a stale HTML shell for the plain "/" URL. A unique query string
  // makes every check its own cache key, so it always reaches the origin.
  const res = await fetch(`/?_cb=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return extractBuildId(await res.text());
}

// True only when both IDs were actually readable AND differ - a fetch
// failure or a page that for some reason has no buildId of its own is
// "unknown", never treated as "yes there's an update", so a flaky check
// never falsely tells the user to reload.
export async function isUpdateAvailable() {
  const current = getCurrentBuildId();
  if (!current) return false;
  const latest = await fetchLatestBuildId();
  if (!latest) return false;
  return latest !== current;
}
