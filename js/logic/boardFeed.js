// Tablica informacyjna: ostatnie zdarzenia z rejestrów (operacje, dokumentacja, detale Mistrza i płytki – rejestr ZP) – po 3 najnowsze z każdego zapisane w jednym dokumencie bazy (wf_meta/feed),
// wyświetlane jako jedna linia tekstu „data godzina: wydarzenie: kto”, najnowsze na górze. Kolory: operacje jak w tabeli (Start / W toku / Koniec), płytki na szaro,
// detale – procent wykonania (szt zrobione / szt x kpl z Listy detali) w skali czerwony → żółty → zielony (100 % = zielony) jak domyślna skala kolorów Excela.
// Czyste funkcje – testy: test/board-feed.test.js (odpowiednik Androida: ui/workflow/InfoBoard.kt, EventFeed).
import { cellColor } from './mistrz.js';

/** Rejestry zdarzeń: klucz w dokumencie wf_meta/feed. */
export const FEED_SOURCES = ['ops', 'docs', 'dreg', 'plates'];
export const FEED_PER = 3;           // ile najnowszych zdarzeń z każdego rejestru
export const FEED_REFRESH_MS = 60 * 60000;   // pełne odświeżenie z tabel co godzinę (oprócz odświeżeń po zdarzeniach)
export const PLATE_GRAY = ['#d9d9d9', '#000000'];

const t = (v) => String(v ?? '').trim();
const join = (...p) => p.map(t).filter(Boolean);
const low = (v) => t(v).toLowerCase().replace(/\s+/g, ' ');
/** „rrrr-mm-dd” → „dd.mm.rrrr” (inny zapis bez zmian). */
const day = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t(iso)); return m ? `${m[3]}.${m[2]}.${m[1]}` : t(iso); };
const num = (v) => { const n = Number(String(v ?? '').trim().replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : NaN; };

/** Domyślna trzykolorowa skala Excela: 0 % czerwony (#F8696B) → 50 % żółty (#FFEB84) → 100 % zielony (#63BE7B); [p] 0–1 (poza zakresem – obcięte). Wynik „#rrggbb”. */
export function scaleColor(p) {
  const x = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0)), A = [0xf8, 0x69, 0x6b], B = [0xff, 0xeb, 0x84], C = [0x63, 0xbe, 0x7b];
  const [from, to, k] = x <= 0.5 ? [A, B, x / 0.5] : [B, C, (x - 0.5) / 0.5];
  return '#' + from.map((a, i) => Math.round(a + (to[i] - a) * k).toString(16).padStart(2, '0')).join('');
}
/** Procent wykonania detalu z Listy detali: wiersz o tym samym komisie, rysunku, pozycji i komplecie → szt zrobione (P) / szt x kpl (G); null, gdy brak wiersza lub ilości. [dlist] – [{ v }]. */
export function detailPercent(v, dlist) {
  const k = [v.C, v.D, v.E, v.F].map(low).join('|');
  const row = (dlist || []).find((r) => [r.v.B, r.v.D, r.v.E, r.v.F].map(low).join('|') === k);
  if (!row) return null;
  const g = num(row.v.G), p = num(row.v.P);
  if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(p)) return null;
  return Math.round((p / g) * 100);
}

/**
 * Zdarzenie z wiersza rejestru [key] (v – kolumny wpisywane): { kind, at, sort, what, who, bg?, fg?, pct? } albo null dla pustego wiersza.
 * ops: „Operacja 10 Start – komis Ktk”, kto = operator (H), kolor wg statusu (I) jak w tabeli; docs: „Dokument rodzaj nazwa – komis”, kto = rejestrujący (J);
 * dreg: „Detal rysunek poz. nr kpl. kpl – szt szt (komis)”, kto = operator (H), pct i kolor wg [ctx.dlist]; plates (rejestr ZP: { code, qty, at, who }): „Płytki symbol – ilość szt”, na szaro.
 */
export function eventOf(key, v, row = 0, ctx = {}) {
  v = v || {};
  let what = '', who = '', date = '', time = '', extra = {};
  if (key === 'plates') {
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(t(v.at));
    if (!t(v.code)) return null;
    what = `Płytki ${t(v.code)}` + (t(v.qty) ? ` – ${t(v.qty).replace('.', ',')} szt` : ''); who = t(v.who); date = m ? m[1] : t(v.at); time = m && m[2] ? m[2] : '';
    extra = { bg: PLATE_GRAY[0], fg: PLATE_GRAY[1] };
  } else {
    if (key === 'ops') {
      what = join('Operacja ' + t(v.E), v.I).join(' ') + (join(v.C, v.D).length ? ' – ' + join(v.C, v.D).join(' ') : ''); who = t(v.H);
      const c = cellColor('ops', { K: t(v.I) }, 'A'); if (c) extra = { bg: c[0], ...(c[1] ? { fg: c[1] } : {}) };   // kolory jak w tabeli: Start / W toku / Koniec
    } else if (key === 'docs') { what = 'Dokument ' + join(v.E, v.F || v.D).join(' ') + (t(v.C) ? ' – ' + t(v.C) : ''); who = t(v.J); }
    else if (key === 'dreg') {
      what = 'Detal ' + join(v.D, v.E ? 'poz. ' + t(v.E) : '', v.F ? 'kpl. ' + t(v.F) : '').join(' ') + (t(v.G) ? ` – ${t(v.G)} szt` : '') + (t(v.C) ? ` (${t(v.C)})` : ''); who = t(v.H);
      const pct = detailPercent(v, ctx.dlist); if (pct != null) extra = { pct, pctBg: scaleColor(pct / 100) };
    } else return null;
    if (!what.replace(/^(Operacja|Dokument|Detal)\s*/, '').trim() && !t(v.A)) return null;
    date = t(v.A); const tm = t(v.B); time = /^\d{1,2}\.?$/.test(tm) ? tm.replace('.', '').padStart(2, '0') + ':00' : tm;   // w rejestrze detali godzina bywa „6.”
  }
  return { kind: key, at: join(day(date), time).join(' '), sort: `${date} ${time.padStart(5, '0')} ${String(row).padStart(7, '0')}`, what: what.replace(/\s+/g, ' ').trim(), who, ...extra };
}
/** [FEED_PER] najnowszych zdarzeń rejestru: [rows] – [{ row, v }]; najnowsze pierwsze. */
export function topEvents(key, rows, ctx = {}, n = FEED_PER) {
  return (rows || []).map((r) => eventOf(key, r.v, r.row, ctx)).filter(Boolean).sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0)).slice(0, n);
}
/** Wspólna lista z dokumentu wf_meta/feed (`src`: { klucz: [zdarzenia] }) – najnowsze pierwsze, najwyżej [limit]. */
export function mergeFeed(src, limit = 40) {
  const all = [];
  for (const k of FEED_SOURCES) for (const e of (src && src[k]) || []) all.push(e);
  return all.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0)).slice(0, limit);
}
/** Zgodność wsteczna: lista z wierszy ({ klucz: [{ row, v }] }). */
export function mergeEvents(byKey, limit = 30) {
  const all = [];
  for (const [k, rows] of Object.entries(byKey || {})) all.push(...topEvents(k, rows, {}, 1e9));
  return all.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0)).slice(0, limit);
}
/** Linia tekstu: „data godzina: wydarzenie: kto”. */
export const eventText = (e) => [e.at, e.what, e.who].filter(Boolean).join(': ');
/** Czy dokument zdarzeń jest przeterminowany (starszy niż godzina albo go nie ma). */
export const feedStale = (updated, now = Date.now(), ms = FEED_REFRESH_MS) => !updated || now - Number(updated) >= ms;
