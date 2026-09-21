// localStorage writes can throw, unlike reads which the app already guards
// with try/catch: Safari/Firefox in private mode, a full storage quota, or a
// browser with site storage disabled outright. Without this, tapping "hapus",
// "skip", or a theme button in such a window surfaced a raw exception instead
// of doing its job - while the same data lives happily in the sheet anyway.
// Losing the local preference is an acceptable failure; a broken tap is not.
export function safeSetItem(key, value) {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Same reasoning for reads: a browser with storage disabled can throw a
// SecurityError on getItem too, and a preference we cannot read is simply a
// preference we do not have (null), not a reason to break the page.
export function safeGetItem(key) {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeRemoveItem(key) {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}