// Logika Zakupów (odpowiednik ZakupyLogic.kt).
import { formatDate, parseDate, naturalCompare } from './common.js';
import { parseQuantity } from './scanner.js';
import { visibleRows, filterOptions, sortRows, sortSummary as genericSummary } from './tableFilter.js';

export const VIEWS = { ordered: 'Zamówione', bought: 'Zakupione', nopz: 'Odebrane bez PZ', archive: 'Archiwum' };

/**
 * Zamówione = pozycje bez wpisu w kolumnie PZ (E). Zakupione = z numerem PZ. Odebrane bez PZ = w kolumnie PZ wpisano „x” albo „X”
 * (towar odebrany, a dokumentu PZ jeszcze nie ma – po otrzymaniu PZ wpisuje się jego numer, a pozycja przechodzi do Zakupione).
 */
export const lacksPz = (row) => String(row.columnE ?? '').trim() === '';
export const isNoPz = (row) => String(row.columnE ?? '').trim().toLowerCase() === 'x';
/** Bez PZ, a z datą zakupu (kolumna B): zakup uzupełniono niekompletnie, pozycja wymaga korekty (czerwony wiersz). */
export const needsCorrection = (row) => lacksPz(row) && String(row.columnB ?? '').trim() !== '';

const FIELDS = {
  zakup: { col: 'columnB', isDate: true },
  kod: { col: 'columnC' },
  ilosc: { col: 'columnD' },
  pz: { col: 'columnE' },
  cena: { col: 'columnF' },
  zmw: { col: 'columnG' },
  zamowiono: { col: 'columnH', isDate: true },
  iloscZamowiona: { col: 'columnI' },
  opis: { col: 'columnK' },
  uwagi: { col: 'columnL' },
};

export const isBought = (row) => String(row.columnJ ?? '').trim().toLowerCase() === 'x';

/** Kolumny widoku: zamówione (data, ilość zam., ZMW, opis – bez kodu), zakupione / archiwum (data, kod, ilość, PZ, opis), odebrane bez PZ (jak zakupione + ZMW). */
export function columns(view) {
  const defs = view === 'ordered'
    ? [['zamowiono', 'Data'], ['iloscZamowiona', 'Ilość'], ['zmw', 'ZMW'], ['opis', 'Opis']]
    : view === 'nopz'
      ? [['zakup', 'Data'], ['kod', 'Kod'], ['ilosc', 'Ilość'], ['pz', 'PZ'], ['zmw', 'ZMW'], ['opis', 'Opis']]
      : [['zakup', 'Data'], ['kod', 'Kod'], ['ilosc', 'Ilość'], ['pz', 'PZ'], ['opis', 'Opis']];
  return defs.map(([key, title]) => ({ key, title, isDate: !!FIELDS[key].isDate, ...(CMP[key] ? { cmp: CMP[key] } : {}) }));
}

// ---- edycja komórek w widokach Zakupione i Odebrane bez PZ (jak w arkuszu Google) ----
/** Widoki z edycją komórek. */
export const editableView = (view) => view === 'bought' || view === 'nopz';
/** Kolumny arkusza dla edytowalnych pól widoku (data zakupu B, kod C, ilość D, PZ E, ZMW G, opis K). */
export const EDIT_COLS = { zakup: 'B', kod: 'C', ilosc: 'D', pz: 'E', zmw: 'G', iloscZamowiona: 'I', opis: 'K', uwagi: 'L' };   // iloscZamowiona i uwagi – edycja wiersza zamówienia (PPM)
/** Wartość wpisana w komórce → tekst do arkusza albo błąd. Data: dd.MM.rrrr (puste dozwolone); PZ: „X” zapisujemy jako „x”. */
export function normalizeEdit(field, text) {
  const t = String(text ?? '').trim();
  if (!EDIT_COLS[field]) return { ok: false, error: 'Tej kolumny nie można edytować.' };
  if (field === 'zakup') {
    if (!t) return { ok: true, value: '' };
    const d = parseDate(t);
    return d ? { ok: true, value: formatDate(t) } : { ok: false, error: `„${t}” nie jest datą (dd.mm.rrrr).` };
  }
  if (field === 'iloscZamowiona' && t && parseQuantity(t) === null) return { ok: false, error: `„${t}” nie jest poprawną ilością (liczba większa od zera).` };
  if (field === 'pz') return { ok: true, value: t.toLowerCase() === 'x' ? 'x' : t };
  return { ok: true, value: t };
}
/** Ustawia surową wartość pola w wierszu (po zapisie w arkuszu). */
export const setValue = (row, field, v) => { row[FIELDS[field].col] = v; };

// ---- nietypowa kolejność sortowania numerów PZ i ZMW ----
/**
 * Numery dokumentów z segmentami rozdzielonymi „/” sortujemy od najmniej znaczącego miejsca w numerze:
 * PZ (AAAA/BB/MC/DD): najpierw DD (ostatni segment), potem BB (drugi), na końcu AAAA (pierwszy);
 * ZMW (AAAA/BB/CC): najpierw CC (ostatni), potem BB, na końcu AAAA. Segmenty liczbowe porównujemy jako liczby.
 * Wartości bez takiej budowy (np. „x”) idą po poprawnych numerach, między sobą naturalnie.
 */
export function compareSegmented(a, b) {
  const keys = (t) => { const p = String(t ?? '').split('/').map((x) => x.trim()); return p.length >= 3 ? [p[p.length - 1], p[1], p[0]] : null; };
  const ka = keys(a), kb = keys(b);
  if (!ka || !kb) return ka ? -1 : kb ? 1 : naturalCompare(String(a ?? ''), String(b ?? ''));
  for (let i = 0; i < 3; i++) {
    const x = ka[i], y = kb[i];
    const c = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : naturalCompare(x, y);
    if (c !== 0) return Math.sign(c);
  }
  return 0;
}
const CMP = { pz: compareSegmented, zmw: compareSegmented };

export const value = (row, field) => String(row[FIELDS[field].col] ?? '');
export const display = (field, raw) => (FIELDS[field].isDate ? formatDate(raw) : raw);
export const filterValue = (row, column) => display(column.key, value(row, column.key)).trim();

export function source(rows, archive, view) {
  if (view === 'ordered') return rows.filter(lacksPz);
  if (view === 'bought') return rows.filter((r) => !lacksPz(r) && !isNoPz(r));
  if (view === 'nopz') return rows.filter(isNoPz);
  return archive;
}

export const visible = (src, view, filters, except = null) => visibleRows(src, columns(view), filters, filterValue, except);
export const options = (src, view, filters, column) => filterOptions(src, columns(view), filters, filterValue, column);

export function shown(rows, archive, view, filters, sorts) {
  return sortRows(visible(source(rows, archive, view), view, filters), columns(view), sorts, filterValue);
}

export function sortSummary(view, sorts) {
  const cols = columns(view);
  const titles = Object.fromEntries(cols.map((c) => [c.key, c.title]));
  return genericSummary(cols, titles, sorts);
}

/** Tekst tabeli do skopiowania/udostępnienia (tytuł, nagłówki i wiersze rozdzielone „ | ”). */
export function shareText(view, rows) {
  const cols = columns(view);
  const lines = [VIEWS[view], '', cols.map((c) => c.title).join(' | ')];
  for (const row of rows) {
    lines.push(cols.map((c) => display(c.key, value(row, c.key)).replace(/\s+/g, ' ').trim()).join(' | '));
  }
  return lines.join('\n');
}

/**
 * Ilość do skopiowania do nowej pozycji, gdy zakupiono mniej niż zamówiono (np. zamówione 10, kupione 5 → „5”).
 * null, gdy nie ma czego kopiować: ilości puste, nieliczbowe albo zakupiono tyle samo lub więcej.
 */
export function remainingQuantity(ordered, bought) {
  const num = (t) => { const s = String(t ?? '').trim().replace(',', '.'); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
  const o = num(ordered), b = num(bought);
  if (o === null || b === null) return null;
  const rest = o - b;
  if (b <= 0 || rest <= 1e-9) return null;
  const rounded = Math.round(rest * 1000) / 1000;
  const text = String(rounded);
  return String(ordered).includes(',') ? text.replace('.', ',') : text;
}

// ---- tabela dodawania zamówień (10 wierszy, zapamiętywana między uruchomieniami) ----
export const DRAFT_ROWS = 10;
export const DRAFT_FIELDS = ['kod', 'ilosc', 'zmw', 'opis', 'uwagi'];
const ZMW_ONLY_SUFFIX = /^\s*\/\d{2}\/\d{2}\s*$/;

/** Początkowa zawartość ZMW: „/MM/RR” z bieżącego miesiąca i roku; użytkownik dopisuje numer z przodu. */
export function zmwTemplate(now = new Date()) {
  return '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getFullYear() % 100).padStart(2, '0');
}
/** ZMW bez numeru (puste albo tylko „/MM/RR”) traktujemy jak niewypełnione. */
export const isZmwEmpty = (zmw) => !String(zmw ?? '').trim() || ZMW_ONLY_SUFFIX.test(zmw);
export const zmwToSend = (zmw) => (isZmwEmpty(zmw) ? '' : String(zmw).trim());

export const blankRow = (now) => ({ kod: '', ilosc: '', zmw: zmwTemplate(now), opis: '', uwagi: '' });
export const isBlankRow = (r) => !r.kod.trim() && !r.ilosc.trim() && isZmwEmpty(r.zmw) && !r.opis.trim() && !r.uwagi.trim();
export const emptyDraft = (now) => Array.from({ length: DRAFT_ROWS }, () => blankRow(now));
export const filledCount = (draft) => draft.filter((r) => !isBlankRow(r)).length;

/** Niepuste wiersze na górę (kolejność zachowana), reszta pusta do 10. */
export function compactDraft(draft, now) {
  const filled = draft.filter((r) => !isBlankRow(r));
  return [...filled, ...emptyDraft(now)].slice(0, DRAFT_ROWS);
}

/** Komunikat o pierwszym błędnym wierszu albo null, gdy można wysyłać. Kod może być pusty; wymagana jest tylko ilość. */
export function validateDraft(draft) {
  if (filledCount(draft) === 0) return 'Tabela jest pusta.';
  for (let i = 0; i < draft.length; i++) {
    const r = draft[i];
    if (isBlankRow(r)) continue;
    if (!r.ilosc.trim()) return `Wiersz ${i + 1}: uzupełnij ilość.`;
    if (parseQuantity(r.ilosc) === null) return `Wiersz ${i + 1}: nieprawidłowa ilość.`;
  }
  return null;
}

/** Odczyt zapisanej tabeli (JSON); przy błędzie pusta tabela. */
export function parseDraft(json, now) {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return emptyDraft(now);
    const rows = arr.slice(0, DRAFT_ROWS).map((o) => ({
      kod: String(o?.kod ?? ''), ilosc: String(o?.ilosc ?? ''), zmw: String(o?.zmw ?? '').trim() ? String(o.zmw) : zmwTemplate(now),
      opis: String(o?.opis ?? ''), uwagi: String(o?.uwagi ?? ''),
    }));
    return [...rows, ...emptyDraft(now)].slice(0, DRAFT_ROWS);
  } catch (e) { return emptyDraft(now); }
}
