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

// Text size ("zoom"): a multiplier applied to every font-size in
// globals.css via the --text-scale custom property (see there for why
// calc() multiplication was used instead of a rem/em rewrite).
export const TEXT_SCALES = {
  kecil: 0.875,
  normal: 1,
  besar: 1.15,
  'extra-besar': 1.3,
};

export function getStoredTextScale() {
  if (typeof window === 'undefined') return 'normal';
  const stored = safeGetItem(TEXT_SCALE_KEY);
  return TEXT_SCALES[stored] ? stored : 'normal';
}

export function setStoredTextScale(scale) {
  safeSetItem(TEXT_SCALE_KEY, scale);
  applyTextScale(scale);
}

export function applyTextScale(scale) {
  const multiplier = TEXT_SCALES[scale] ?? 1;
  document.documentElement.style.setProperty('--text-scale', multiplier);
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
