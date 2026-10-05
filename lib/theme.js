import { safeGetItem, safeSetItem } from './storage';

const THEME_KEY = 'ssh_theme';
const TEXT_SCALE_KEY = 'ssh_text_scale';
const BOLD_KEY = 'ssh_bold_text';

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'dark';
  return safeGetItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function setStoredTheme(theme) {
  safeSetItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Text size ("zoom"): a percentage the user picks directly (50-150, 100 =
// normal), applied as a multiplier to every font-size in globals.css via
// the --text-scale custom property (see there for why calc() multiplication
// was used instead of a rem/em rewrite). Replaced the earlier fixed
// Kecil/Normal/Besar/Extra steps with a free slider so any in-between size
// is reachable instead of only four fixed stops.
export const TEXT_SCALE_MIN = 50;
export const TEXT_SCALE_MAX = 150;
export const TEXT_SCALE_DEFAULT = 100;

// Tablets (iPad etc.) have noticeably lower pixel density than phones, so
// the exact same CSS px size reads physically bigger there. This app is
// designed mobile-first (the .app-shell column caps at 480px even on a
// wide screen), so a viewport past that width reliably means "tablet",
// and gets this extra shrink on top of whatever percentage the user picked.
const TABLET_BREAKPOINT = 600;
const TABLET_SCALE_FACTOR = 0.85;

function getDeviceScaleFactor() {
  if (typeof window === 'undefined') return 1;
  return window.innerWidth >= TABLET_BREAKPOINT ? TABLET_SCALE_FACTOR : 1;
}

function clampTextScale(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return TEXT_SCALE_DEFAULT;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, n));
}

// Returns the stored percentage (e.g. 100), not a multiplier.
export function getStoredTextScale() {
  if (typeof window === 'undefined') return TEXT_SCALE_DEFAULT;
  const stored = safeGetItem(TEXT_SCALE_KEY);
  return stored === null ? TEXT_SCALE_DEFAULT : clampTextScale(stored);
}

export function setStoredTextScale(percent) {
  const clamped = clampTextScale(percent);
  safeSetItem(TEXT_SCALE_KEY, String(clamped));
  applyTextScale(clamped);
}

export function applyTextScale(percent) {
  const multiplier = (clampTextScale(percent) / 100) * getDeviceScaleFactor();
  document.documentElement.style.setProperty('--text-scale', multiplier);
}

// Spacing/sizing counterpart to --text-scale - everything in globals.css
// that ISN'T a font-size (padding, gaps, border-radius, fixed box
// widths/heights, button min-heights) routes through --ui-scale instead.
// Device-only, not a user preference: on a tablet, the whole layout (not
// just the type) reads too big relative to a phone, so this shrinks tap
// targets and spacing right along with the text. Same breakpoint/factor as
// the text-scale tablet shrink above, kept as its own call (rather than
// folding into applyTextScale) since it isn't affected by the user's
// chosen text percentage at all.
export function applyUiScale() {
  document.documentElement.style.setProperty('--ui-scale', getDeviceScaleFactor());
}

// Bold text: adds a fixed amount to every font-weight in globals.css via
// --fw-boost (capped so the heaviest existing weight, 800, still lands at
// a valid 900 rather than overflowing).
const FW_BOOST_ON = 100;

export function getStoredBold() {
  if (typeof window === 'undefined') return false;
  return safeGetItem(BOLD_KEY) === 'true';
}

export function setStoredBold(bold) {
  safeSetItem(BOLD_KEY, bold ? 'true' : 'false');
  applyBold(bold);
}

export function applyBold(bold) {
  document.documentElement.style.setProperty('--fw-boost', bold ? FW_BOOST_ON : 0);
}
