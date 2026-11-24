// Wspólne funkcje (odpowiedniki NaturalOrder, SheetColors, ColumnFilter z aplikacji Android).

const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const CHUNKS = /\d+|\D+/g;

// Data w formacie DD.MM.RRRR (też z „-” albo „/”), opcjonalnie z godziną: porównywana jak w Excelu – rok, miesiąc, dzień, godzina, minuta.
const DMY = /^\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/;   // godzina: GG:MM albo GG:MM:SS
/** Wartość daty tekstowej DD.MM.RRRR [GG:MM] jako liczba do porównań (null – to nie jest data w tym formacie albo jest nieprawidłowa). */
export function dmyValue(text) {
  const m = DMY.exec(String(text ?? ''));
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return ((+m[3] * 100 + mo) * 100 + d) * 1e6 + (+m[4] || 0) * 1e4 + (+m[5] || 0) * 100 + (+m[6] || 0);
}

/** Porównanie „naturalne”: liczby w tekście jako liczby (9 przed 10), bez wielkości liter, wg reguł polskich; daty DD.MM.RRRR – chronologicznie. */
export function naturalCompare(a, b) {
  const da = dmyValue(a), db = dmyValue(b);
  if (da !== null && db !== null) return da < db ? -1 : da > db ? 1 : 0;
  const x = String(a).match(CHUNKS) || [];
  const y = String(b).match(CHUNKS) || [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i];
    const q = y[i];
    let c;
    if (/\d/.test(p[0]) && /\d/.test(q[0])) {
      const pt = p.replace(/^0+/, '');
      const qt = q.replace(/^0+/, '');
      c = pt.length !== qt.length ? pt.length - qt.length : (pt < qt ? -1 : pt > qt ? 1 : 0);
    } else {
      c = collator.compare(p, q);
    }
    if (c !== 0) return c;
  }
  return x.length - y.length;
}

export function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const ISO = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?/;
const PL = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?:[ T](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?/;

/** Data z arkusza: `yyyy-MM-dd[ HH[:mm[:ss]]]` albo `d.M.yyyy[ HH[:mm[:ss]]]` (też z `-` i `/`). Zwraca Date (UTC) albo null. */
export function parseDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let y, mo, d, h = 0, mi = 0, sec = 0;
  let m = ISO.exec(text);
  if (m) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
    h = m[4] ? +m[4] : 0; mi = m[5] ? +m[5] : 0; sec = m[6] ? +m[6] : 0;
  } else if ((m = PL.exec(text))) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    h = m[4] ? +m[4] : 0; mi = m[5] ? +m[5] : 0; sec = m[6] ? +m[6] : 0;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Data jako `dd.MM.yyyy`; gdy tekst nie wygląda na datę, zostaje bez zmian. */
export function formatDate(raw) {
  const d = parseDate(raw);
  if (!d) return raw;
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** Kolor z arkusza (#rrggbb, #rgb, rgb(...)) albo wartość domyślna. */
export function parseSheetColor(value, fallback = '#ffffff') {
  const t = String(value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + t.slice(1).split('').map((c) => c + c).join('');
  const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(t);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => pad(Math.min(255, +n).toString(16))).join('');
  return fallback;
}

/** Czarny albo biały tekst, zależnie od jasności tła. */
export function contrastColor(bg) {
  const c = parseSheetColor(bg);
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128 ? '#ffffff' : '#000000';
}

/**
 * Zmienia listę poziomów sortowania [{key, ascending}]. Nowa kolumna jest dopisywana na końcu (sortowania się sumują),
 * ponowny wybór zmienia tylko kierunek, a `ascending === null` usuwa poziom.
 */
export function updateSorts(current, key, ascending) {
  if (ascending === null || ascending === undefined) return current.filter((s) => s.key !== key);
  if (current.some((s) => s.key === key)) return current.map((s) => (s.key === key ? { key, ascending } : s));
  return [...current, { key, ascending }];
}

/** Etykiety sortowania do nagłówków: strzałka, a przy kilku poziomach także numer. */
export function sortLabels(sorts) {
  const out = {};
  sorts.forEach((s, i) => {
    const arrow = s.ascending ? '↑' : '↓';
    out[s.key] = sorts.length > 1 ? arrow + (i + 1) : arrow;
  });
  return out;
}

/** Skrót filtra do wskaźnika, np. „R, W” albo „3 wartości”. */
export function filterSummary(allowed) {
  const shown = [...allowed].map((v) => v || '(puste)').sort();
  return shown.length <= 2 ? shown.join(', ') : shown.length + ' wartości';
}

/** Wybiera wersję rozwijalną: "zapis i odczyt" itp. */
export function permissionLabel(level) {
  return level === 'write' ? 'zapis i odczyt' : level === 'read' ? 'odczyt' : 'brak';
}

export function permissionsSummary(permissions) {
  const entries = Object.entries(permissions || {});
  if (!entries.length) return 'brak informacji';
  return entries.map(([m, l]) => m.charAt(0).toUpperCase() + m.slice(1) + ': ' + permissionLabel(l)).join(', ');
}
