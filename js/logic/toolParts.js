// Przypisywanie części do narzędzi (ToolBuilder → Kontury → „Części narzędzia”): do 10 płytek (ply1–10) i do 10 części / akcesoriów (osp1–10) na narzędzie, typ narzędzia
// (monolityczne / składane / oprawka-redukcja-przedłużka) i kontrola „nie przypisano”. Czyste funkcje – testy: test/tool-parts.test.js.
import { CUT_LETTERS, ACC_LETTERS } from './pswtLayout.js';
import { parseNumber } from './destroyed.js';

export const MAX_SLOTS = 10;
/** Typy narzędzia (zapisane w bazie przy produkcie PSWT, pole `tt`). */
export const TOOL_TYPES = [
  { id: 'mono', label: 'Narzędzie monolityczne', hint: 'jedna bryła – nie wymaga płytek ani części' },
  { id: 'comp', label: 'Narzędzie skrawające składane', hint: 'wymaga płytek i części (np. śruby, klucz)' },
  { id: 'holder', label: 'Oprawka, redukcja, przedłużka – wymaga części', hint: 'wymaga części (płytek nie ma)' },
  { id: 'holder0', label: 'Oprawka, redukcja, przedłużka – nie wymaga części', hint: 'nic nie jest wymagane (np. prosta przedłużka)' },
];
const norm = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Typ narzędzia: zapisany [sel] albo domyślny z grupy (oprawki – kolumna D „opr” → oprawka / redukcja / przedłużka; pozostałe – składane, dopóki ktoś nie ustawi „monolityczne”). */
export function toolTypeOf(tool, sel = '') {
  const s = norm(sel); if (TOOL_TYPES.some((x) => x.id === s)) return s;
  return norm(tool && tool.columnD) === 'opr' ? 'holder' : 'comp';
}
/**
 * Stan przypisania części narzędzia: { type, missing: ['płytek', 'części'], ok, text }. [details] – { partsCutting, partsAccessories } z katalogu; brak szczegółów (narzędzie
 * na złomie / zapasie albo bez wpisu) – nic do sprawdzenia (ok). Płytki wymagane tylko w składanych, części – w składanych i oprawkach „wymagających części”; oprawka „nie wymaga części” i monolityczne – nic.
 */
export function assignState(tool, details, sel = '') {
  const type = toolTypeOf(tool, sel);
  if (!details) return { type, missing: [], ok: true, text: '' };
  const missing = [];
  if (type === 'comp' && !(details.partsCutting || []).length) missing.push('płytek');
  if ((type === 'comp' || type === 'holder') && !(details.partsAccessories || []).length) missing.push('części');
  return { type, missing, ok: !missing.length, text: missing.length ? 'Nie przypisano ' + missing.join(' i ') : '' };
}

/** Wartości miejsc z wpisu PSWT (v): { cut: [ply1…], acc: [osp1…] } bez pustych (kolejność miejsc). */
export function slotsOf(v) {
  const take = (letters) => letters.map((l) => String((v || {})[l] ?? '').trim()).filter(Boolean);
  return { cut: take(CUT_LETTERS), acc: take(ACC_LETTERS) };
}
/** Zmiany kolumn wpisu: { litera: nowy tekst } tylko dla miejsc, które się różnią – lista [cut] i [acc] zapisywana od pierwszego miejsca bez przerw (reszta puste). */
export function planChanges(v, cut, acc) {
  const out = {};
  const fill = (letters, list) => letters.forEach((l, i) => { const now = String((v || {})[l] ?? '').trim(), want = String(list[i] ?? '').trim(); if (now !== want) out[l] = want; });
  fill(CUT_LETTERS, cut || []); fill(ACC_LETTERS, acc || []);
  return out;
}
/** Kontrola list: bez powtórzeń (bez względu na wielkość liter), do 10 pozycji, kody istniejące w PSWT ([known] – Set kodów małymi literami; pominięty = bez sprawdzania). Wynik: tablica komunikatów. */
export function validateSlots(cut, acc, known = null) {
  const errs = [];
  for (const [name, list] of [['Płytki', cut], ['Części', acc]]) {
    if (list.length > MAX_SLOTS) errs.push(`${name}: najwyżej ${MAX_SLOTS} pozycji.`);
    const seen = new Set();
    for (const c of list) { const k = norm(c); if (seen.has(k)) errs.push(`${name}: „${c}” występuje dwa razy.`); seen.add(k); if (known && !known.has(k)) errs.push(`${name}: „${c}” nie ma w PSWT.`); }
  }
  return errs;
}

/**
 * Kandydaci do wyboru z wpisów PSWT: { code, n, a (numer A), name, firma, group, kind, stan, zapas, dostepne, uses (w ilu narzędziach), contour (jest ścieżka?) }.
 * [rows] – tablice logiczne z policzonymi kolumnami (tableRows), równolegle do [entries]; [colIdx] – indeksy kolumn (A, B, C, D, E, P, AP, AQ, AR).
 */
export function candidatesFrom(entries, rows, idx) {
  const uses = new Map();
  for (const e of entries) for (const l of [...CUT_LETTERS, ...ACC_LETTERS]) { const k = norm((e.v || {})[l]); if (k) uses.set(k, (uses.get(k) || 0) + 1); }
  const sorted = entries.map((e, i) => ({ e, r: rows[i] || [] }));
  return sorted.map(({ e, r }) => {
    const v = e.v || {}, code = String(v.B ?? '').trim();
    return { code, n: e.n, a: parseNumber(v.A), name: String(v.C ?? '').trim(), firma: String(v.P ?? '').trim(), group: String(v.D ?? '').trim(), kind: String(v.E ?? '').trim(),
      stan: String(r[idx.AP] ?? ''), zapas: String(r[idx.AQ] ?? ''), dostepne: String(r[idx.AR] ?? ''), uses: uses.get(norm(code)) || 0 };
  }).filter((x) => x.code);
}
/** Czy część ma przypisane narzędzie (używana w którymś narzędziu): [usesCount] z kandydata albo długość listy użyć. */
export const isAssigned = (uses) => (Array.isArray(uses) ? uses.length : Number(uses) || 0) > 0;
