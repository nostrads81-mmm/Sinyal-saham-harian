// Google sign-in via Google Identity Services (GIS) token client.
// Client-side only. Requests an OAuth access token scoped to Sheets and
// Drive, used directly by the browser to read/write the user's own Google
// Sheets - this app's backend never sees the user's Drive/Sheets data or
// token. drive.file (not full Drive access) is enough to create the
// per-account app-data spreadsheet on first use and find it again later -
// it only ever sees files this app itself created.
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

// Two independent login slots, each with its own storage keys, so a browser
// can hold a sign-in for the shared Watchlist source account at the same
// time as a different sign-in for the user's own Sinyal/Rekapan account -
// e.g. Watchlist reads a community-curated sheet under one Google account
// while Sinyal/Rekapan write to another. 'main' keeps the original key names
// so existing sign-ins aren't invalidated by this split.
function storageKeys(purpose) {
  if (purpose === 'watchlist') {
    return { token: 'gsheets_access_token_watchlist', expiry: 'gsheets_access_token_watchlist_expiry' };
  }
  return { token: 'gsheets_access_token', expiry: 'gsheets_access_token_expiry' };
}

let gisLoadedPromise = null;

function loadGisScript() {
  if (gisLoadedPromise) return gisLoadedPromise;
  gisLoadedPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('client-only'));
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Gagal memuat Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadedPromise;
}

export function getStoredToken(purpose = 'main') {
  if (typeof window === 'undefined') return null;
  const keys = storageKeys(purpose);
  const token = localStorage.getItem(keys.token);
  const expiry = Number(localStorage.getItem(keys.expiry) || 0);
  if (!token || Date.now() > expiry) return null;
  return token;
}

function storeToken(token, expiresInSeconds, purpose = 'main') {
  const keys = storageKeys(purpose);
  localStorage.setItem(keys.token, token);
  localStorage.setItem(keys.expiry, String(Date.now() + expiresInSeconds * 1000 - 60000));
}

export function signOut(purpose = 'main') {
  if (typeof window === 'undefined') return;
  const token = getStoredToken(purpose);
  const keys = storageKeys(purpose);
  localStorage.removeItem(keys.token);
  localStorage.removeItem(keys.expiry);
  if (purpose === 'main') {
    // Also drop the cached app-data spreadsheet ID (see getOrCreateAppDataSheetId
    // in lib/sheets.js) - it's tied to whichever Google account was signed in,
    // so a different account signing in on this browser next must re-resolve
    // its own sheet instead of silently reusing this one's. The 'watchlist'
    // slot never touches this cache - it only ever reads the one fixed
    // shared source sheet, not a per-account one.
    localStorage.removeItem('app_data_sheet_id');
  }
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
}

// Returns a valid access token, prompting the Google sign-in popup only
// when there is no cached, unexpired token. `purpose` selects which of the
// two independent login slots to use - see storageKeys above.
export async function getAccessToken(purpose = 'main') {
  const cached = getStoredToken(purpose);
  if (cached) return cached;

  await loadGisScript();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('NEXT_PUBLIC_GOOGLE_CLIENT_ID belum diset');

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        storeToken(response.access_token, response.expires_in, purpose);
        resolve(response.access_token);
      },
    });
    client.requestAccessToken();
  });
}

// Forces a brand new access token instead of trusting the cached one - used
// when the API itself rejects the cached token with a 401, which happens if
// the token expired mid-session (our local expiry check only runs when a
// page first loads, not before every save) or was revoked. Since the scope
// was already granted, Google Identity Services normally refreshes this
// silently (no visible popup) as long as the session is still valid.
export async function refreshAccessToken(purpose = 'main') {
  if (typeof window !== 'undefined') {
    const keys = storageKeys(purpose);
    localStorage.removeItem(keys.token);
    localStorage.removeItem(keys.expiry);
  }
  return getAccessToken(purpose);
}
