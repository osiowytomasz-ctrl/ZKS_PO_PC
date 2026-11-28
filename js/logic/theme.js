// Motyw kolorystyczny (jasny / ciemny / systemowy) – czysta logika, bez dostępu do DOM (testy w test/theme.test.js).
export const THEME_KEY = 'zks.theme';
export const THEME_MODES = ['auto', 'light', 'dark'];
export const THEME_LABELS = { auto: 'Zgodnie z systemem', light: 'Jasny', dark: 'Ciemny' };

/** Poprawny tryb z zapisanej wartości (brak/nieznana → „light”: dopóki użytkownik nie wybierze, program wygląda jak dotąd). */
export function normalizeMode(v) { return THEME_MODES.includes(v) ? v : 'light'; }

/** Motyw do wyświetlenia: „dark” albo „light”. Tryb „auto” idzie za ustawieniem systemu (prefers-color-scheme). */
export function resolveTheme(mode, systemDark) {
  const m = normalizeMode(mode);
  return m === 'auto' ? (systemDark ? 'dark' : 'light') : m;
}

/** Następny tryb przy kliknięciu przycisku w pasku: jasny → ciemny → zgodnie z systemem → jasny. */
export function nextMode(mode) {
  const m = normalizeMode(mode);
  return m === 'light' ? 'dark' : m === 'dark' ? 'auto' : 'light';
}
