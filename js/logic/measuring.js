// Narzędzia pomiarowe: karta POM (kod w kolumnie C, interwał badań w kolumnie H) połączona z kartą „Badania 2026” (kod w kolumnie A, daty badań).
// Status badania wynika z upływu czasu od ostatniego badania proporcjonalnie do indywidualnego interwału narzędzia (kolumna H) –
// sześć stopni odpowiada sześciu kolorom statusów z kolumny L (wiersze 6–11) karty Badania 2026. Czyste funkcje – testy: test/measuring.test.js.
import { parseDate } from './common.js';

const DAY = 86400000;
export const POM_CODE_COL = 2, POM_INTERVAL_COL = 7, BAD_CODE_COL = 0;   // C, H, A (numeracja od 0)
export const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Progi wykorzystania interwału (upływ czasu / interwał), od których zaczyna się stopień 2…6; stopień 1 – poniżej pierwszego progu. */
export const THRESHOLDS = [0.5, 0.7, 0.85, 1, 1.15];

/**
 * Interwał z tekstu kolumny H w dniach. „12” – [unit] 'auto' (≤ 60 miesiące, więcej dni), 'months' albo 'days'; z nazwą jednostki: „12 mies”, „2 lata”, „1 rok”, „90 dni”, „6 m”, „1 r”.
 * Brak liczby – null.
 */
export function parseInterval(text, unit = 'auto') {
  const t = String(text ?? '').trim().toLowerCase().replace(',', '.');
  const m = /(\d+(?:\.\d+)?)\s*([a-ząćęłńóśźż]*)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]), u = m[2];
  if (!(n > 0)) return null;
  if (/^(r|rok|lat|lata|l|y|yr|year|years)$/.test(u)) return n * 365.25;
  if (/^(m|mies|miesiac|miesiące|miesiecy|miesięcy|mc)/.test(u)) return n * 30.4375;
  if (/^(d|dz|dni|dzień|dzien|days|day)$/.test(u)) return n;
  if (u) return null;
  return unit === 'months' ? n * 30.4375 : unit === 'days' ? n : (n <= 60 ? n * 30.4375 : n);
}
/** Daty z komórek wiersza: { last: ostatnia ≤ [now] (albo najnowsza, gdy wszystkie późniejsze), future: najbliższa późniejsza, all: liczba dat } – ms; brak – null. */
export function rowDates(cells, now = Date.now(), skip = new Set()) {
  const ds = [];
  (cells || []).forEach((c, i) => { if (skip.has(i)) return; const d = /\d/.test(String(c ?? '')) ? parseDate(String(c)) : null; if (d) ds.push(d.getTime()); });
  const past = ds.filter((t) => t <= now), fut = ds.filter((t) => t > now);
  return { last: past.length ? Math.max(...past) : null, future: fut.length ? Math.min(...fut) : null, all: ds.length };
}
/** Stopień statusu 0…5 (0 – najlepszy) z wykorzystania interwału [used] (upływ / interwał); [flip] odwraca kolejność. */
export function statusIndex(used, flip = false) {
  let i = THRESHOLDS.filter((t) => used >= t).length;
  if (flip) i = 5 - i;
  return i;
}
/**
 * Połączenie: [pomValues] – wartości karty POM (wiersze od 1, wiersz 1 = nagłówki), [badValues] – wartości karty Badania 2026.
 * Wynik: [{ id, pom: wiersz, bad: wiersze Badań z tym samym kodem, interval (dni), last, next, used, idx (stopień statusu) }] – tylko wiersze POM z kodem w C.
 */
export function joinPom(pomValues, badValues, { now = Date.now(), unit = 'auto', flip = false } = {}) {
  const bad = new Map();
  (badValues || []).forEach((r, i) => { const k = norm(r[BAD_CODE_COL]); if (k && i > 0) { if (!bad.has(k)) bad.set(k, []); bad.get(k).push(r); } });
  const out = [];
  (pomValues || []).slice(1).forEach((r, i) => {
    const id = String(r[POM_CODE_COL] ?? '').trim();
    if (!id) return;
    const rows = bad.get(norm(id)) || [], dates = rows.map((b) => rowDates(b, now, new Set([BAD_CODE_COL])));
    const last = dates.reduce((a, d) => (d.last != null && (a == null || d.last > a) ? d.last : a), null);
    const interval = parseInterval(r[POM_INTERVAL_COL], unit);
    const next = last != null && interval ? last + interval * DAY : null;
    const used = last != null && interval ? (now - last) / (interval * DAY) : null;
    out.push({ id, row: i + 2, pom: r, bad: rows, interval, last, next, used, idx: used == null ? null : statusIndex(used, flip) });
  });
  return out;
}
export const dateText = (t) => { if (t == null) return ''; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`; };
