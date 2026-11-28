import { THEME_KEY, normalizeMode, resolveTheme } from './logic/theme.js';

const mq = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

export function themeMode() { try { return normalizeMode(localStorage.getItem(THEME_KEY)); } catch { return 'light'; } }

/** Ustawia motyw na dokumencie (atrybut data-theme na <html>); css/dark.css zmienia wygląd wg tego atrybutu. */
export function applyTheme(mode = themeMode()) {
  const t = resolveTheme(mode, !!(mq() && mq().matches));
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
  return t;
}

const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setThemeMode(mode) {
  try { localStorage.setItem(THEME_KEY, normalizeMode(mode)); } catch { /* bez pamięci */ }
  const t = applyTheme(mode);
  for (const fn of listeners) { try { fn(t, normalizeMode(mode)); } catch { /* słuchacz nie psuje zmiany motywu */ } }
  return t;
}

/** Start programu: zastosuj zapisany motyw i reaguj na zmianę motywu systemu, gdy wybrano „zgodnie z systemem”. */
export function initTheme() {
  applyTheme();
  const m = mq();
  if (m && m.addEventListener) m.addEventListener('change', () => { if (themeMode() === 'auto') { const t = applyTheme('auto'); for (const fn of listeners) { try { fn(t, 'auto'); } catch { /* ignoruj */ } } } });
}
