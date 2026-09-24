// Google sign-in via Google Identity Services (GIS) token client.
// Client-side only. Requests an OAuth access token scoped to Sheets and
// Drive, used directly by the browser to read/write the user's own Google
// Sheets - this app's backend never sees the user's Drive/Sheets data or
// token. drive.file (not full Drive access) is enough to create the
// per-account app-data spreadsheet on first use and find it again later -
// it only ever sees files this app itself created.
import { safeGetItem, safeSetItem, safeRemoveItem } from './storage';

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
  const token = safeGetItem(TOKEN_STORAGE_KEY);
  const expiry = Number(safeGetItem(TOKEN_EXPIRY_KEY) || 0);
  if (!token || Date.now() > expiry) return null;
  return token;
}

function storeToken(token, expiresInSeconds) {
  safeSetItem(TOKEN_STORAGE_KEY, token);
  safeSetItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000 - 60000));
}

export function signOut() {
  if (typeof window === 'undefined') return;
  const token = getStoredToken();
  safeRemoveItem(TOKEN_STORAGE_KEY);
  safeRemoveItem(TOKEN_EXPIRY_KEY);
  // Also drop the cached app-data spreadsheet ID (see getOrCreateAppDataSheetId
  // in lib/sheets.js) - it's tied to whichever Google account was signed in,
  // so a different account signing in on this browser next must re-resolve
  // its own sheet instead of silently reusing this one's.
  safeRemoveItem('app_data_sheet_id');
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

// Tries to get a token with NO visible popup - only succeeds if the browser
// still has an active Google session and this app's scopes were already
// granted before (e.g. the same browser, a later visit). Used on page load so
// returning users don't have to click "Sign in" again just because the
// cached token from last time expired - if silent issuance isn't possible
// (first visit, revoked access, third-party cookies blocked), this resolves
// null instead of throwing, and the normal sign-in button still works.
export async function trySilentSignIn() {
  if (typeof window === 'undefined') return null;
  try {
    await loadGisScript();
  } catch {
    return null;
  }
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // Some browsers (Safari ITP, certain private modes) block the silent
    // flow's third-party storage access and never call back at all instead
    // of erroring - without this timeout the page would be stuck "loading"
    // forever rather than falling back to the sign-in button.
    const timeoutId = setTimeout(() => finish(null), 4000);
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        prompt: '',
        callback: (response) => {
          clearTimeout(timeoutId);
          if (response.error || !response.access_token) {
            finish(null);
            return;
          }
          storeToken(response.access_token, response.expires_in);
          finish(response.access_token);
        },
        error_callback: () => {
          clearTimeout(timeoutId);
          finish(null);
        },
      });
      client.requestAccessToken();
    } catch {
      clearTimeout(timeoutId);
      finish(null);
    }
  });
}

// What every page's mount effect calls: reuse the cached token if it's still
// valid, otherwise try a silent, popup-free sign-in before giving up and
// showing the "Sign in dengan Google" button.
export async function resolveInitialToken() {
  const cached = getStoredToken();
  if (cached) return cached;
  return trySilentSignIn();
}

// Forces a brand new access token instead of trusting the cached one - used
// when the API itself rejects the cached token with a 401, which happens if
// the token expired mid-session (our local expiry check only runs when a
// page first loads, not before every save) or was revoked. Since the scope
// was already granted, Google Identity Services normally refreshes this
// silently (no visible popup) as long as the session is still valid.
export async function refreshAccessToken() {
  safeRemoveItem(TOKEN_STORAGE_KEY);
  safeRemoveItem(TOKEN_EXPIRY_KEY);
  return getAccessToken();
}
