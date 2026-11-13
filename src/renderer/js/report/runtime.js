// Interaktywny plik HTML z harmonogramem („mini-program” w przeglądarce, bez internetu i bez dostępu do bazy).
// Dane: <script type="application/json" id="zks-data"> (operacje, dni grafiku, ustawienia, widok startowy); ten kod jest wklejany do pliku
// (npm run runtime → js/report/runtime.bundle.js dla PC i app/src/main/assets/report-runtime.js dla Androida).
// Silnik harmonogramu jest ten sam co w programie (logic/harmModel.js), więc symulacja liczy terminy dokładnie jak program.
// Ustawienia pliku (kolumny, szerokości, powiększenie, włączone funkcje…) w JEDNYM wpisie localStorage wspólnym dla wszystkich plików
// z programu – każdy plik nadpisuje ten sam wpis, nic się nie mnoży (bez ciasteczek).
import { buildHarmData, stationList, arrangeRows, withKomisRows, fmtDt, subParent, predError, idError, ID_PATTERN, lpCompare, isKomisId, KOMIS_PREFIX } from '../logic/harmModel.js';
import { INTERVALS, intervalOf, buildCells, holidayMap } from '../logic/harmAxis.js';
import { visibleRows, filterOptions, sortRows, rangeFilter, isRangeFilter } from '../logic/tableFilter.js';
import { buildXlsx, excelDate } from '../logic/xlsx.js';
import { parseDateTime, parseNumber } from '../logic/harmImport.js';
import { findIssues } from '../logic/harmIssues.js';

export const PREF_KEY = 'zks-harmonogram-html';
export const FEATURES = [
  ['search', 'Szukaj w wierszach', 'Pole „Szukaj”: zostają wiersze z wpisanym tekstem; trafienia podświetlone'],
  ['filters', 'Filtry kolumn jak w Excelu', 'Klik w nagłówek: lista wartości z polami wyboru, szukanie, zakres dat'],
  ['sort', 'Sortowanie wielopoziomowe', 'W oknie filtra: A→Z / Z→A; kolejne kolumny dokładają poziomy'],
  ['columns', 'Wybór kolumn', 'Przycisk „Kolumny”: pokaż / ukryj dowolne kolumny'],
  ['resize', 'Szerokość kolumn', 'Przeciągnij prawą krawędź nagłówka'],
  ['zoom', 'Powiększenie', 'Przyciski −, 100%, + i „Dopasuj”, Ctrl + kółko myszy'],
  ['axis', 'Oś czasu: interwał i przesuwanie', 'Interwał od 1 godziny do miesiąca, przesuwanie ◀ ▶, „Dziś”'],
  ['levels', 'Poziomy III / II / I i zwijanie', 'Ukrywanie poziomów drzewa, zwijanie operacji strzałką ▾'],
  ['komis', 'Podsumowanie komisów', 'Paski komisów (start, koniec, godziny, postęp, wysyłka)'],
  ['details', 'Szczegóły operacji', 'Klik w wiersz: panel z danymi, poprzednikami i suboperacjami'],
  ['deps', 'Linie zależności', 'Strzałki od poprzednika do operacji na wykresie'],
  ['today', 'Linia „teraz”', 'Pomarańczowa linia bieżącej chwili na osi'],
  ['late', 'Spóźnienia', 'Koniec po wysyłce na czerwono, znacznik wysyłki na osi'],
  ['totals', 'Pasek podsumowania', 'Liczba wierszy, suma godzin, spóźnienia, zmiany symulacji'],
  ['view', 'Widok: tabela / wykres / oba', 'Przełącznik układu ekranu'],
  ['csv', 'Eksport CSV', 'Widoczne wiersze i kolumny do pliku .csv (Excel, Arkusze)'],
  ['xlsx', 'Eksport Excel', 'Widoczne wiersze i kolumny do pliku .xlsx z kolorami'],
  ['print', 'Drukowanie', 'Wydruk widoku (bez przycisków)'],
  ['fullscreen', 'Pełny ekran', ''],
  ['theme', 'Motyw ciemny', ''],
  ['keys', 'Klawiatura', 'Strzałki, Enter, F2, Esc, Ctrl+F, +/−'],
  ['conflicts', 'Konflikty i błędy', 'Pętle zależności, brakujący poprzednicy, błędne daty…'],
  ['sim', 'Symulacja', 'Zmiana godzin, dat, stanowisk, zależności i statusu – terminy liczą się od nowa (tylko w tym pliku)'],
  ['simAdd', 'Symulacja: nowe operacje', 'Dodanie operacji „na próbę” (np. nowe zamówienie)'],
  ['compare', 'Symulacja: porównanie z oryginałem', 'Szary pasek = termin przed zmianą, kolumna Δ koniec'],
  ['simSave', 'Symulacja: zapis kopii pliku', 'Plik HTML z wprowadzoną symulacją (do wysłania dalej)'],
  ['remember', 'Zapamiętywanie ustawień', 'Jeden wpis w przeglądarce, wspólny dla wszystkich plików z programu'],
];

const COLS = [
  { key: 'lp', title: 'lp.', w: 92, isNumberAware: true },
  { key: 'z1', title: 'Z1', w: 46, pred: 0 }, { key: 'z2', title: 'Z2', w: 46, pred: 1 }, { key: 'z3', title: 'Z3', w: 46, pred: 2 }, { key: 'z4', title: 'Z4', w: 46, pred: 3 },
  { key: 'client', title: 'Klient', w: 120, edit: 'text' }, { key: 'komis', title: 'Komis', w: 70, edit: 'text' },
  { key: 'element', title: 'Opis operacji nazwa/element', w: 260, edit: 'text' },
  { key: 'start', title: 'Start zlec.', w: 104, isDate: true, ro: true },
  { key: 'startManual', title: 'Start ręcznie', w: 104, isDate: true, edit: 'date' },
  { key: 'hours', title: 'Czas [h]', w: 46, edit: 'num' },
  { key: 'endManual', title: 'Koniec ręcznie', w: 104, isDate: true, edit: 'date' },
  { key: 'koniec', title: 'Koniec zlec.', w: 104, isDate: true, ro: true },
  { key: 'delta', title: 'Δ koniec', w: 70, ro: true, sim: true },
  { key: 'wysylka', title: 'Wysyłka', w: 104, isDate: true, edit: 'date' },
  { key: 'status', title: 'Status', w: 50, edit: 'status' },
  { key: 'dostawa', title: 'Dostawa', w: 104, isDate: true, edit: 'date' },
  { key: 'station', title: 'Stan.', w: 52, edit: 'station' },
];
const ZAK = '#93c47d', DAY_BG = { work: '#00b050', sat: '#00b0f0', sun: '#ff0000', holiday: '#800000', span: '#00b050' };
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const noMin = (t) => String(t ?? '').replace(/^(\d{2}\.\d{2}\.\d{4} \d{2}):\d{2}$/, '$1');
const p2 = (n) => String(n).padStart(2, '0');
const clone = (x) => JSON.parse(JSON.stringify(x));
const isDone = (r) => String(r.status || '').trim().toLowerCase() === 'zak.';

// ---------------------------------------------------------------------------------------------------------------------
// Ustawienia: jeden wpis localStorage (wspólny dla wszystkich plików z programu, nadpisywany) – bez ciasteczek, bez mnożenia wpisów
// ---------------------------------------------------------------------------------------------------------------------
export function loadPrefs(storage) {
  try { const v = JSON.parse(storage.getItem(PREF_KEY) || 'null'); return v && v.v === 1 ? v : null; } catch { return null; }
}
export function savePrefs(storage, prefs) {
  try { const t = JSON.stringify({ ...prefs, v: 1 }); if (t.length < 20000) storage.setItem(PREF_KEY, t); } catch { /* prywatne okno, pełna pamięć */ }
}

// ---------------------------------------------------------------------------------------------------------------------
// Symulacja: zmiany operacji, cofanie, lista zmian (czyste funkcje – testowane w Node)
// ---------------------------------------------------------------------------------------------------------------------
const FIELD_LABEL = { hours: 'Czas [h]', startManual: 'Start ręcznie', endManual: 'Koniec ręcznie', wysylka: 'Wysyłka', dostawa: 'Dostawa', status: 'Status', station: 'Stanowisko', preds: 'Zależności', element: 'Opis', komis: 'Komis', client: 'Klient', new: 'Nowa operacja' };
/** Wartość z pola tekstowego → wartość operacji albo {error}. */
export function parseSimValue(ops, id, field, text, slot = 0) {
  const t = String(text ?? '').trim();
  if (field === 'hours') { if (!t) return { value: null }; const v = parseNumber(t); return v == null || v < 0 ? { error: 'Czas to liczba godzin, np. 46 albo 7,5' } : { value: v }; }
  if (['startManual', 'endManual', 'wysylka', 'dostawa'].includes(field)) { if (!t) return { value: null }; const v = parseDateTime(t); return v == null ? { error: 'Nie rozpoznano daty. Wpisz np. 14.11.2026 14:00' } : { value: v }; }
  if (field === 'pred') { const err = predError(ops, id, slot, t); if (err) return { error: err }; const preds = [...(ops[id].preds || [])]; while (preds.length <= slot) preds.push(''); preds[slot] = t; return { field: 'preds', value: preds.filter(Boolean) }; }
  if (field === 'status') return { value: t };
  return { value: t };
}
/** Zmiana pola operacji w symulacji: zwraca nowe operacje i wpis do listy zmian (z poprzednią wartością do cofania). */
export function applySim(ops, id, field, value) {
  const next = { ...ops, [id]: { ...ops[id] } };
  const old = ops[id][field];
  if (value == null || value === '') delete next[id][field]; else next[id][field] = value;
  if (field === 'preds' && !value.length) next[id].preds = [];
  return { ops: next, change: { id, field, old: old ?? null, value: value ?? null } };
}
export const fmtSimValue = (field, v) => (v == null || v === '' ? '—' : ['startManual', 'endManual', 'wysylka', 'dostawa'].includes(field) ? fmtDt(v) : Array.isArray(v) ? v.join(', ') : String(v));
/** Przesunięcie końca [ms] → tekst „+2 d 4 h” / „−3 h”. */
export function fmtDelta(ms) {
  if (!ms) return '';
  const s = ms > 0 ? '+' : '−', h = Math.round(Math.abs(ms) / 3600000);
  return h >= 24 ? `${s}${Math.floor(h / 24)} d${h % 24 ? ' ' + (h % 24) + ' h' : ''}` : `${s}${h} h`;
}
/** Lista zmian symulacji jako CSV (separator ;) i podsumowanie przesunięć końca operacji. */
export function changesCsv(changes, base, sim) {
  const lines = ['Operacja;Pole;Było;Jest'];
  for (const c of changes) lines.push([c.id, FIELD_LABEL[c.field] || c.field, fmtSimValue(c.field, c.old), fmtSimValue(c.field, c.value)].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';'));
  lines.push('', 'Operacja;Koniec przed;Koniec po;Przesunięcie');
  for (const [id, r] of sim) { const b = base.get(id); if (!b || b.end === r.end) continue; lines.push([id, fmtDt(b.end), fmtDt(r.end), fmtDelta((r.end ?? 0) - (b.end ?? 0))].map((x) => `"${x}"`).join(';')); }
  return '﻿' + lines.join('\r\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Aplikacja w przeglądarce
// ---------------------------------------------------------------------------------------------------------------------
const STYLE = `
:root{--rowh:22px;--bg:#fff;--fg:#000;--muted:#666;--line:#8c8c8c;--head:#e4e4e4;--panel:#f6f7f9;--accent:#1a73e8;--lane:#f2f2f2;--sel:#00b050}
body.dark{--bg:#1e1f22;--fg:#e8e8e8;--muted:#a0a0a0;--line:#555;--head:#2d2f33;--panel:#26282c;--accent:#6ea8ff;--lane:#2a2c30}
*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:var(--fg);font-size:12px}
#app{display:flex;flex-direction:column;height:100vh}
.brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #d71920;box-shadow:0 1.5px 0 #2b2b2b;padding:4px 8px 6px;background:#fff;color:#000}
.bl{display:flex;gap:8px;align-items:center}.bl img{width:44px;height:44px;object-fit:contain}.co{font-size:16px;font-weight:700;color:#2b2b2b}.de{font-size:12px;font-weight:700;color:#d71920}.sh,.ow{font-size:11px;color:#555}.br{text-align:right}.pr{font-size:14px;font-weight:700;color:#2b2b2b}.dt{font-size:10px;color:#888}
h1{font-size:16px;margin:4px 8px}
.bar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:4px 8px;background:var(--panel);border-bottom:1px solid var(--line)}
.bar button,.bar select,.bar input{font:inherit;padding:3px 7px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg);cursor:pointer}
.bar button.on{background:var(--accent);color:#fff;border-color:var(--accent)}.bar button:disabled{opacity:.45;cursor:default}
.bar input[type=search]{width:190px;cursor:text}.sep{width:1px;height:20px;background:var(--line);margin:0 3px}.grow{flex:1}
.simbar{background:#fff4d6;color:#000;border-bottom:2px solid #e69138}
.wrap{flex:1;overflow:auto;position:relative}
table{border-collapse:separate;border-spacing:0;table-layout:fixed}
th,td{border-right:.6px solid var(--line);border-bottom:.6px solid var(--line);padding:0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:var(--rowh);line-height:calc(var(--rowh) - 2px)}
th{position:sticky;top:0;z-index:3;background:var(--head);height:auto;line-height:1.15;padding:4px 3px;vertical-align:bottom;text-align:left;cursor:pointer;user-select:none}
th.f{background:#cfe3ff;color:#000}th .s{font-size:10px;color:var(--accent)}th .rz{position:absolute;right:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:4}
th:first-child,td:first-child{position:sticky;left:0;z-index:2}th:first-child{z-index:5}
td:first-child{background:var(--rb,var(--bg))}
th.ax{padding:0;cursor:default}.axh{position:relative}.d{position:absolute;top:0;bottom:0;border-right:.5px solid #555;display:flex;align-items:flex-end;justify-content:center;overflow:hidden;color:#fff}.d span{writing-mode:vertical-rl;transform:rotate(180deg);padding-bottom:4px;white-space:nowrap}
td.ch{padding:0;overflow:visible}.lane{position:relative;height:calc(var(--rowh) - 1px);background-size:100% 100%}
.b{position:absolute;top:2px;bottom:2px;border:1px solid #000;white-space:nowrap;overflow:visible;cursor:pointer}.b.f{background:#fff}.b i{position:absolute;top:0;bottom:0;border-right:1px solid #fff}
.b .l{position:absolute;left:3px;top:50%;transform:translateY(-50%);font-weight:700;color:#000;pointer-events:none}
.ghost{position:absolute;top:1px;bottom:1px;border:2px dashed #777;background:repeating-linear-gradient(45deg,rgba(0,0,0,.08) 0 4px,transparent 4px 8px);pointer-events:none}
.ship{position:absolute;top:0;bottom:0;width:3px;background:#c00000;pointer-events:none}
tr.sel td{box-shadow:inset 0 2px 0 var(--sel),inset 0 -2px 0 var(--sel)}tr.sub td:first-child{font-style:italic}
td.cur{outline:2px solid var(--accent);outline-offset:-2px}td.chg{outline:2px solid #e65100;outline-offset:-2px;font-weight:700}td.late{background:#ff0000!important;color:#fff!important;font-weight:700}
td.ed{cursor:cell}mark{background:#ffeb3b;color:#000;padding:0}
tr.komis td{font-weight:700;border-top:2px solid #000}
.tot{display:flex;gap:14px;flex-wrap:wrap;padding:4px 8px;border-top:1px solid var(--line);background:var(--panel);font-size:12px}
.pop{position:fixed;z-index:20;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:8px;max-height:80vh;overflow:auto;min-width:240px}
.pop h3{margin:0 0 6px;font-size:13px}.pop label{display:block;margin:2px 0;white-space:nowrap}.pop .opts{max-height:46vh;overflow:auto;border:1px solid var(--line);padding:4px;margin:4px 0}
.pop button{font:inherit;padding:3px 8px;margin:2px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg);cursor:pointer}.pop button.pri{background:var(--accent);color:#fff;border-color:var(--accent)}
.pop input[type=text],.pop input[type=search],.pop select{font:inherit;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg)}
.side{position:fixed;right:0;top:0;bottom:0;width:min(420px,95vw);z-index:15;background:var(--bg);border-left:2px solid var(--line);box-shadow:-6px 0 18px rgba(0,0,0,.2);padding:10px;overflow:auto}
.side table td{height:auto;line-height:1.3;white-space:normal;border:none;padding:2px 4px;position:static}.side h3{margin:0 0 6px}
.err{color:#c00000}.muted{color:var(--muted)}.cnt{color:var(--muted);font-size:11px;margin-left:6px}
.svgdeps{position:absolute;left:0;top:0;pointer-events:none;z-index:2;overflow:visible}
.cellin{width:100%;height:calc(var(--rowh) - 3px);border:2px solid var(--accent);font:inherit;padding:0 2px;background:var(--bg);color:var(--fg)}
@media print{.bar,.tot,.side,.pop{display:none!important}.wrap{overflow:visible}#app{height:auto}th{position:static}}
`;

function boot() {
  const shell = '<!doctype html>\n' + document.documentElement.outerHTML;   // do zapisu kopii z symulacją (przed rysowaniem)
  const dataEl = document.getElementById('zks-data');
  const D = JSON.parse(dataEl.textContent);
  const app = document.getElementById('app');
  const style = document.createElement('style'); style.textContent = STYLE; document.head.append(style);
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const saved = (store && loadPrefs(store)) || {};
  const F = Object.fromEntries(FEATURES.map(([k]) => [k, true]));
  Object.assign(F, saved.features || {});
  const cfg = D.cfg || {}, stations = stationList(cfg), stationNames = stations.map((s) => s.name), look = Object.fromEntries(stations.map((s) => [s.name, s]));
  const holidays = holidayMap(cfg.holidays), nowMs = D.nowMs || Date.now();
  const komisStyle = (k) => (cfg.komisColors || []).find((x) => x.komis === String(k || '').trim()) || null;
  const view = D.view || {};
  const S = {
    ops: clone(D.ops || {}), baseOps: clone(D.baseOps || D.ops || {}), changes: D.changes || [], undo: [],
    filters: {}, sorts: saved.sorts || [], search: '', hidden: new Set(saved.hidden || COLS.filter((c) => view.cols && !view.cols.includes(c.key) && c.key !== 'delta').map((c) => c.key)),
    colW: saved.colW || {}, zoom: saved.zoom || 1, interval: saved.interval || view.interval || 'd', shiftDays: 0, mode: saved.mode || 'both',
    levelsHidden: new Set(view.levelsHidden || []), collapsed: new Set(), komisShow: view.komisShow !== false, komisInline: !!view.komisInline,
    selected: null, cursor: null, sim: !!(D.changes && D.changes.length), compare: saved.compare !== false, deps: !!saved.deps, dark: !!saved.dark, rowH: 22,
    rowIds: view.rowIds ? new Set(view.rowIds) : null,
  };
  const remember = () => { if (store && F.remember) savePrefs(store, { features: F, hidden: [...S.hidden], colW: S.colW, zoom: S.zoom, interval: S.interval, mode: S.mode, compare: S.compare, deps: S.deps, dark: S.dark, sorts: S.sorts }); };
  const days = D.days || {};
  const build = (ops) => buildHarmData(ops, days, cfg, nowMs);
  let base = build(S.baseOps), data = build(S.ops);
  const recompute = () => { data = build(S.ops); };
  document.body.classList.toggle('dark', S.dark && F.theme);

  // ---- wartości komórek ----
  const deltaOf = (r) => { if (r.komisRow) return 0; const a = base.result.get(r.id), b = data.result.get(r.id); return a && b && a.end != null && b.end != null ? b.end - a.end : 0; };
  const val = (r, c) => (c.key === 'delta' ? fmtDelta(deltaOf(r)) : c.isDate ? noMin(r[c.key]) : c.key === 'hours' ? String(r.hoursShown ?? '') : String(r[c.key] ?? ''));
  const shownCols = () => COLS.filter((c) => !S.hidden.has(c.key) && (c.key !== 'delta' || (S.sim && F.compare)) && (S.mode !== 'chart' || c.key === 'lp'));
  const colW = (c) => S.colW[c.key] || c.w;

  function rowsForView() {
    let all = data.rows;
    if (S.rowIds) all = all.filter((r) => S.rowIds.has(r.id) || !(r.id in S.baseOps));
    if (S.search) { const q = S.search.toLowerCase(); all = all.filter((r) => COLS.some((c) => val(r, c).toLowerCase().includes(q))); }
    let rows = visibleRows(all, COLS, S.filters, val);
    if (S.sorts.length) rows = sortRows(rows, COLS, S.sorts, val);
    rows = arrangeRows(rows, S.collapsed, S.levelsHidden);
    if (F.komis && S.komisShow) {
      const ids = new Set(all.map((r) => String(r.komis || '').trim()));
      rows = withKomisRows(rows, [...data.komisRows.values()].filter((k) => ids.has(k.komisName)), S.collapsed, { inline: S.komisInline });
    }
    return rows;
  }

  // ---- oś czasu ----
  function axis(rows) {
    const iv = intervalOf(S.interval), DAY = 86400000;
    let start = view.axisStart ?? Math.min(...rows.map((r) => (data.result.get(r.id) || {}).start).filter((x) => x != null), nowMs);
    start = Math.floor(start / DAY) * DAY + S.shiftDays * DAY;
    let end = Math.max(start + 7 * DAY, ...rows.map((r) => (r.komisRow ? r.ms && r.ms.koniec : (data.result.get(r.id) || {}).end) || 0));
    if (view.axisEnd && !S.sim) end = Math.max(end, view.axisEnd);
    end = Math.min(end, start + 2000 * iv.hours * 3600000);
    const cells = buildCells(start, end + DAY, S.interval, holidays);
    const pxH = 18 / iv.hours, W = Math.ceil(cells.reduce((a, c) => a + c.hours, 0) * pxH);
    return { cells, start, pxH, W, X: (ms) => Math.max(0, (ms - start) / 3600000) * pxH };
  }

  // ---- rysowanie ----
  const wrap = document.createElement('div'); wrap.className = 'wrap';
  const tot = document.createElement('div'); tot.className = 'tot';
  let lastRows = [], lastAxis = null;
  function render() {
    const rows = rowsForView(); lastRows = rows;
    const cols = shownCols(), showChart = S.mode !== 'table';
    const A = showChart ? axis(rows) : null; lastAxis = A;
    const q = S.search && F.search ? S.search.toLowerCase() : '';
    const hi = (t) => { const s = esc(t); if (!q) return s; const i = String(t).toLowerCase().indexOf(q); return i < 0 ? s : esc(String(t).slice(0, i)) + '<mark>' + esc(String(t).slice(i, i + q.length)) + '</mark>' + esc(String(t).slice(i + q.length)); };
    const changed = new Map(); for (const c of S.changes) { if (!changed.has(c.id)) changed.set(c.id, new Set()); changed.get(c.id).add(c.field === 'preds' ? 'z' : c.field); }
    const tableW = cols.reduce((a, c) => a + colW(c), 0) + (A ? A.W : 0);
    let h = `<table style="zoom:${S.zoom};width:${tableW}px"><colgroup>${cols.map((c) => `<col style="width:${colW(c)}px">`).join('')}${A ? `<col style="width:${A.W}px">` : ''}</colgroup><thead><tr>`;
    for (const c of cols) {
      const si = S.sorts.findIndex((s) => s.key === c.key), f = !!S.filters[c.key];
      h += `<th data-col="${c.key}" class="${f ? 'f' : ''}" title="${esc(c.title)}${F.filters ? ' – kliknij: filtr i sortowanie' : ''}">${esc(c.title)}${f ? ' ▼' : ''}${si >= 0 ? ` <span class="s">${S.sorts[si].ascending ? '↑' : '↓'}${S.sorts.length > 1 ? si + 1 : ''}</span>` : ''}${F.resize ? '<span class="rz"></span>' : ''}</th>`;
    }
    if (A) {
      let ax = '', x = 0; const nowIn = F.today && nowMs > A.start;
      for (const c of A.cells) { const w = c.hours * A.pxH; ax += `<div class="d" style="left:${x}px;width:${w}px;background:${DAY_BG[c.kind] || DAY_BG.work};color:${c.kind === 'sat' ? '#000' : '#fff'}" title="${esc(c.label + (c.holidayName ? ' – ' + c.holidayName : ''))}">${w >= 10 ? `<span>${esc(c.label)}</span>` : ''}</div>`; x += w; }
      h += `<th class="ax"><div class="axh" style="width:${A.W}px;height:86px">${ax}${nowIn ? `<div style="position:absolute;left:${A.X(nowMs) - 1}px;top:0;bottom:0;width:2px;background:#ff6600"></div>` : ''}</div></th>`;
    }
    h += '</tr></thead><tbody>';
    // tło osi: dni robocze szare, weekend i święta białe, teraz zielone – jeden obrazek na wszystkie wiersze
    let laneBg = '';
    if (A) {
      const parts = [`<rect width="${A.W}" height="10" fill="${S.dark ? '#2a2c30' : '#f2f2f2'}"/>`]; let x = 0;
      for (const c of A.cells) { const w = c.hours * A.pxH; if (c.kind === 'sat' || c.kind === 'sun' || c.kind === 'holiday') parts.push(`<rect x="${x}" width="${w}" height="10" fill="${S.dark ? '#34363b' : '#fff'}"/>`); if (nowMs >= c.start && nowMs < c.end) parts.push(`<rect x="${x}" width="${w}" height="10" fill="rgba(0,176,80,.18)"/>`); x += w; }
      if (F.today && nowMs > A.start) parts.push(`<rect x="${A.X(nowMs) - 1}" width="2" height="10" fill="#ff6600"/>`);
      laneBg = `url('data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${A.W}" height="10" preserveAspectRatio="none">${parts.join('')}</svg>`).replace(/'/g, '%27')}')`;   // apostrofy: wewnątrz atrybutu style="…"
    }
    rows.forEach((r, i) => {
      const ks = komisStyle(r.komis), done = isDone(r);
      const bg = r.komisRow ? (ks ? ks.bg : '#fff2cc') : ks ? ks.bg : done ? '#e6f2e0' : '';
      const fg = ks ? ks.color : '';
      const op = data.result.get(r.id) || {};
      const late = F.late && !done && !r.komisRow && (() => { const w = (S.ops[r.id] || {}).wysylka; return w != null && op.end != null && op.end > w; })();
      h += `<tr data-id="${esc(r.id)}" data-i="${i}" class="${r.komisRow ? 'komis' : ''}${r.sub ? ' sub' : ''}${S.selected === r.id ? ' sel' : ''}" style="${bg ? `background:${bg};--rb:${bg};` : ''}${fg ? `color:${fg};` : ''}${ks && ks.bold ? 'font-weight:700;' : ''}${ks && ks.italic ? 'font-style:italic;' : ''}">`;
      for (const c of cols) {
        let t = val(r, c), cls = [];
        if (c.key === 'lp') t = (r.komisRow ? (S.collapsed.has(r.id) ? '▸' : '▾') : '  '.repeat(r.depth || 0) + (r.subCount ? (S.collapsed.has(r.id) ? '▸ ' : '▾ ') : r.sub ? '↳ ' : '') + t);
        if (S.sim && F.sim && !r.komisRow && (c.edit || c.pred !== undefined)) cls.push('ed');
        const ch = changed.get(r.id);
        if (ch && (ch.has(c.key) || (c.pred !== undefined && ch.has('z')) || (c.key === 'lp' && ch.has('new')))) cls.push('chg');
        if (c.key === 'koniec' && (late || (r.komisRow && r.late && F.late))) cls.push('late');
        if (S.cursor && S.cursor.id === r.id && S.cursor.key === c.key) cls.push('cur');
        let st = '';
        if (c.key === 'station' && r.station) st = `background:${r.stanowiskoBg};color:${r.stanowiskoColor};font-weight:700;font-style:italic`;
        if (c.key === 'delta' && t) st = deltaOf(r) > 0 ? 'color:#c00000;font-weight:700' : 'color:#1e7b34;font-weight:700';
        h += `<td data-col="${c.key}" class="${cls.join(' ')}" style="${st}" title="${esc(c.key === 'element' ? t : '')}">${hi(t)}</td>`;
      }
      if (A) h += `<td class="ch"><div class="lane" style="width:${A.W}px;background-image:${laneBg}">${lane(r, A, done)}</div></td>`;
      h += '</tr>';
    });
    h += '</tbody></table>';
    const sy = wrap.scrollTop, sx = wrap.scrollLeft;
    wrap.innerHTML = h;
    wrap.scrollTop = sy; wrap.scrollLeft = sx;
    if (A && F.deps && S.deps) drawDeps(rows, A);
    renderTotals(rows);
    syncBar();
  }
  function lane(r, A, done) {
    const label = esc(r.komisRow ? [r.komisName, r.hoursShown, r.status].filter(Boolean).join(' · ') : (view.chartFields || ['komis', 'element', 'hours']).map((k) => (k === 'hours' ? r.godziny : k === 'station' ? r.stanowisko : ['start', 'koniec', 'wysylka'].includes(k) ? noMin(r[k]) : r[k])).map((v) => String(v ?? '').trim()).filter(Boolean).join(' - '));
    const fs = view.chartFontPx ? `font-size:${view.chartFontPx}px;` : '';
    const ks = komisStyle(r.komis);
    const fill = (stationColor) => (done ? ZAK : view.komisColor && ks ? `linear-gradient(to right, ${stationColor} 0 10px, ${ks.bg} 10px)` : stationColor);
    let out = '';
    if (S.sim && F.compare && S.compare && !r.komisRow) {
      const b = base.result.get(r.id), n = data.result.get(r.id);
      if (b && b.start != null && b.end != null && b.end > A.start && (!n || n.start !== b.start || n.end !== b.end)) out += `<div class="ghost" style="left:${A.X(b.start)}px;width:${Math.max(2, A.X(b.end) - A.X(b.start))}px" title="Przed zmianą: ${esc(fmtDt(b.start))} → ${esc(fmtDt(b.end))}"></div>`;
    }
    const segs = r.komisRow ? r.segs : r.segs && r.segs.length ? r.segs : null;
    if (segs && segs.length && Math.max(...segs.map((s) => s[1])) > A.start) {
      const L = A.X(Math.min(...segs.map((s) => s[0]))), R = A.X(Math.max(...segs.map((s) => s[1])));
      out += `<div class="b f" data-bar="${esc(r.id)}" style="left:${L}px;width:${Math.max(2, R - L)}px;${r.komisRow ? 'border-width:2px;' : ''}" title="${esc(`${r.komisRow ? 'Komis ' + r.komisName : r.lp}\n${r.start} → ${r.koniec}`)}">`;
      for (const [s0, e0, c] of segs) out += `<i style="left:${A.X(s0) - L - 1}px;width:${Math.max(1, A.X(e0) - A.X(s0))}px;background:${r.komisRow ? c : fill(c)}"></i>`;
      out += `<span class="l" style="${fs}${r.komisRow ? 'background:rgba(255,255,255,.75);padding:0 2px' : ''}">${label}</span></div>`;
    } else {
      const op = data.result.get(r.id);
      if (op && op.start != null && op.end != null && op.end > A.start) out += `<div class="b" data-bar="${esc(r.id)}" style="left:${A.X(op.start)}px;width:${Math.max(2, A.X(op.end) - A.X(op.start))}px;background:${fill(r.stanowiskoBg)}" title="${esc(`${r.lp} ${r.element || ''}\n${r.start} → ${r.koniec}`)}"><span class="l" style="${fs}${view.komisColor && ks ? 'padding-left:10px' : ''}">${label}</span></div>`;
    }
    const w = r.komisRow ? (r.ms && r.ms.wysylka) : (S.ops[r.id] || {}).wysylka;
    if (F.late && w != null && w > A.start) out += `<div class="ship" style="left:${A.X(w) - 1}px" title="Wysyłka: ${esc(fmtDt(w))}"></div>`;
    return out;
  }
  function drawDeps(rows, A) {
    const tb = wrap.querySelector('tbody'); if (!tb) return;
    const idx = new Map(rows.map((r, i) => [r.id, i])), trs = tb.rows, lanes = wrap.querySelectorAll('td.ch');
    if (!lanes.length) return;
    const wb = wrap.getBoundingClientRect(), lb = lanes[0].getBoundingClientRect();
    const ox = lb.left - wb.left + wrap.scrollLeft, oy0 = trs[0].getBoundingClientRect().top - wb.top + wrap.scrollTop;
    const rh = trs[0].getBoundingClientRect().height;
    let p = '';
    for (const r of rows) {
      if (r.komisRow) continue;
      const me = data.result.get(r.id); if (!me || me.start == null) continue;
      for (const pr of (S.ops[r.id] || {}).preds || []) {
        const j = idx.get(pr), o = data.result.get(pr); if (j == null || !o || o.end == null) continue;
        const x1 = ox + A.X(o.end) * S.zoom, y1 = oy0 + (j + 0.5) * rh, x2 = ox + A.X(me.start) * S.zoom, y2 = oy0 + (idx.get(r.id) + 0.5) * rh;
        p += `<path d="M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${y2} ${x2},${y2}" fill="none" stroke="#555" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#ar)"/>`;
      }
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'svgdeps'); svg.setAttribute('width', wrap.scrollWidth); svg.setAttribute('height', wrap.scrollHeight);
    svg.innerHTML = '<defs><marker id="ar" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#555"/></marker></defs>' + p;
    wrap.append(svg);
  }
  function renderTotals(rows) {
    if (!F.totals) { tot.style.display = 'none'; return; }
    tot.style.display = '';
    const ops = rows.filter((r) => !r.komisRow), leaves = ops.filter((r) => !r.subCount);
    const hours = leaves.reduce((a, r) => a + (Number(String(r.hours).replace(',', '.')) || 0), 0);
    const late = ops.filter((r) => { const w = (S.ops[r.id] || {}).wysylka, e = (data.result.get(r.id) || {}).end; return !isDone(r) && w != null && e != null && e > w; }).length;
    const all = data.rows.filter((r) => !S.rowIds || S.rowIds.has(r.id)).length;
    let t = `<span>Wiersze: <b>${ops.length}</b> z ${all}</span><span>Suma godzin (operacje bez suboperacji): <b>${Math.round(hours * 10) / 10}</b></span><span>Spóźnione (koniec po wysyłce): <b style="color:${late ? '#c00000' : 'inherit'}">${late}</b></span>`;
    if (S.sim) {
      let moved = 0, worst = 0;
      for (const [id, r] of data.result) { const b = base.result.get(id); if (b && b.end != null && r.end != null && b.end !== r.end) { moved++; worst = Math.max(worst, r.end - b.end); } }
      t += `<span>Symulacja: zmian <b>${S.changes.length}</b>, przesuniętych terminów <b>${moved}</b>${worst > 0 ? `, największe opóźnienie <b style="color:#c00000">${fmtDelta(worst)}</b>` : ''}</span>`;
    }
    t += `<span class="grow"></span><span class="muted">${esc(D.generated || '')}</span>`;
    tot.innerHTML = t;
  }

  // ---- pasek narzędzi ----
  const bar = document.createElement('div'); bar.className = 'bar';
  const simbar = document.createElement('div'); simbar.className = 'bar simbar';
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'feature') { if (v) e.dataset.feature = v; } else if (v != null) e.setAttribute(k, v); } for (const c of kids) if (c != null) e.append(c); return e; };
  const btn = (label, title, onclick, feature) => el('button', { title, onclick, feature }, label);
  const search = el('input', { type: 'search', placeholder: 'Szukaj (Ctrl+F)…', feature: 'search', oninput: () => { S.search = search.value.trim(); render(); } });
  const ivSel = el('select', { title: 'Interwał osi czasu', feature: 'axis', onchange: () => { S.interval = ivSel.value; remember(); render(); } }, ...INTERVALS.map((iv) => el('option', { value: iv.id }, iv.label)));
  const zoomLbl = el('button', { title: 'Powiększenie 100%', feature: 'zoom', onclick: () => setZoom(1) }, '100%');
  const setZoom = (z) => { S.zoom = Math.max(0.3, Math.min(3, Math.round(z * 100) / 100)); remember(); render(); };
  const lvl = [3, 2, 1].map((l) => btn(['', 'I', 'II', 'III'][l], `Poziom ${['', 'I', 'II', 'III'][l]} – pokaż / ukryj`, () => { if (S.levelsHidden.has(l)) S.levelsHidden.delete(l); else S.levelsHidden.add(l); render(); }, 'levels'));
  const komisB = btn('Σ', 'Paski podsumowania komisów', () => { S.komisShow = !S.komisShow; render(); }, 'komis');
  const depsB = btn('⤳', 'Linie zależności (poprzednik → operacja)', () => { S.deps = !S.deps; remember(); render(); }, 'deps');
  const modeSel = el('select', { title: 'Widok', feature: 'view', onchange: () => { S.mode = modeSel.value; remember(); render(); } }, el('option', { value: 'both' }, 'Tabela + wykres'), el('option', { value: 'table' }, 'Tylko tabela'), el('option', { value: 'chart' }, 'Tylko wykres'));
  const simB = btn('✎ Symulacja', 'Tryb symulacji: zmieniaj godziny, daty, stanowiska, zależności i status – terminy liczą się od nowa. Zmiany są tylko w tym pliku.', () => { S.sim = !S.sim; render(); }, 'sim');
  bar.append(search,
    btn('✕ Filtry', 'Wyczyść filtry, sortowanie i szukanie', () => { S.filters = {}; S.sorts = []; S.search = ''; search.value = ''; remember(); render(); }, 'filters'),
    btn('Kolumny', 'Wybór kolumn', (e) => columnsPop(e.currentTarget), 'columns'),
    el('span', { class: 'sep' }), ...lvl, btn('Zwiń', 'Zwiń wszystkie operacje z suboperacjami', () => { for (const r of data.rows) if (r.subCount) S.collapsed.add(r.id); render(); }, 'levels'), btn('Rozwiń', 'Rozwiń wszystko', () => { S.collapsed.clear(); render(); }, 'levels'), komisB,
    el('span', { class: 'sep' }), ivSel, btn('◀', 'Oś: tydzień wcześniej', () => { S.shiftDays -= 7; render(); }, 'axis'), btn('Dziś', 'Oś od dziś', () => { S.shiftDays = Math.round((Math.floor(nowMs / 86400000) * 86400000 - (view.axisStart ?? nowMs)) / 86400000); render(); }, 'axis'), btn('▶', 'Oś: tydzień później', () => { S.shiftDays += 7; render(); }, 'axis'),
    el('span', { class: 'sep' }), btn('−', 'Pomniejsz', () => setZoom(S.zoom / 1.15), 'zoom'), zoomLbl, btn('+', 'Powiększ', () => setZoom(S.zoom * 1.15), 'zoom'), btn('Dopasuj', 'Dopasuj szerokość do okna', () => { const t = wrap.querySelector('table'); if (t) setZoom(S.zoom * (wrap.clientWidth - 4) / t.getBoundingClientRect().width); }, 'zoom'),
    depsB, modeSel,
    el('span', { class: 'sep' }), simB, btn('⚠', 'Konflikty i błędy (pętle, brakujący poprzednicy, daty…)', (e) => conflictsPop(e.currentTarget), 'conflicts'),
    el('span', { class: 'grow' }),
    btn('CSV', 'Widoczne wiersze i kolumny do pliku CSV', exportCsv, 'csv'), btn('Excel', 'Widoczne wiersze i kolumny do pliku Excel (.xlsx)', exportXlsx, 'xlsx'), btn('🖨', 'Drukuj widok', () => window.print(), 'print'),
    btn('⛶', 'Pełny ekran', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }, 'fullscreen'),
    btn('◐', 'Motyw jasny / ciemny', () => { S.dark = !S.dark; document.body.classList.toggle('dark', S.dark); remember(); render(); }, 'theme'),
    el('button', { title: 'Funkcje pliku i zapisane ustawienia', onclick: (e) => featuresPop(e.currentTarget) }, '⚙'), el('button', { title: 'Pomoc i skróty', onclick: (e) => helpPop(e.currentTarget) }, '?'));
  const simInfo = el('b', {}, '');
  simbar.append(el('span', {}, '✎ Symulacja – zmiany są tylko w tym pliku (baza się nie zmienia). Dwuklik albo Enter na komórce: edycja.'), simInfo,
    btn('+ Operacja', 'Dodaj operację na próbę', (e) => addOpPop(e.currentTarget), 'simAdd'),
    btn('↶ Cofnij', 'Cofnij ostatnią zmianę symulacji', simUndo), btn('Lista zmian', 'Lista zmian symulacji', (e) => changesPop(e.currentTarget)),
    btn('Porównanie', 'Szary pasek = termin przed zmianą, kolumna Δ koniec', () => { S.compare = !S.compare; remember(); render(); }, 'compare'),
    btn('Kopiuj zmiany', 'Lista zmian do schowka (np. do maila)', copyChanges), btn('Zmiany CSV', 'Lista zmian i przesunięć terminów do pliku CSV', () => download('symulacja_zmiany.csv', 'text/csv;charset=utf-8', changesCsv(S.changes, base.result, data.result))),
    btn('Zapisz kopię pliku', 'Plik HTML z tą symulacją (oryginał zostaje do porównania)', saveSimCopy, 'simSave'),
    btn('Resetuj', 'Usuń wszystkie zmiany symulacji', () => { if (S.changes.length && !confirm('Usunąć wszystkie zmiany symulacji?')) return; S.ops = clone(S.baseOps); S.changes = []; S.undo = []; recompute(); render(); }));
  function syncBar() {
    for (const b of [...bar.querySelectorAll('[data-feature]'), ...simbar.querySelectorAll('[data-feature]')]) b.style.display = F[b.dataset.feature] ? '' : 'none';
    zoomLbl.textContent = Math.round(S.zoom * 100) + '%'; ivSel.value = S.interval; modeSel.value = S.mode;
    lvl.forEach((b, i) => b.classList.toggle('on', !S.levelsHidden.has(3 - i)));
    komisB.classList.toggle('on', S.komisShow); depsB.classList.toggle('on', S.deps); simB.classList.toggle('on', S.sim);
    simbar.style.display = S.sim && F.sim ? '' : 'none';
    simInfo.textContent = S.changes.length ? ` Zmian: ${S.changes.length}` : '';
    for (const b of simbar.querySelectorAll('button')) if (b.textContent === 'Porównanie') b.classList.toggle('on', S.compare);
  }

  // ---- okienka (filtr kolumny, kolumny, funkcje, konflikty, zmiany, pomoc) ----
  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  function openPop(anchor, content) {
    closePop();
    pop = el('div', { class: 'pop' }, content);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 4) + 'px';
    return pop;
  }
  document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('.bar') && !e.target.closest('th')) closePop(); });
  function filterPop(th, c) {
    if (!F.filters && !F.sort) return;
    const allRows = data.rows.filter((r) => !S.rowIds || S.rowIds.has(r.id) || !(r.id in S.baseOps));
    const opts = filterOptions(allRows, COLS, S.filters, val, c);
    const cur = S.filters[c.key], selected = new Set(cur && !isRangeFilter(cur) ? [...cur] : opts.map((o) => o.value));
    const list = el('div', { class: 'opts' }), q = el('input', { type: 'search', placeholder: 'Szukaj wartości…', style: 'width:100%' });
    const draw = () => { list.innerHTML = ''; const t = q.value.trim().toLowerCase(); for (const o of opts) { if (t && !(o.value || '(puste)').toLowerCase().includes(t)) continue; const cb = el('input', { type: 'checkbox' }); cb.checked = selected.has(o.value); cb.onchange = () => { if (cb.checked) selected.add(o.value); else selected.delete(o.value); }; list.append(el('label', {}, cb, ' ' + (o.value || '(puste)'), el('span', { class: 'cnt' }, String(o.count)))); } };
    q.oninput = () => { const t = q.value.trim().toLowerCase(); if (t) { selected.clear(); opts.filter((o) => (o.value || '(puste)').toLowerCase().includes(t)).forEach((o) => selected.add(o.value)); } draw(); };
    const sortBtn = (asc, label) => el('button', { onclick: () => { S.sorts = [{ key: c.key, ascending: asc }, ...S.sorts.filter((s) => s.key !== c.key)]; remember(); closePop(); render(); } }, label);
    const addSort = (asc, label) => el('button', { title: 'Dodaj jako kolejny poziom sortowania', onclick: () => { S.sorts = [...S.sorts.filter((s) => s.key !== c.key), { key: c.key, ascending: asc }]; remember(); closePop(); render(); } }, label);
    let range = null;
    if (c.isDate) {
      const f = el('input', { type: 'text', placeholder: 'od dd.mm.rrrr', style: 'width:110px', value: cur && isRangeFilter(cur) && cur.from != null ? fmtDt(cur.from).slice(0, 10) : '' });
      const t = el('input', { type: 'text', placeholder: 'do dd.mm.rrrr', style: 'width:110px', value: cur && isRangeFilter(cur) && cur.to != null ? fmtDt(cur.to).slice(0, 10) : '' });
      range = el('div', {}, el('div', { class: 'muted' }, 'Zakres dat:'), f, ' – ', t, el('button', { onclick: () => { const a = f.value.trim() ? parseDateTime(f.value) : null, b = t.value.trim() ? parseDateTime(t.value) : null; if (a == null && b == null) return; S.filters[c.key] = rangeFilter(a, b); closePop(); render(); } }, 'Filtruj zakresem'));
    }
    draw();
    openPop(th, el('div', {}, el('h3', {}, c.title),
      F.sort ? el('div', {}, 'Sortuj: ', sortBtn(true, 'A→Z'), sortBtn(false, 'Z→A'), addSort(true, '+ poziom A→Z'), addSort(false, '+ poziom Z→A'), el('button', { onclick: () => { S.sorts = S.sorts.filter((s) => s.key !== c.key); remember(); closePop(); render(); } }, 'Bez sortowania')) : null,
      F.filters ? el('div', {}, range, q, list, el('button', { onclick: () => { opts.forEach((o) => selected.add(o.value)); draw(); } }, 'Zaznacz wszystko'), el('button', { onclick: () => { selected.clear(); draw(); } }, 'Odznacz wszystko')) : null,
      el('div', {}, el('button', { onclick: closePop }, 'Anuluj'), F.filters ? el('button', { class: 'pri', onclick: () => { if (selected.size === opts.length) delete S.filters[c.key]; else S.filters[c.key] = new Set(selected); closePop(); render(); } }, 'OK') : null)));
    q.focus();
  }
  function columnsPop(anchor) {
    const boxes = COLS.filter((c) => c.key !== 'delta').map((c) => { const cb = el('input', { type: 'checkbox' }); cb.checked = !S.hidden.has(c.key); cb.onchange = () => { if (cb.checked) S.hidden.delete(c.key); else S.hidden.add(c.key); remember(); render(); }; return el('label', {}, cb, ' ' + c.title); });
    openPop(anchor, el('div', {}, el('h3', {}, 'Kolumny'), ...boxes, el('div', {}, el('button', { onclick: () => { S.hidden.clear(); remember(); closePop(); render(); } }, 'Wszystkie'), el('button', { onclick: () => { S.colW = {}; remember(); render(); } }, 'Domyślne szerokości'))));
  }
  function featuresPop(anchor) {
    const boxes = FEATURES.map(([k, label, tip]) => { const cb = el('input', { type: 'checkbox' }); cb.checked = !!F[k]; cb.onchange = () => { F[k] = cb.checked; if (k === 'remember' && !cb.checked && store) { try { store.removeItem(PREF_KEY); } catch { /* */ } } remember(); render(); }; return el('label', { title: tip }, cb, ' ' + label); });
    openPop(anchor, el('div', {}, el('h3', {}, 'Funkcje pliku'), el('div', { class: 'muted', style: 'white-space:normal;max-width:360px' }, 'Wyłączone funkcje znikają z paska. Ustawienia zapisują się w jednym wpisie przeglądarki, wspólnym dla wszystkich plików z programu ZKS PO (nowy plik nadpisuje stary wpis – nic się nie gromadzi).'), ...boxes,
      el('div', {}, el('button', { onclick: () => { FEATURES.forEach(([k]) => { F[k] = true; }); remember(); closePop(); render(); } }, 'Wszystkie włączone'),
        el('button', { title: 'Usuwa zapisane ustawienia z przeglądarki', onclick: () => { try { store && store.removeItem(PREF_KEY); } catch { /* */ } alert('Usunięto zapisane ustawienia. Odśwież stronę, aby wrócić do ustawień z pliku.'); } }, 'Wyczyść zapisane ustawienia'))));
  }
  function conflictsPop(anchor) {
    const list = findIssues(S.ops, { ends: new Map([...data.result].filter(([, v]) => v.end != null).map(([k, v]) => [k, v.end])), stations: new Set(stationNames) });
    openPop(anchor, el('div', { style: 'max-width:520px' }, el('h3', {}, `Konflikty i błędy (${list.length})`),
      list.length ? el('div', {}, ...list.slice(0, 300).map((x) => el('div', { style: `cursor:pointer;padding:2px 0;color:${x.level === 'error' ? '#c00000' : '#7a5a00'};white-space:normal`, onclick: () => { closePop(); goTo(x.lp); } }, (x.level === 'error' ? '⛔ ' : '⚠ ') + x.text))) : el('div', { class: 'muted' }, 'Brak konfliktów i błędów.')));
  }
  function changesPop(anchor) {
    openPop(anchor, el('div', { style: 'max-width:520px' }, el('h3', {}, `Zmiany symulacji (${S.changes.length})`),
      S.changes.length ? el('div', {}, ...S.changes.map((c) => el('div', { style: 'cursor:pointer;padding:2px 0;white-space:normal', onclick: () => { closePop(); goTo(c.id); } }, `${c.id}: ${FIELD_LABEL[c.field] || c.field} ${fmtSimValue(c.field, c.old)} → ${fmtSimValue(c.field, c.value)}`))) : el('div', { class: 'muted' }, 'Brak zmian.')));
  }
  function helpPop(anchor) {
    openPop(anchor, el('div', { style: 'max-width:460px;white-space:normal' }, el('h3', {}, 'Pomoc'),
      el('div', {}, 'Klik w nagłówek kolumny: filtr i sortowanie (jak w Excelu). Klik w wiersz albo pasek: szczegóły operacji. Strzałka ▾ w lp.: zwiń / rozwiń suboperacje.'),
      el('div', { style: 'margin-top:6px' }, el('b', {}, 'Klawiatura: '), 'strzałki – ruch po komórkach, Enter / F2 – edycja w symulacji, Esc – zamknij, Ctrl+F – szukaj, Ctrl + / Ctrl − – powiększenie.'),
      el('div', { style: 'margin-top:6px' }, el('b', {}, 'Symulacja: '), 'włącz „✎ Symulacja”, zmień czas, daty, stanowisko, zależności (Z1–Z4) albo status – terminy liczą się od nowa tym samym silnikiem co w programie, z obsadą maszyn z grafiku. Szary pasek pokazuje termin przed zmianą, kolumna Δ koniec – przesunięcie. Listę zmian możesz skopiować albo zapisać i odesłać planiście.'),
      el('div', { style: 'margin-top:6px' }, el('b', {}, 'Ustawienia: '), 'kolumny, szerokości, powiększenie i włączone funkcje zapamiętują się w jednym wpisie przeglądarki, wspólnym dla wszystkich plików z programu (⚙ – wyczyść).')));
  }
  function goTo(id) {
    let p = subParent(id); while (p) { S.collapsed.delete(p); p = subParent(p); }
    S.selected = id; render();
    const tr = wrap.querySelector(`tr[data-id="${CSS.escape(id)}"]`); if (tr) tr.scrollIntoView({ block: 'center' });
    if (F.details) showDetails(id);
  }

  // ---- szczegóły operacji (panel z prawej) ----
  let side = null;
  function showDetails(id) {
    if (side) side.remove();
    const r = data.rows.find((x) => x.id === id) || data.komisRows.get(String(id).slice(KOMIS_PREFIX.length));
    if (!r) return;
    const line = (k, v) => (String(v ?? '').trim() ? `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>` : '');
    const b = base.result.get(id), n = data.result.get(id);
    const subs = data.rows.filter((x) => x.parent === id);
    side = el('div', { class: 'side' });
    side.innerHTML = `<button style="float:right" data-x>✕</button><h3>${r.komisRow ? 'Komis ' + esc(r.komisName) : 'Operacja ' + esc(r.lp || r.id)}</h3><table>${
      line('Komis', r.komis) + line('Klient', r.client) + line('Opis', r.element) + line('Stanowisko', r.stanowisko) + line('Start', r.start) + line('Koniec', r.koniec)
      + (S.sim && b && n && b.end !== n.end ? line('Koniec przed zmianą', fmtDt(b.end)) + line('Przesunięcie', fmtDelta((n.end ?? 0) - (b.end ?? 0))) : '')
      + line('Godziny', r.hoursShown || r.godziny) + line('Wysyłka', r.wysylka) + line('Dostawa', r.dostawa) + line('Start ręczny', r.startManual) + line('Koniec ręczny', r.endManual) + line('Status', r.status)
      + line('Poprzednicy', [r.z1, r.z2, r.z3, r.z4].filter(Boolean).join(', '))}</table>${subs.length ? `<h3 style="margin-top:8px">Suboperacje (${subs.length})</h3>` + subs.map((x) => `<div data-go="${esc(x.id)}" style="cursor:pointer;padding:2px 0">${esc(x.lp)} · ${esc(x.start || '—')} → ${esc(x.koniec || '—')}${x.element ? ' · ' + esc(x.element) : ''}</div>`).join('') : ''}${
      S.sim && F.sim && !r.komisRow ? '<p class="muted">Symulacja: dwuklik na komórce w tabeli zmienia wartość.</p>' : ''}`;
    side.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) { side.remove(); side = null; } const g = e.target.closest('[data-go]'); if (g) goTo(g.dataset.go); });
    side.style.top = Math.max(0, wrap.getBoundingClientRect().top) + 'px';   // pod paskiem narzędzi
    document.body.append(side);
  }

  // ---- edycja w symulacji ----
  function editCell(td, r, c) {
    if (!S.sim || !F.sim || r.komisRow || !(c.edit || c.pred !== undefined)) return;
    const op = S.ops[r.id]; if (!op) return;
    const field = c.pred !== undefined ? 'pred' : c.key;
    if (c.edit === 'status') { commit(r.id, 'status', isDone(op) ? '' : 'zak.'); return; }
    let input;
    if (c.edit === 'station') { input = el('select', { class: 'cellin' }, el('option', { value: '' }, '—'), ...stationNames.map((s) => el('option', { value: s }, s))); input.value = op.station || ''; }
    else {
      const cur = c.pred !== undefined ? (op.preds || [])[c.pred] || '' : c.isDate ? fmtDt(op[c.key]) : c.key === 'hours' ? (op.hours == null ? '' : String(op.hours).replace('.', ',')) : String(op[c.key] ?? '');
      input = el('input', { class: 'cellin', type: 'text', value: cur, placeholder: c.isDate ? 'dd.mm.rrrr gg:mm' : '' });
    }
    td.innerHTML = ''; td.append(input); input.focus(); if (input.select) input.select();
    let done = false;
    const finish = (ok, move) => {
      if (done) return; done = true;
      if (ok) {
        const p = parseSimValue(S.ops, r.id, field, input.value, c.pred);
        if (p.error) { alert(p.error); render(); return; }
        commit(r.id, p.field || (field === 'pred' ? 'preds' : c.key), p.value);
      } else render();
      if (move) moveCursor(...move);
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true, [1, 0]); } else if (e.key === 'Tab') { e.preventDefault(); finish(true, [0, e.shiftKey ? -1 : 1]); } else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    if (input.tagName === 'SELECT') input.addEventListener('change', () => finish(true));
  }
  function commit(id, field, value) {
    const before = S.ops[id] ? clone(S.ops[id]) : null;
    const { ops, change } = applySim(S.ops, id, field, value);
    if (JSON.stringify(change.old ?? null) === JSON.stringify(change.value ?? null)) { render(); return; }
    S.undo.push({ id, before, n: S.changes.length });
    S.ops = ops; S.changes = [...S.changes, change]; recompute(); render();
  }
  function simUndo() {
    const u = S.undo.pop(); if (!u) return;
    const ops = { ...S.ops }; if (u.before) ops[u.id] = u.before; else delete ops[u.id];
    S.ops = ops; S.changes = S.changes.slice(0, u.n); recompute(); render();
  }
  function addOpPop(anchor) {
    const lp = el('input', { type: 'text', placeholder: 'np. 2050 albo 600i', style: 'width:140px' });
    const komis = el('input', { type: 'text', style: 'width:140px' }), element = el('input', { type: 'text', style: 'width:260px' });
    const station = el('select', {}, ...stationNames.map((s) => el('option', { value: s }, s)));
    const hours = el('input', { type: 'text', style: 'width:80px' }), preds = el('input', { type: 'text', placeholder: 'np. 500, 600a', style: 'width:160px' }), start = el('input', { type: 'text', placeholder: 'dd.mm.rrrr gg:mm', style: 'width:140px' });
    const err = el('div', { class: 'err' });
    const row = (label, inp) => el('label', {}, el('span', { style: 'display:inline-block;width:150px' }, label), inp);
    openPop(anchor, el('div', {}, el('h3', {}, 'Nowa operacja (symulacja)'), row('Numer', lp), row('Komis', komis), row('Opis', element), row('Stanowisko', station), row('Czas [h]', hours), row('Zależności (Z1–Z4)', preds), row('Start ręczny (opcjonalnie)', start), err,
      el('div', {}, el('button', { onclick: closePop }, 'Anuluj'), el('button', { class: 'pri', onclick: () => {
        const id = lp.value.trim(), e1 = idError(id, S.ops);
        if (e1) { err.textContent = e1; return; }
        const h = parseNumber(hours.value.trim()); if (hours.value.trim() && (h == null || h < 0)) { err.textContent = 'Czas to liczba godzin'; return; }
        const ps = preds.value.split(/[,;\s]+/).filter(Boolean); if (ps.length > 4) { err.textContent = 'Najwyżej 4 zależności'; return; }
        for (const p of ps) if (!S.ops[p]) { err.textContent = `Nie ma operacji ${p}`; return; }
        const sm = start.value.trim() ? parseDateTime(start.value) : null; if (start.value.trim() && sm == null) { err.textContent = 'Nie rozpoznano daty startu'; return; }
        const op = { preds: ps, komis: komis.value.trim(), element: element.value.trim(), station: station.value, ...(h != null ? { hours: h } : {}), ...(sm != null ? { startManual: sm } : {}) };
        const tmp = { ...S.ops, [id]: op };
        for (let i = 0; i < ps.length; i++) { const pe = predError({ ...tmp, [id]: { ...op, preds: ps.filter((_, j) => j !== i) } }, id, i, ps[i]); if (pe) { err.textContent = pe; return; } }
        S.undo.push({ id, before: null, n: S.changes.length });
        S.ops = tmp; S.changes = [...S.changes, { id, field: 'new', old: null, value: `${op.komis} ${op.element} ${op.station} ${h ?? ''} h`.trim() }];
        recompute(); closePop(); goTo(id);
      } }, 'Dodaj'))));
    lp.focus();
  }
  function copyChanges() {
    const t = changesCsv(S.changes, base.result, data.result).replace(/^﻿/, '').replace(/"/g, '').replace(/;/g, '\t');
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => alert('Skopiowano listę zmian.'), () => prompt('Skopiuj listę zmian:', t));
  }
  function saveSimCopy() {
    const payload = { ...D, ops: S.ops, baseOps: S.baseOps, changes: S.changes, generated: (D.generated || '') + ' · symulacja ' + new Date().toLocaleString('pl-PL') };
    const json = JSON.stringify(payload).replace(/</g, '\\u003c');
    const html = shell.replace(/(<script type="application\/json" id="zks-data">)[\s\S]*?(<\/script>)/, (m, a, b) => a + json + b);
    download('harmonogram_symulacja.html', 'text/html;charset=utf-8', html);
  }
  function download(name, mime, content) {
    const a = el('a', { href: URL.createObjectURL(new Blob([content], { type: mime })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- eksport ----
  function exportCsv() {
    const cols = shownCols(), lines = [cols.map((c) => c.title).join(';')];
    for (const r of lastRows) lines.push(cols.map((c) => `"${String(c.key === 'lp' ? (r.komisRow ? 'Komis ' + r.komisName : r.lp) : val(r, c)).replace(/"/g, '""')}"`).join(';'));
    download('harmonogram.csv', 'text/csv;charset=utf-8', '﻿' + lines.join('\r\n'));
  }
  function exportXlsx() {
    const cols = shownCols();
    const head = cols.map((c) => ({ v: c.title, style: { bold: true, bg: '#e4e4e4', border: true } }));
    const rows = lastRows.map((r) => { const ks = komisStyle(r.komis); return cols.map((c) => {
      const style = { border: true, bg: c.key === 'station' && r.station ? r.stanowiskoBg : ks ? ks.bg : r.komisRow ? '#fff2cc' : undefined, color: c.key === 'station' && r.station ? r.stanowiskoColor : ks ? ks.color : undefined, bold: r.komisRow || (ks && ks.bold) };
      const raw = r.komisRow ? null : c.isDate ? (c.key === 'start' ? (data.result.get(r.id) || {}).start : c.key === 'koniec' ? (data.result.get(r.id) || {}).end : (S.ops[r.id] || {})[c.key]) : null;
      if (raw != null) return { v: raw, style: { ...style, date: true } };
      if (c.key === 'hours' && !r.komisRow && (S.ops[r.id] || {}).hours > 0) return { v: S.ops[r.id].hours, style };
      return { v: c.key === 'lp' ? (r.komisRow ? 'Komis ' + r.komisName : r.lp) : val(r, c), style };
    }); });
    const bytes = buildXlsx({ name: 'Harmonogram', rows: [head, ...rows], colWidths: cols.map((c) => Math.max(6, Math.round(colW(c) / 7))), freeze: { row: 1, col: 1 } });
    download('harmonogram.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  }

  // ---- zdarzenia tabeli ----
  wrap.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-col]');
    if (th && !e.target.classList.contains('rz')) { const c = COLS.find((x) => x.key === th.dataset.col); if (c) filterPop(th, c); return; }
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id, td = e.target.closest('td[data-col]');
    if (td && td.dataset.col === 'lp' && F.levels) { const r = lastRows[Number(tr.dataset.i)]; if (r && (r.subCount || r.komisRow) && e.offsetX < 28 + 14 * (r.depth || 0)) { if (S.collapsed.has(id)) S.collapsed.delete(id); else S.collapsed.add(id); render(); return; } }
    S.selected = id; S.cursor = td ? { id, key: td.dataset.col } : S.cursor;
    for (const x of wrap.querySelectorAll('tr.sel')) x.classList.remove('sel'); tr.classList.add('sel');
    for (const x of wrap.querySelectorAll('td.cur')) x.classList.remove('cur'); if (td) td.classList.add('cur');
    if (F.details && (e.target.closest('[data-bar]') || !S.sim)) showDetails(id);
  });
  wrap.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td[data-col]'), tr = e.target.closest('tr[data-id]'); if (!td || !tr) return;
    const r = lastRows[Number(tr.dataset.i)], c = COLS.find((x) => x.key === td.dataset.col);
    if (r && c) editCell(td, r, c);
  });
  wrap.addEventListener('wheel', (e) => { if (e.ctrlKey && F.zoom) { e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
  // szerokość kolumn: przeciąganie prawej krawędzi nagłówka
  wrap.addEventListener('mousedown', (e) => {
    if (!e.target.classList.contains('rz')) return;
    e.preventDefault(); e.stopPropagation();
    const key = e.target.parentNode.dataset.col, c = COLS.find((x) => x.key === key), x0 = e.clientX, w0 = colW(c);
    const mv = (ev) => { S.colW[key] = Math.max(24, Math.round(w0 + (ev.clientX - x0) / S.zoom)); const col = wrap.querySelectorAll('col')[shownCols().indexOf(c)]; if (col) col.style.width = S.colW[key] + 'px'; };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); remember(); render(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
  function moveCursor(dr, dc) {
    const cols = shownCols(); if (!lastRows.length) return;
    let i = S.cursor ? lastRows.findIndex((r) => r.id === S.cursor.id) : 0, j = S.cursor ? cols.findIndex((c) => c.key === S.cursor.key) : 0;
    i = Math.max(0, Math.min(lastRows.length - 1, (i < 0 ? 0 : i) + dr)); j = Math.max(0, Math.min(cols.length - 1, (j < 0 ? 0 : j) + dc));
    S.cursor = { id: lastRows[i].id, key: cols[j].key }; S.selected = lastRows[i].id; render();
    const td = wrap.querySelector('td.cur'); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePop(); if (side) { side.remove(); side = null; } return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && F.search) { e.preventDefault(); search.focus(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=') && F.zoom) { e.preventDefault(); setZoom(S.zoom * 1.15); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '-' && F.zoom) { e.preventDefault(); setZoom(S.zoom / 1.15); return; }
    if (!F.keys || pop || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)) return;
    const nav = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (nav) { e.preventDefault(); moveCursor(...nav); return; }
    if ((e.key === 'Enter' || e.key === 'F2') && S.cursor) {
      e.preventDefault();
      const td = wrap.querySelector('td.cur'), r = lastRows.find((x) => x.id === S.cursor.id), c = COLS.find((x) => x.key === S.cursor.key);
      if (S.sim && td && r && c) editCell(td, r, c); else if (F.details) showDetails(S.cursor.id);
    }
  });

  // ---- nagłówek i start ----
  const b = D.brand;
  const header = document.createElement('div');
  if (b) header.innerHTML = `<div class="brand"><div class="bl">${b.logo ? `<img src="${esc(b.logo)}" alt="">` : ''}<div><div class="co">${esc(b.company)}</div><div class="de">${esc(b.dept)}</div><div class="sh">${esc(b.sharer)}</div></div></div><div class="br"><div class="pr">${esc(b.program)}</div><div class="ow">${esc(b.owner)}</div><div class="dt">${esc(b.date)}</div></div></div>`;
  if (D.title) header.innerHTML += `<h1>${esc(D.title)}</h1>`;
  app.append(header, bar, simbar, wrap, tot);
  render();
}

if (typeof document !== 'undefined' && document.getElementById('zks-data')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}
