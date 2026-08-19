// Google sign-in via Google Identity Services (GIS) token client.
// Client-side only. Requests an OAuth access token scoped to Sheets and
// Drive, used directly by the browser to read/write the user's own Google
// Sheets - this app's backend never sees the user's Drive/Sheets data or
// token. drive.file (not full Drive access) is enough to create the
// per-account app-data spreadsheet on first use and find it again later -
// it only ever sees files this app itself created.
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
const TOKEN_STORAGE_KEY = 'gsheets_access_token';
const TOKEN_EXPIRY_KEY = 'gsheets_access_token_expiry';

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

export function getStoredToken() {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const expiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
  if (!token || Date.now() > expiry) return null;
  return token;
}

function storeToken(token, expiresInSeconds) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000 - 60000));
}

export function signOut() {
  if (typeof window === 'undefined') return;
  const token = getStoredToken();
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
}

// Returns a valid access token, prompting the Google sign-in popup only
// when there is no cached, unexpired token.
export async function getAccessToken() {
  const cached = getStoredToken();
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
        storeToken(response.access_token, response.expires_in);
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
export async function refreshAccessToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  }
  return getAccessToken();
}
