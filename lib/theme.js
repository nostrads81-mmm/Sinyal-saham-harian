const THEME_KEY = 'ssh_theme';

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'dark';
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function setStoredTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
