// Kolumny Harmonogramu jak w pliku (A–H, I, J, K, L, M, R, S, T, X, AB) oraz edycja danych twardych (zapis, dodawanie, usuwanie).
// Kolumny liczone przez program (I, M, S) są tylko do odczytu.
import { h, clear, modal, confirmBox, toast } from '../ui.js';
import { parseDateTime, parseNumber } from '../logic/harmImport.js';
import { updateOp, saveOps, deleteOps, renameOp } from '../harmStore.js';
import { predError, predecessorChoices, validateNewOps, renamePlan, isSyntheticId, lpCompare, idError, subOps } from '../logic/harmModel.js';

// group: 'z' = zależności (ukrywane razem); calc = liczone przez program; letter = kolumna w pliku
export const COLS = [
  { key: 'lp', letter: 'A', title: 'lp.', w: 76, text: true, isNumberAware: true },
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
export const isSynthetic = isSyntheticId;

/** Zapis jednej komórki (dane twarde). Zwraca true, gdy zapisano albo nic się nie zmieniło. */
export async function saveCell(opsByLp, id, col, raw) {
  let patch;
  if (col.key === 'lp') {            // zmiana numeru operacji: przenosi operację pod nowy numer i poprawia powiązania
    const plan = renamePlan(opsByLp, id, raw.trim());
    if (plan.error) { toast(plan.error); return false; }
    if (plan.same) return true;
    try { await renameOp(plan); toast(`Numer ${plan.oldId} zmieniony na ${plan.newId}` + (plan.moves.length > 1 ? ` (razem z suboperacjami: ${plan.moves.length - 1})` : '') + (plan.referrers.length ? ` (poprawiono powiązania: ${plan.referrers.length})` : '')); return true; }
    catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); return false; }
  }
  if (col.pred !== undefined) {
    const err = predError(opsByLp, id, col.pred, raw);
    if (err) { toast(err); return false; }
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
  const subs = subOps(opsByLp, id);
  const extra = subs.length ? `\n\nRazem z nią zostanie usunięte suboperacji: ${subs.length} (${subs.join(', ')}).` : '';
  if (!(await confirmBox('Usuń operację', `Usunąć operację ${isSynthetic(id) ? '' : id + ' '}„${op.element || op.komis || ''}”?${extra}`, 'Usuń'))) return;
  try { await deleteOps([id, ...subs]); } catch (e) { toast('Nie usunięto: ' + (e.code || e.message)); }
}

/** Okno wyboru poprzednika: lista tylko tych operacji, które nie spowodują cyklu ani duplikatu; można wpisać numer, komis albo opis. */
export function predPicker(opsByLp, id, slot, onDone) {
  const choices = predecessorChoices(opsByLp, id, slot);
  const current = (opsByLp[id]?.preds || [])[slot] || '';
  const search = h('input', { type: 'search', placeholder: 'Wpisz numer, komis albo opis…', style: { width: '100%', padding: '6px' }, spellcheck: 'false' });
  const list = h('div', { style: { maxHeight: '320px', overflow: 'auto', border: '1px solid #ccc', marginTop: '6px' } });
  const label = (lp) => { const o = opsByLp[lp]; return [isSynthetic(lp) ? '' : lp, o.komis, o.element, o.station].filter(Boolean).join('  ·  '); };
  const pick = async (lp) => { m.close(); onDone(lp); };
  let shownNow = [];
  const render = () => {
    const q = search.value.trim().toLowerCase();
    clear(list);
    const shown = choices.filter((lp) => !q || label(lp).toLowerCase().includes(q));
    shownNow = shown;
    for (const lp of shown.slice(0, 300)) list.append(h('div', { style: { padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #eee', fontWeight: lp === current ? 700 : 400 }, onclick: () => pick(lp) }, label(lp)));
    if (!shown.length) list.append(h('div', { class: 'muted', style: { padding: '8px' } }, 'Brak operacji do wyboru (nie ma takich albo powiązanie utworzyłoby cykl).'));
    else if (shown.length > 300) list.append(h('div', { class: 'muted', style: { padding: '6px' } }, `Pokazano 300 z ${shown.length}. Zawęź wyszukiwanie.`));
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && shownNow.length) { e.preventDefault(); pick(shownNow.find((lp) => lp === search.value.trim()) || shownNow[0]); } });
  render();
  const m = modal(`Poprzednik Z${slot + 1} · operacja ${isSynthetic(id) ? '' : id}`, h('div', {},
    h('p', { class: 'muted' }, 'Na liście są tylko operacje, które można połączyć bez konfliktu (bez cyklu i powtórzeń).'), search, list,
    h('div', { class: 'actions' }, current ? h('button', { class: 'btn', onclick: () => pick('') }, 'Usuń powiązanie') : null, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'))));
  search.focus();
}

/** Rozwijana lista stanowisk z kolorami (jak w harmonogramie). */
function stationDropdown(stations, initial, onChange) {
  let value = initial || '';
  const chip = (s) => h('span', { style: { display: 'inline-block', minWidth: '52px', textAlign: 'center', padding: '1px 8px', fontStyle: 'italic', fontWeight: 700, background: s ? s.bg : '#fff', color: s ? s.color : '#000', border: '1px solid #bbb' } }, s ? s.name : '—');
  const btn = h('div', { style: { cursor: 'pointer', border: '1px solid #999', padding: '2px 4px', minHeight: '22px', background: '#fff' } });
  const menu = h('div', { style: { display: 'none', position: 'absolute', zIndex: 50, background: '#fff', border: '1px solid #666', boxShadow: '0 2px 8px rgba(0,0,0,.3)', maxHeight: '240px', overflow: 'auto' } });
  const box = h('div', { style: { position: 'relative' } }, btn, menu);
  const paint = () => { clear(btn); btn.append(chip(stations.find((s) => s.name === value))); };
  const close = () => { menu.style.display = 'none'; };
  for (const s of [null, ...stations]) menu.append(h('div', { style: { padding: '3px 6px', cursor: 'pointer' }, onclick: (e) => { e.stopPropagation(); value = s ? s.name : ''; onChange(value); paint(); close(); } }, chip(s)));
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
  document.addEventListener('click', close);
  paint();
  return { el: box, get value() { return value; } };
}

const ADD_COLS = [
  { key: 'lp', title: 'lp.', w: 64 }, { key: 'client', title: 'Klient', w: 130 }, { key: 'komis', title: 'Komis', w: 84 }, { key: 'element', title: 'Opis operacji', w: 300 },
  { key: 'station', title: 'Stan.', w: 96 }, { key: 'hours', title: 'Czas [h]', w: 64 }, { key: 'wysylka', title: 'Zakończenie', w: 120 }, { key: 'dostawa', title: 'Dostawa', w: 120 },
];
const ADD_ROWS = 10;

/** Dodawanie operacji: tabela na dziesięć wierszy (kolumny jak w danych twardych). Puste wiersze są pomijane, numery nie mogą się powtarzać. */
export function addDialog(opsByLp, stations, onSaved) {
  let n = 1; for (const k of Object.keys(opsByLp)) if (/^\d+$/.test(k)) n = Math.max(n, Number(k) + 1);   // kolejne wolne numery; można wpisać też numery z literami
  const rows = Array.from({ length: ADD_ROWS }, (_, i) => ({ lp: String(n + i), client: '', komis: '', element: '', station: '', hours: '', wysylka: '', dostawa: '' }));
  const lpInputs = [];
  const markDupes = () => {
    const count = new Map(); for (const r of rows) count.set(r.lp.trim(), (count.get(r.lp.trim()) || 0) + 1);
    rows.forEach((r, i) => { const e = r.lp.trim() ? idError(r.lp.trim(), opsByLp) : null; const bad = e || count.get(r.lp.trim()) > 1; lpInputs[i].style.background = bad ? '#ffd6d6' : '#fff'; lpInputs[i].title = bad ? (e || 'Numer powtórzony w tabeli') : ''; });
  };
  const head = h('tr', {}, ...ADD_COLS.map((c) => h('th', { style: { padding: '3px 4px', background: '#eee', border: '1px solid #999', fontSize: '12px', textAlign: 'left' } }, c.title)));
  const body = rows.map((r, i) => h('tr', {}, ...ADD_COLS.map((c) => {
    if (c.key === 'station') { const dd = stationDropdown(stations, '', (v) => { r.station = v; }); return h('td', { style: { border: '1px solid #999', padding: 0, width: c.w + 'px' } }, dd.el); }
    const inp = h('input', { type: 'text', value: r[c.key], spellcheck: 'false', style: { width: c.w + 'px', boxSizing: 'border-box', border: 'none', padding: '3px 4px', fontSize: '12px' }, oninput: () => { r[c.key] = inp.value; if (c.key === 'lp') markDupes(); } });
    if (c.key === 'lp') lpInputs[i] = inp;
    return h('td', { style: { border: '1px solid #999', padding: 0 } }, inp);
  })));
  const errBox = h('div', { class: 'err', style: { whiteSpace: 'pre-wrap', marginTop: '6px', fontSize: '12px' } });
  const m = modal('Nowe operacje', h('div', {},
    h('p', { class: 'muted' }, `Wpisz do ${ADD_ROWS} operacji. Puste wiersze są pomijane. Numer: liczba (operacja główna) albo liczba + litera (suboperacja, np. 3000a, wymaga istniejącej operacji głównej). Poprzedników, start i koniec ręczny ustawisz potem w tabeli. Daty np. 14.11.2026 14:00.`),
    h('div', { style: { overflow: 'auto', maxHeight: '60vh' } }, h('table', { style: { borderCollapse: 'collapse' } }, h('thead', {}, head), h('tbody', {}, ...body))),
    errBox,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
      const { ops, errors } = validateNewOps(rows, opsByLp, parseDateTime, parseNumber);
      if (errors.length) { errBox.textContent = errors.join('\n'); return; }
      try { await saveOps(ops); m.close(); toast(`Dodano operacji: ${ops.length}`); if (onSaved) onSaved(); } catch (e) { errBox.textContent = 'Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e); }
    } }, 'Dodaj'))), { wide: true });
  m.root.style.width = 'min(1060px, 96vw)'; m.root.style.maxWidth = '96vw';
  markDupes();
}
