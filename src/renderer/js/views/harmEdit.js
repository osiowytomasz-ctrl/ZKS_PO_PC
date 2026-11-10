// Kolumny Harmonogramu jak w pliku (A–H, I, J, K, L, M, R, S, T, X, AB) oraz edycja danych twardych (zapis, dodawanie, usuwanie).
// Kolumny liczone przez program (I, M, S) są tylko do odczytu.
import { h, modal, confirmBox, toast } from '../ui.js';
import { parseDateTime, parseNumber } from '../logic/harmImport.js';
import { updateOp, saveOp, deleteOp } from '../harmStore.js';

// group: 'z' = zależności (ukrywane razem); calc = liczone przez program; letter = kolumna w pliku
export const COLS = [
  { key: 'lp', letter: 'A', title: 'lp.', w: 52, ro: true, isNumberAware: true },
  { key: 'z1', letter: 'B', title: 'Z1', w: 48, group: 'z', pred: 0 }, { key: 'z2', letter: 'C', title: 'Z2', w: 48, group: 'z', pred: 1 },
  { key: 'z3', letter: 'D', title: 'Z3', w: 48, group: 'z', pred: 2 }, { key: 'z4', letter: 'E', title: 'Z4', w: 48, group: 'z', pred: 3 },
  { key: 'client', letter: 'F', title: 'Klient', w: 130, text: true },
  { key: 'komis', letter: 'G', title: 'Komis', w: 56, text: true },
  { key: 'element', letter: 'H', title: 'Opis operacji nazwa/element', w: 300, text: true },
  { key: 'start', letter: 'I', title: 'Start zlec.', w: 116, ro: true, isDate: true },
  { key: 'startManual', letter: 'J', title: 'Start ręcznie', w: 116, date: true, isDate: true },
  { key: 'hours', letter: 'K', title: 'Czas [h]', w: 34, num: true, vertical: true },
  { key: 'endManual', letter: 'L', title: 'Koniec ręcznie', w: 116, date: true, isDate: true },
  { key: 'koniec', letter: 'M', title: 'Koniec zlec.', w: 116, ro: true, isDate: true },
  { key: 'wysylka', letter: 'R', title: 'Zakończenie', w: 116, date: true, isDate: true },
  { key: 'key', letter: 'S', title: 'Stat. (klucz)', w: 48, ro: true, vertical: true },
  { key: 'status', letter: 'T', title: 'Status', w: 30, text: true, vertical: true },
  { key: 'dostawa', letter: 'X', title: 'Dostawa', w: 116, date: true, isDate: true },
  { key: 'station', letter: 'AB', title: 'Stan.', w: 34, text: true },
];
export const isSynthetic = (id) => /^s\d+$/.test(id);

/** Zapis jednej komórki (dane twarde). Zwraca true, gdy zapisano albo nic się nie zmieniło. */
export async function saveCell(opsByLp, id, col, raw) {
  let patch;
  if (col.pred !== undefined) {
    if (raw && !/^(\d+|s\d+)$/.test(raw)) { toast('Poprzednik to numer operacji (lp.)'); return false; }
    if (raw === id) { toast('Operacja nie może być swoim poprzednikiem'); return false; }
    const preds = [...(opsByLp[id]?.preds || [])]; while (preds.length <= col.pred) preds.push('');
    preds[col.pred] = raw; patch = { preds: preds.filter(Boolean) };
  } else if (col.date) {
    const v = raw ? parseDateTime(raw) : null;
    if (raw && v == null) { toast('Nie rozpoznano daty. Wpisz np. 14.11.2026 14:00'); return false; }
    patch = { [col.key]: v };
  } else if (col.num) {
    const v = raw ? parseNumber(raw) : null;
    if (raw && (v == null || v < 0)) { toast('Czas to liczba godzin, np. 46 albo 7,5'); return false; }
    patch = { hours: v };
  } else patch = { [col.key]: raw || null };
  try { await updateOp(id, patch); return true; } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); return false; }
}

export async function removeOp(opsByLp, id) {
  const op = opsByLp[id] || {};
  if (!(await confirmBox('Usuń operację', `Usunąć operację ${isSynthetic(id) ? '' : id + ' '}„${op.element || op.komis || ''}”?`, 'Usuń'))) return;
  try { await deleteOp(id); } catch (e) { toast('Nie usunięto: ' + (e.code || e.message)); }
}

export function addDialog(opsByLp) {
  const free = (() => { let n = 1; for (const k of Object.keys(opsByLp)) if (/^\d+$/.test(k)) n = Math.max(n, Number(k) + 1); return String(n); })();
  const f = {};
  const inp = (key, label, value = '', w = '100%') => { f[key] = h('input', { type: 'text', value, style: { width: w, padding: '4px' }, spellcheck: 'false' }); return h('div', { style: { margin: '4px 0' } }, h('div', { class: 'muted' }, label), f[key]); };
  const m = modal('Nowa operacja', h('div', {},
    inp('lp', 'Numer operacji (lp.)', free, '120px'), inp('preds', 'Poprzednicy (numery po przecinku, max 4)'), inp('client', 'Klient'), inp('komis', 'Komis'), inp('element', 'Opis operacji'),
    inp('station', 'Stanowisko (np. 1Si, 2Un, 3Co, 5Śl)', '', '120px'), inp('hours', 'Czas [h]', '', '120px'),
    inp('startManual', 'Start ręcznie (np. 14.11.2026 14:00) – gdy sztywny termin albo brak poprzednika'), inp('endManual', 'Koniec ręcznie (rzeczywisty)'), inp('wysylka', 'Zakończenie / wysyłka'), inp('dostawa', 'Dostawa'), inp('status', 'Status (np. zak.)', '', '120px'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
      const v = (k) => f[k].value.trim();
      const lp = v('lp');
      if (!/^\d+$/.test(lp)) { toast('Numer operacji to liczba'); return; }
      if (opsByLp[lp]) { toast('Operacja o numerze ' + lp + ' już istnieje'); return; }
      const preds = v('preds').split(/[\s,;]+/).filter(Boolean);
      if (preds.length > 4 || preds.some((p) => !/^\d+$/.test(p))) { toast('Poprzednicy: do 4 numerów'); return; }
      const op = { preds, client: v('client'), komis: v('komis'), element: v('element'), station: v('station'), status: v('status') };
      if (v('hours')) { const n = parseNumber(v('hours')); if (n == null || n < 0) { toast('Czas to liczba godzin'); return; } op.hours = n; }
      for (const k of ['startManual', 'endManual', 'wysylka', 'dostawa']) { if (v(k)) { const d = parseDateTime(v(k)); if (d == null) { toast('Nie rozpoznano daty: ' + v(k)); return; } op[k] = d; } }
      try { await saveOp(lp, op); m.close(); toast('Dodano operację ' + lp); } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
    } }, 'Dodaj'))));
  f.lp.focus();
}
