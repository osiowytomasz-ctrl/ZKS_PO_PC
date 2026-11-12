// Harmonogram (baza Firebase): widok klasyczny jak w arkuszu. Jedna tabela: z lewej dane (kolumny jak w pliku), z prawej oś czasu z paskami w tych samych wierszach.
// Dane twarde edytujesz w komórkach; Start, Koniec i klucz liczy program. Przycisk „Ukryj dane” chowa kolumny z listy ukrywanych (domyślnie „czerwone”).
import { h, clear, api, apiCached, modal, toast, columnFilterDialog, confirmBox } from '../ui.js';
import { datePickerDialog, calendarButton } from './datePicker.js';
import * as H from '../logic/harm.js';
import { visibleRows, filterOptions, sortRows, rangeFilter, isRangeFilter } from '../logic/tableFilter.js';
import { buildHarmData, parseGrafik, daysByKeyOf, stationList, DEFAULT_STATIONS, fmtDt, arrangeRows, subParent, subOps, reorderIds, reorderPlan, withKomisRows, isKomisId, KOMIS_PREFIX } from '../logic/harmModel.js';
import { watchHarm, saveSettings, setOpsSource, undoLast, onUndoChange, restoreBackup } from '../harmStore.js';
import { backupData, backupText, parseBackup, backupDiff, backupFileName } from '../logic/harmBackup.js';
import { COLS, saveCell, removeOp, addDialog, predPicker } from './harmEdit.js';
import { treeEditor } from './harmTreeEditor.js';
import { iconSvg } from './harmIcons.js';
import { parseSheetColor } from '../logic/common.js';
import { INTERVALS, DEFAULT_INTERVAL, intervalOf, axisStartMs, buildCells, holidayMap, sampleLabel, MAX_SHIFT_DAYS } from '../logic/harmAxis.js';
import { parseDateTime } from '../logic/harmImport.js';
import { dayOf, daySlots, grafikPeople, matchOperators, shiftWindows, operatorSegments, uncoveredSegments, dayTasks } from '../logic/harmDay.js';
import { shareDialog } from './harmShare.js';
import { firebase, harmLevel, onHarmLevel } from '../fb.js';
import { harmAccess, legacyLevel } from '../logic/harmAccess.js';
import { findIssues, issuesByOp, conflictPath } from '../logic/harmIssues.js';

const BASE = { hour: 0.75, row: 26, font: 12 };
const DEFAULT_LAYOUT = { rowH: 26, dateW: 104 };   // dateW dopasowana do „dd.mm.rrrr hh”
const DEFAULT_KEEP = new Set(['lp', 'start', 'koniec', 'station']);   // kolumny, które zostają po „Ukryj dane”
const LS = { chart: 'zks.harm.chartOpt', confirm: 'zks.harm.confirmChanges', filters: 'zks.harm.filters', komis: 'zks.harm.komisSummary', hide: 'zks.harm.hideSet', mode: 'zks.harm.hideMode', layout: 'zks.harm.layout', interval: 'zks.harm.interval' };
const CELL_W = 18;            // szerokość kolumny osi przy skali 100% (px) dla pełnego interwału
const HOLIDAY_BG = '#800000';  // święta: bordowe tło, biała pogrubiona czcionka
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* brak pamięci przeglądarki */ } };
const ZAK_BAR = '#93c47d';

// Filtry i sortowanie kolumn zapamiętane na tym komputerze (wartości filtra jako listy; tylko znane kolumny)
function loadFilters() {
  const saved = lsGet(LS.filters, {}) || {};
  const keys = new Set(COLS.map((c) => c.key));
  const filters = {};
  for (const [k, v] of Object.entries(saved.filters || {})) {
    if (!keys.has(k)) continue;
    if (Array.isArray(v)) filters[k] = new Set(v.map(String));
    else if (v && v.range) filters[k] = rangeFilter(v.from, v.to);   // zakres dat
  }
  const sorts = (Array.isArray(saved.sorts) ? saved.sorts : []).filter((x) => x && keys.has(x.key)).map((x) => ({ key: x.key, ascending: x.ascending !== false }));
  return { filters, sorts };
}

export function mountHarmLive(el, appCtx) {
  const st = {
    m: null, days: null, data: null, ...loadFilters(), shift: -3, interval: intervalOf(lsGet(LS.interval, DEFAULT_INTERVAL)).id, scale: 1, editing: false, pending: false,
    hideSet: new Set(lsGet(LS.hide, COLS.filter((c) => !DEFAULT_KEEP.has(c.key)).map((c) => c.key))), compact: !!lsGet(LS.mode, false),
    // podsumowanie komisów: show – paski widoczne, inline – przy pierwszym wystąpieniu komisu (zamiast na górze), filter – filtry i sortowanie także dla pasków
    komisOpt: { show: true, inline: false, filter: false, ...lsGet(LS.komis, {}) },
    confirmChanges: lsGet(LS.confirm, true) !== false,
    // wykres: pola napisu na pasku (w tej kolejności), wielkość czcionki napisów [px przy 100%; 0 = jak w tabeli], kolor komisu na pasku
    chartOpt: { fields: ['komis', 'element', 'hours'], font: 0, komisColor: false, ...lsGet(LS.chart, {}) },   // okno potwierdzenia przed zapisem zmiany komórki
    issues: [], issueMap: new Map(), cursor: null, path: null,   // path – pokazywana ścieżka konfliktu (linie na wykresie)
      // konflikty i błędy (liczone na bieżąco), aktywna komórka (nawigacja jak w Excelu)
    collapsed: new Set(), hiddenLevels: new Set(), selected: null, rows: [], chart: null, geom: null, layout: { ...DEFAULT_LAYOUT, ...lsGet(LS.layout, {}) },
  };
  const saveFilters = () => lsSet(LS.filters, { filters: Object.fromEntries(Object.entries(st.filters).map(([k, v]) => [k, isRangeFilter(v) ? { range: true, from: v.from, to: v.to } : [...v]])), sorts: st.sorts });
  let syncTools = () => {};
  // poziom dostępu (GOD / MASTER / CLERIK / TOURIST / ---) z tokenu Firebase; bez niego (stary serwer) – jak dotychczas wg uprawnień Planu/Grafiku
  const acc = () => harmAccess(harmLevel() ?? legacyLevel(appCtx && appCtx.user && appCtx.user.permissions));
  const offLevel = onHarmLevel(() => { if (!el.isConnected) { offLevel(); return; } syncTools(); recompute(); });
  setOpsSource(() => (st.m ? st.m.opsByLp : {}));   // stan sprzed zmiany – do cofania
  // Zmiana komórki: informacja o zmianie i potwierdzenie (można wyłączyć w Ustawieniach), potem zapis; po zapisie można cofnąć (↶, Ctrl+Z)
  const saveWithConfirm = async (id, col, oldText, newText) => {
    if (String(oldText ?? '').trim() === String(newText ?? '').trim()) return false;
    if (!acc().edit) { toast(`Poziom ${acc().label}: edycja jest zablokowana`); return false; }
    const lp = id;
    if (st.confirmChanges && !(await confirmBox('Potwierdź zmianę', `Operacja ${lp}\n${col.title}:  „${String(oldText || '').trim() || '—'}”  →  „${String(newText || '').trim() || '—'}”\n\nZapisać zmianę?`, 'Zapisz'))) return false;
    const ok = await saveCell(st.m.opsByLp, id, col, String(newText ?? '').trim());
    if (ok) toast(`Zapisano: ${col.title} operacji ${lp}. Cofnij: ↶ albo Ctrl+Z`);
    return ok;
  };
  const doUndo = async () => {
    if (!acc().edit) return;
    try { const label = await undoLast(); toast(label ? `Cofnięto: ${label}` : 'Nie ma zmian do cofnięcia'); }
    catch (e) { toast('Nie cofnięto: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
  };   // stan ikon paska (ustawiany niżej)
  const body = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0, minWidth: 0, position: 'relative', overflow: 'auto' } });
  const noMin = (t) => String(t ?? '').replace(/^(\d{2}\.\d{2}\.\d{4} \d{2}):\d{2}$/, '$1');   // wyświetlanie „dd.mm.rrrr hh” (bez minut)
  const val = (row, col) => (col.isDate ? noMin(row[col.key]) : col.key === 'hours' ? String(row.hoursShown ?? '') : String(row[col.key] ?? ''));
  let measureCtx = null;
  const textW = (text, font, bold) => { try { measureCtx = measureCtx || document.createElement('canvas').getContext('2d'); measureCtx.font = `${bold ? 'bold ' : ''}${font}px ${getComputedStyle(document.body).fontFamily}`; return measureCtx.measureText(text).width; } catch { return text.length * font * 0.6; } };
  // paski podsumowania komisów do pokazania: bez filtrów i sortowania, chyba że w ustawieniach zaznaczono „filtrowanie i sortowanie”
  const komisSummaryList = () => {
    if (!st.komisOpt.show || !st.data || !st.data.komisRows) return [];
    let list = [...st.data.komisRows.values()];
    if (st.komisOpt.filter) { list = visibleRows(list, COLS, st.filters, val); if (st.sorts.length) list = sortRows(list, COLS, st.sorts, val); }
    return list;
  };
  // napis na pasku wykresu z pól wybranych w Ustawieniach (kolejność jak na liście)
  const CHART_FIELDS = [['lp', 'lp.'], ['komis', 'Komis'], ['client', 'Klient'], ['element', 'Opis'], ['hours', 'Czas [h]'], ['station', 'Stanowisko'], ['start', 'Start'], ['koniec', 'Koniec'], ['wysylka', 'Wysyłka']];
  const chartLabel = (r) => st.chartOpt.fields.map((k) => (k === 'hours' ? r.godziny : k === 'station' ? r.stanowisko : ['start', 'koniec', 'wysylka'].includes(k) ? noMin(r[k]) : r[k]))
    .map((v) => String(v ?? '').trim()).filter(Boolean).join(' - ');
  // tło paska: kolor maszyny; z opcją „kolor komisu” – 10 px koloru maszyny z lewej, reszta w kolorze komisu z Ustawień
  const barBackground = (r, stationColor) => {
    const kc = st.chartOpt.komisColor ? komisColor(r.komis) : null;
    return kc ? `linear-gradient(to right, ${stationColor} 0 10px, ${parseSheetColor(kc.bg, stationColor)} 10px)` : stationColor;
  };
  const shownCols = () => COLS.filter((c) => !(st.compact && st.hideSet.has(c.key)));

  // ---------- dane: baza + grafik z arkusza ----------
  let stop = null, grJson = '', grTimer = null;
  const recompute = () => {
    if (!st.m) return;
    if (!acc().view) { st.data = null; clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Brak dostępu do Harmonogramu (poziom ---). Poziom ustawia administrator w zakładce Uzytkownicy, kolumna „Harmonogram”.')); return; }
    st.data = buildHarmData(st.m.opsByLp, st.days || {}, st.m.cfg, H.localNow().getTime());
    scheduleIssues();
    if (st.editing) { st.pending = true; return; }
    draw();
  };
  const applyGrafik = (g, quiet) => {
    const j = JSON.stringify(g);
    if (j === grJson) return;
    grJson = j; st.days = daysByKeyOf(parseGrafik(g)); recompute();
    if (!quiet) toast('Grafik zaktualizowany');
  };
  async function loadGrafik() {
    try { await apiCached('getGrafNorm', [], (g) => applyGrafik(g, true), { timeoutMs: 180000, maxAge: 0, force: true, callArgs: ['fresh'] }); } catch (e) { toast('Grafik: ' + e.message); }
    if (grTimer) clearInterval(grTimer);
    grTimer = setInterval(async () => {
      if (!el.isConnected) { clearInterval(grTimer); if (stop) stop(); return; }
      if (document.hidden) return;
      try { applyGrafik(await api('getGrafNorm', ['fresh'], { timeoutMs: 60000 }), false); } catch { /* następna próba za 20 s */ }
    }, 20000);
  }
  async function load() {
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Łączenie z bazą…'));
    try {
      if (stop) stop();
      // przed wejściem: nowy token z aktualnym poziomem z karty Uzytkownicy (kolumna „Harmonogram”)
      await firebase({ fresh: true });
      if (harmLevel() == null) toast('Serwer nie podaje poziomu dostępu (wdróż nowy Firebase.gs) – tylko przeglądanie');
      syncTools();
      loadGrafik();
      stop = await watchHarm((m) => { st.m = m; recompute(); },
        (e) => { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy: ' + (e.code || '') + ' ' + (e.message || e))); });
    } catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: load }, 'Ponów'))); }
  }
  // ---------- konflikty i błędy (na bieżąco, po każdej zmianie w bazie) ----------
  let issuesTimer = null;
  function scheduleIssues() {
    clearTimeout(issuesTimer);
    issuesTimer = setTimeout(() => {
      if (!st.m || !st.data) return;
      const res = st.data.result || new Map(), ends = new Map(), noStart = new Set();
      for (const [id, v] of res) if (v && v.end != null) ends.set(id, v.end);
      for (const r of st.data.rows) if (r.state === 'no-start') noStart.add(r.id);
      st.issues = findIssues(st.m.opsByLp, { ends, noStart, stations: new Set(stationList(st.m.cfg).map((x) => x.name)) });
      st.issueMap = issuesByOp(st.issues);
      syncIssues();
      // pokazywana ścieżka po zmianie danych: przeliczona albo – gdy pętla zniknęła – schowana
      if (st.path) {
        const still = st.issues.some((x) => x.lp === st.path.lp && x.pred === st.path.pred);
        const p = st.path; st.path = null;
        if (still || (!p.loop && (st.m.opsByLp[p.lp]?.preds || []).includes(p.pred))) showPath(p.lp, p.pred);
        else { renderPathBar(); if (p.loop) toast(`Pętla przez ${p.lp} ← ${p.pred} rozwiązana`); }
      }
      if (!st.editing) paintWindow();
    }, 250);
  }
  const issuesBtn = h('button', { class: 'btn small', style: { height: '30px', padding: '0 8px', fontWeight: 700 }, onclick: () => issuesDialog() });
  function syncIssues() {
    const err = st.issues.filter((x) => x.level === 'error').length, warn = st.issues.length - err;
    issuesBtn.textContent = err || warn ? `⚠ ${err}${warn ? ' / ' + warn : ''}` : '✓';
    issuesBtn.style.background = err ? '#c00000' : warn ? '#ffd966' : '#d9ead3';
    issuesBtn.style.color = err ? '#fff' : '#000'; issuesBtn.style.borderColor = err ? '#c00000' : '';
    issuesBtn.title = err || warn ? `Konflikty i błędy: ${err} błędów, ${warn} uwag. Kliknij: lista` : 'Brak konfliktów i błędów';
  }
  // przejście do komórki z problemem: rozwija i pokazuje operację, ustawia kursor
  function goTo(lp, colKey) {
    let i = st.rows.findIndex((r) => r.id === lp);
    if (i < 0) {
      let p = subParent(lp), changed = false;
      while (p) { if (st.collapsed.delete(p)) changed = true; p = subParent(p); }
      if (changed) draw();
      i = st.rows.findIndex((r) => r.id === lp);
    }
    if (i < 0) { toast(`Operacja ${lp} jest ukryta (filtr albo poziom) – wyczyść filtry, aby ją zobaczyć`); return; }
    const cols = st.geom.cols, key = cols.some((c) => c.key === colKey) ? colKey : 'lp';
    setCursor(lp, key);
  }
  function issuesDialog() {
    let level = 'all';
    const list = h('div', { style: { maxHeight: '60vh', overflow: 'auto', fontSize: '13px' } });
    const render = () => {
      clear(list);
      const items = st.issues.filter((x) => level === 'all' || x.level === level);
      if (!items.length) list.append(h('div', { class: 'muted', style: { padding: '8px' } }, 'Brak konfliktów i błędów.'));
      for (const x of items) list.append(h('div', { title: 'Kliknij, aby przejść do komórki' + (x.pred ? ' i pokazać ścieżkę konfliktu' : ''), onclick: () => { m.close(); goTo(x.lp, x.col); if (x.pred) showPath(x.lp, x.pred); else clearPath(); },
        style: { padding: '3px 6px', cursor: 'pointer', borderBottom: '1px solid #eee', color: x.level === 'error' ? '#c00000' : '#7a5a00', fontWeight: x.fix ? 700 : 400, background: x.fix ? '#fff2cc' : '' } },
        (x.level === 'error' ? '⛔ ' : '⚠ ') + x.text));
    };
    const tab = (v, t) => h('button', { class: 'btn small' + (level === v ? ' primary' : ''), onclick: (e) => { level = v; [...e.target.parentNode.children].forEach((b) => b.classList.remove('primary')); e.target.classList.add('primary'); render(); } }, t);
    const err = st.issues.filter((x) => x.level === 'error').length;
    const m = modal('Konflikty i błędy harmonogramu', h('div', {},
      h('p', { class: 'muted', style: { margin: '0 0 6px' } }, 'Sprawdzane na bieżąco po każdej zmianie. Błędy: pętle zależności, brakujący poprzednicy, suboperacja bez operacji nadrzędnej, koniec ręczny przed startem. Uwagi: brak startu, brak czasu, nieznane stanowisko, koniec po wysyłce. Pogrubione na żółto – powiązanie, którego usunięcie rozwiązuje wszystkie pętle. Kliknij pozycję, aby przejść do komórki.'),
      h('div', { class: 'row', style: { gap: '4px', marginBottom: '6px' } }, tab('all', `Wszystkie (${st.issues.length})`), tab('error', `Błędy (${err})`), tab('warn', `Uwagi (${st.issues.length - err})`)),
      list, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
    render();
  }

  // ---------- ścieżka konfliktu: linie na wykresie od operacji, na którą się czeka, do operacji czekającej ----------
  // Klik w konflikt na liście albo w operację z konfliktem pokazuje łańcuch pętli; pasek nad tabelą wypisuje ogniwa (klik – przejście).
  const pathBar = h('div', { class: 'row panel', style: { display: 'none', flexWrap: 'wrap', gap: '4px', alignItems: 'center', fontSize: '13px', background: '#fff0f0', borderColor: '#e00000' } });
  function showPath(lp, pred) {
    if (!st.m) return;
    let steps = conflictPath(st.m.opsByLp, lp, pred), loop = steps.length > 0;
    if (!loop && st.m.opsByLp[pred]) steps = [{ waiter: lp, on: pred, kind: 'pred', why: `${lp} czeka na koniec ${pred} (poprzednik)`, from: 's', to: 'e', closing: true }];
    if (!steps.length) { clearPath(); return; }
    st.path = { lp, pred, loop, steps, ops: new Set(steps.flatMap((x) => [x.waiter, x.on])) };
    renderPathBar(); paintWindow();
  }
  function clearPath() { if (!st.path) return; st.path = null; renderPathBar(); paintWindow(); }
  // operacja kliknięta w tabeli albo na wykresie: jej pierwsza pętla (jeśli ma); klik poza ścieżką chowa ścieżkę
  function autoPath(id) {
    const own = st.issues.find((x) => x.lp === id && x.kind === 'cycle');
    if (own) { if (!(st.path && st.path.ops.has(id))) showPath(own.lp, own.pred); return; }
    if (st.path && !st.path.ops.has(id)) clearPath();
  }
  function renderPathBar() {
    clear(pathBar);
    if (!st.path) { pathBar.style.display = 'none'; return; }
    pathBar.style.display = 'flex';
    const p = st.path, hiddenN = [...p.ops].filter((id) => !st.rows.some((r) => r.id === id)).length;
    const chip = (id, i) => h('button', { class: 'btn small', title: 'Przejdź do operacji', style: { padding: '0 6px', fontWeight: 700, borderColor: i === 0 ? '#c000c0' : '#e00000' }, onclick: () => goTo(id, 'lp') }, id);
    pathBar.append(h('b', { style: { color: '#c00000' } }, p.loop ? `Pętla zależności (${p.steps.length} ogniw):` : 'Powiązanie:'));
    const order = [p.steps[0].waiter, ...p.steps.map((x) => x.on)];
    order.forEach((id, i) => { if (i) pathBar.append(h('span', { title: p.steps[i - 1].why }, '→')); pathBar.append(chip(id, i)); });
    if (hiddenN) pathBar.append(h('span', { class: 'muted' }, `(${hiddenN} poza widokiem – filtr, poziom albo zwinięte)`));
    pathBar.append(h('span', { class: 'muted', title: p.steps.map((x) => x.why).join('\n') }, 'ⓘ'), h('span', { class: 'grow' }),
      h('button', { class: 'btn small', title: 'Ukryj ścieżkę (Esc)', onclick: clearPath }, '✕'));
  }
  // linie ścieżki na wykresie (w warstwie z paskami); brak terminu operacji (np. w pętli) – linia przy lewej krawędzi widoku wykresu
  function drawPath(g, chart) {
    if (!st.path || !st.data) return;
    const idx = new Map(st.rows.map((r, i) => [r.id, i])), res = st.data.result || new Map();
    const x0 = chart.axisStart.getTime(), X = (ms) => Math.max(0, (ms - x0) / 3600000) * g.HOUR;
    const gutter = Math.max(14, body.scrollLeft - (st.compact ? 0 : g.LEFT) + 24);
    const pos = (id, which) => { const v = res.get(id); const ms = v ? (which === 's' ? v.start : v.end) : null; return ms == null ? gutter : X(ms); };
    const H2 = g.ROW / 2, parts = [];
    for (const id of st.path.ops) { const i = idx.get(id); if (i != null) g.dyn.append(h('div', { style: { position: 'absolute', zIndex: 0, pointerEvents: 'none', left: 0, top: i * g.ROW + 'px', width: g.chartW + 'px', height: g.ROW + 'px', background: 'rgba(224,0,0,.10)' } })); }
    st.path.steps.forEach((s, k) => {
      const ia = idx.get(s.waiter), ib = idx.get(s.on); if (ia == null || ib == null) return;
      const xa = pos(s.waiter, s.from), ya = ia * g.ROW + H2, xb = pos(s.on, s.to), yb = ib * g.ROW + H2;
      const c = s.closing && st.path.loop ? '#c000c0' : '#e00000', bend = Math.max(30, Math.abs(ya - yb) / 4);
      parts.push(`<path d="M${xb},${yb} C${xb + bend},${yb} ${xa - bend},${ya} ${xa},${ya}" fill="none" stroke="${c}" stroke-width="2.5"${s.closing ? ' stroke-dasharray="7 4"' : ''} marker-end="url(#harmArrow${s.closing ? 'C' : ''})"><title>${s.why.replace(/</g, '&lt;')}</title></path>`);
      parts.push(`<circle cx="${xb}" cy="${yb}" r="4" fill="${c}"/>`);
      parts.push(`<text x="${xa + 4}" y="${ya - 4}" font-size="11" font-weight="700" fill="${c}">${k + 1}</text>`);
    });
    const svg = h('div', { style: { position: 'absolute', zIndex: 4, pointerEvents: 'none', left: 0, top: 0, width: g.chartW + 'px', height: st.rows.length * g.ROW + 'px' } });
    svg.innerHTML = `<svg width="${g.chartW}" height="${st.rows.length * g.ROW}" style="overflow:visible"><defs>`
      + '<marker id="harmArrow" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#e00000"/></marker>'
      + '<marker id="harmArrowC" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#c000c0"/></marker></defs>'
      + parts.join('') + '</svg>';
    svg.querySelectorAll('path[stroke]').forEach((p) => { p.style.pointerEvents = 'stroke'; });
    g.dyn.append(svg);
    // łuki przy kolumnie lp. w tabeli – widać je także wtedy, gdy wykres jest poza ekranem
    const lpCol = g.cols.find((c) => c.key === 'lp');
    if (lpCol) {
      const lx = g.colW(lpCol) - 6, arcs = [];
      st.path.steps.forEach((s, k) => {
        const ia = idx.get(s.waiter), ib = idx.get(s.on); if (ia == null || ib == null) return;
        const ya = ia * g.ROW + H2, yb = ib * g.ROW + H2, w = 16 + (k % 5) * 7, c = s.closing && st.path.loop ? '#c000c0' : '#e00000';
        arcs.push(`<path d="M${lx},${yb} C${lx + w},${yb} ${lx + w},${ya} ${lx},${ya}" fill="none" stroke="${c}" stroke-width="2"${s.closing ? ' stroke-dasharray="6 3"' : ''} marker-end="url(#harmArrowL${s.closing && st.path.loop ? 'C' : ''})" opacity=".9"/>`);
      });
      const ov = h('div', { style: { position: 'absolute', zIndex: 4, pointerEvents: 'none', left: 0, top: 0, width: g.LEFT + 'px', height: st.rows.length * g.ROW + 'px' } });
      ov.innerHTML = `<svg width="${g.LEFT}" height="${st.rows.length * g.ROW}" style="overflow:visible"><defs>`
        + '<marker id="harmArrowL" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#e00000"/></marker>'
        + '<marker id="harmArrowLC" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#c000c0"/></marker></defs>' + arcs.join('') + '</svg>';
      g.leftRows.append(ov);
    }
  }

  // ---------- nawigacja po tabeli jak w Excelu ----------
  // Klik zaznacza komórkę; strzałki, Enter (w dół), Tab (w prawo), Shift+Enter/Shift+Tab (wstecz), Home/End, PageUp/PageDown, Ctrl+Home/End.
  // Pisanie albo F2 zaczyna edycję w komórce (daty i poprzedników też z klawiatury), dwuklik / Alt+↓ – kalendarz albo lista poprzedników,
  // Delete – czyści komórkę, Ctrl+C / Ctrl+V – kopiuje / wkleja wartość komórki.
  const cellValueForEdit = (r, col) => {
    const op = (st.m && st.m.opsByLp[r.id]) || {};
    if (col.key === 'lp') return r.lp;
    if (col.date) return fmtDt(op[col.key]);
    if (col.key === 'hours') return op.hours == null ? '' : String(op.hours).replace('.', ',');
    if (col.pred !== undefined) return (op.preds || [])[col.pred] || '';
    return String(op[col.key] ?? '');
  };
  function setCursor(id, key, { scroll = true } = {}) {
    st.cursor = { id, key };
    st.selected = id; autoPath(id);
    if (scroll) ensureVisible();
    paintWindow();
  }
  function ensureVisible() {
    const g = st.geom; if (!g || !st.cursor) return;
    const i = st.rows.findIndex((r) => r.id === st.cursor.id); if (i < 0) return;
    const { ROW, HEAD, cols, colW } = g;
    const top = i * ROW, vh = body.clientHeight - HEAD;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + ROW > body.scrollTop + vh) body.scrollTop = top + ROW - vh;
    let x = 0; for (const c of cols) { if (c.key === st.cursor.key) break; x += colW(c); }
    const w = colW(cols.find((c) => c.key === st.cursor.key) || cols[0]);
    if (!st.compact) { if (x < body.scrollLeft) body.scrollLeft = x; else if (x + w > body.scrollLeft + body.clientWidth) body.scrollLeft = x + w - body.clientWidth; }
  }
  function moveCursor(dr, dc, { abs } = {}) {
    const g = st.geom; if (!g || !st.rows.length) return;
    const cols = g.cols;
    let i = st.cursor ? st.rows.findIndex((r) => r.id === st.cursor.id) : 0, j = st.cursor ? cols.findIndex((c) => c.key === st.cursor.key) : 0;
    if (i < 0) i = 0; if (j < 0) j = 0;
    if (abs) { if (abs.row != null) i = abs.row < 0 ? st.rows.length - 1 : abs.row; if (abs.col != null) j = abs.col < 0 ? cols.length - 1 : abs.col; }
    i = Math.max(0, Math.min(st.rows.length - 1, i + dr)); j = Math.max(0, Math.min(cols.length - 1, j + dc));
    setCursor(st.rows[i].id, cols[j].key);
  }
  const cursorRow = () => (st.cursor ? st.rows.find((r) => r.id === st.cursor.id) : null);
  const cursorCol = () => (st.cursor && st.geom ? st.geom.cols.find((c) => c.key === st.cursor.key) : null);
  const editableCell = (r, col, quiet) => {
    if (!r || !col) return false;
    if (r.komisRow || col.ro) { if (!quiet) toast('Ta komórka jest liczona przez program'); return false; }
    if (!acc().edit) { if (!quiet) toast(`Poziom ${acc().label}: edycja jest zablokowana`); return false; }
    return true;
  };
  const cellEl = () => (st.geom && st.geom.leftRows ? st.geom.leftRows.querySelector(`[data-cid="${CSS.escape(st.cursor.id)}"][data-ckey="${st.cursor.key}"]`) : null);
  function beginEdit(initial, typed) {
    const r = cursorRow(), col = cursorCol();
    if (!editableCell(r, col)) return;
    ensureVisible(); paintWindow();
    const el = cellEl(); if (!el) return;
    startEdit(el, r.id, col, typed ? initial : cellValueForEdit(r, col), { typed: !!typed, old: cellValueForEdit(r, col) });
  }
  function openPicker() {
    const r = cursorRow(), col = cursorCol();
    if (!editableCell(r, col)) return;
    const op = st.m.opsByLp[r.id] || {};
    if (col.pred !== undefined) { predPicker(st.m.opsByLp, r.id, col.pred, (lp) => saveWithConfirm(r.id, col, cellValueForEdit(r, col), lp)); return; }
    if (col.date) { datePickerDialog({ title: `${col.title} · operacja ${r.lp || r.id}`, value: op[col.key] ?? null, holidays: holidayMap(st.m.cfg && st.m.cfg.holidays), onPick: (ms) => saveWithConfirm(r.id, col, fmtDt(op[col.key]), ms == null ? '' : fmtDt(ms)) }); return; }
    beginEdit();
  }
  async function pasteCell() {
    const r = cursorRow(), col = cursorCol();
    if (!editableCell(r, col)) return;
    let t = '';
    try { t = await navigator.clipboard.readText(); } catch { toast('Brak dostępu do schowka'); return; }
    t = String(t || '').split(/\r?\n/)[0].split('\t')[0].trim();
    if (!t) return;
    await saveWithConfirm(r.id, col, cellValueForEdit(r, col), t);
  }
  async function copyCell() {
    const r = cursorRow(), col = cursorCol(); if (!r || !col) return;
    const t = r.komisRow ? val(r, col) : col.ro ? val(r, col) : cellValueForEdit(r, col);
    try { await navigator.clipboard.writeText(t); toast('Skopiowano: ' + (t || '(puste)')); } catch { toast('Brak dostępu do schowka'); }
  }
  const onNavKey = (e) => {
    if (!el.isConnected) { document.removeEventListener('keydown', onNavKey); return; }
    if (e.key === 'Escape' && st.path && !document.querySelector('.overlay') && !st.editing) { clearPath(); }
    if (!st.cursor || st.editing || document.querySelector('.overlay')) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    const nav = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (k === 'ArrowDown' && e.altKey) { e.preventDefault(); openPicker(); return; }
    if (nav[k] && !ctrl) { e.preventDefault(); moveCursor(...nav[k]); return; }
    if (nav[k] && ctrl) { e.preventDefault(); const [dr, dc] = nav[k]; moveCursor(0, 0, { abs: { row: dr ? (dr < 0 ? 0 : -1) : null, col: dc ? (dc < 0 ? 0 : -1) : null } }); return; }
    if (k === 'Enter') { e.preventDefault(); moveCursor(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'Tab') { e.preventDefault(); moveCursor(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Home') { e.preventDefault(); moveCursor(0, 0, { abs: ctrl ? { row: 0, col: 0 } : { col: 0 } }); return; }
    if (k === 'End') { e.preventDefault(); moveCursor(0, 0, { abs: ctrl ? { row: -1, col: -1 } : { col: -1 } }); return; }
    if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); const n = Math.max(1, Math.floor((body.clientHeight - (st.geom ? st.geom.HEAD : 0)) / (st.geom ? st.geom.ROW : 20)) - 1); moveCursor(k === 'PageDown' ? n : -n, 0); return; }
    if (k === 'F2') { e.preventDefault(); beginEdit(); return; }
    if (k === 'Escape') { st.cursor = null; paintWindow(); return; }
    if (ctrl && k.toLowerCase() === 'c') { e.preventDefault(); copyCell(); return; }
    if (ctrl && k.toLowerCase() === 'v') { e.preventDefault(); pasteCell(); return; }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      const r = cursorRow(), col = cursorCol();
      if (col && col.key === 'lp') { toast('Numer operacji nie może być pusty'); return; }
      if (editableCell(r, col)) saveWithConfirm(r.id, col, cellValueForEdit(r, col), '');
      return;
    }
    if (k.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); beginEdit(k, true); }
  };
  document.addEventListener('keydown', onNavKey);

  // ---------- filtry / kolumny ----------
  const sortLabel = (key) => { const i = st.sorts.findIndex((s) => s.key === key); return i < 0 ? '' : (st.sorts[i].ascending ? '↑' : '↓') + (st.sorts.length > 1 ? i + 1 : ''); };
  function openFilter(c) {
    const cur = st.sorts.find((s) => s.key === c.key);
    // ukryte kolumny („Ukryj dane”): na górze okna wybór kolumny do filtrowania – także schowanej (jak filtr w tabeli przestawnej Excela)
    const hidden = st.compact ? COLS.filter((x) => st.hideSet.has(x.key)) : [];
    let dlg = null;
    const picker = hidden.length ? h('div', { style: { border: '1px solid #ccc', background: '#f6f8fc', padding: '6px', marginBottom: '6px' } },
      h('div', { style: { fontWeight: 700, fontSize: '12px', marginBottom: '4px' } }, 'Kolumna do filtrowania (także ukryte):'),
      (() => {
        const opt = (x) => h('option', { value: x.key }, `${x.title}${st.filters[x.key] ? ' ▼' : ''}${st.sorts.some((s) => s.key === x.key) ? ' ' + sortLabel(x.key) : ''}`);
        const sel = h('select', { style: { width: '100%', padding: '4px' }, onchange: () => { const n = COLS.find((x) => x.key === sel.value); if (n && n.key !== c.key) { if (dlg) dlg.close(); openFilter(n); } } },
          h('optgroup', { label: 'Widoczne' }, ...COLS.filter((x) => !st.hideSet.has(x.key)).map(opt)),
          h('optgroup', { label: 'Ukryte' }, ...hidden.map(opt)));
        sel.value = c.key; return sel;
      })(),
      hidden.some((x) => st.filters[x.key]) ? h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } }, 'Filtry na ukrytych kolumnach: ' + hidden.filter((x) => st.filters[x.key]).map((x) => x.title).join(', ')) : null) : null;
    dlg = columnFilterDialog({
      top: picker,
      title: c.title + (hidden.some((x) => x.key === c.key) ? ' (kolumna ukryta)' : ''), options: filterOptions(st.komisOpt.show && st.komisOpt.filter ? [...st.data.rows, ...st.data.komisRows.values()] : st.data.rows, COLS, st.filters, val, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null, dateRange: !!c.isDate,
      onApply: (filter, sort) => {
        if (filter) st.filters[c.key] = filter; else delete st.filters[c.key];
        st.sorts = st.sorts.filter((s) => s.key !== c.key); if (sort !== null) st.sorts.unshift({ key: c.key, ascending: sort });
        saveFilters();
        draw();
      },
    });
  }
  function hideDialog() {
    const boxes = new Map();
    const list = h('div', {}, ...COLS.filter((c) => c.group !== 'z' || c.key === 'z1').map((c) => {
      const keys = c.group === 'z' ? COLS.filter((x) => x.group === 'z').map((x) => x.key) : [c.key];
      const cb = h('input', { type: 'checkbox', checked: !keys.every((k) => st.hideSet.has(k)) });   // zaznaczone = pokazywane przy przekreślonym oku
      boxes.set(keys, cb);
      return h('label', { style: { display: 'block', margin: '3px 0' } }, cb, ' ', c.group === 'z' ? 'Zależności Z1–Z4 (B–E)' : `${c.title} (${c.letter})`);
    }));
    const apply = () => { st.hideSet = new Set(); for (const [keys, cb] of boxes) if (!cb.checked) keys.forEach((k) => st.hideSet.add(k)); lsSet(LS.hide, [...st.hideSet]); m.close(); if (st.data) draw(); };
    const m = modal('Co pokazywać przy ukrytych danych', h('div', {}, h('p', { class: 'muted' }, 'Zaznaczone kolumny zostają na ekranie, gdy oko jest przekreślone (dane ukryte). Odznaczone wtedy znikają. Przy zwykłym oku widać wszystkie kolumny. Zależności Z1–Z4 działają jako grupa. Okno otwiera prawy przycisk myszy na ikonie oka.'), list,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { boxes.forEach((cb) => { cb.checked = true; }); } }, 'Zaznacz wszystkie'), h('button', { class: 'btn', onclick: () => { boxes.forEach((cb) => { cb.checked = false; }); } }, 'Odznacz wszystkie'),
        h('button', { class: 'btn primary', onclick: apply }, 'OK'))));
  }

  const komisColor = (komis) => { const k = String(komis ?? '').trim(); const f = k && st.m && st.m.cfg && (st.m.cfg.komisColors || []).find((x) => x.komis === k); return f || null; };

  // Zaznaczenie wiersza: kliknięcie w dowolne miejsce linii (tabela albo wykres) podświetla ją ramką z poświatą.
  // Kliknięta linia: zielona poświata; jej suboperacje (dzieci): pomarańczowa; subsuboperacje (wnuki): żółta.
  const GLOW = { self: '0, 176, 80', child: '255, 140, 0', grand: '255, 215, 0' };
  // Zaznaczony pasek komisu (poziom IV): wszystkie operacje komisu świecą na pomarańczowo.
  const relationTo = (id, sel, komis) => (sel == null ? null : id === sel ? 'self' : isKomisId(sel) ? (String(komis || '').trim() === sel.slice(KOMIS_PREFIX.length) ? 'child' : null)
    : isKomisId(id) ? null : subParent(id) === sel ? 'child' : subParent(subParent(id) || '') === sel ? 'grand' : null);
  const applySelection = () => {
    const g = st.geom; if (!g || !g.rowEls) return;
    for (const [id, els] of g.rowEls) {
      const rel = relationTo(id, st.selected, els.komis), c = rel && GLOW[rel];
      const shadow = c ? `inset 0 0 0 2px rgb(${c}), 0 0 8px 2px rgba(${c}, .8)` : '';
      els.line.style.boxShadow = shadow;
      els.line.style.zIndex = c ? '3' : '';
      els.chart.style.boxShadow = shadow;
      els.chart.style.background = c ? `rgba(${c}, .14)` : '';
    }
  };
  const selectRow = (id) => { st.selected = id; autoPath(id); applySelection(); };

  // Zmiana kolejności dzieci (przeciągnij i upuść): operacja główna – suboperacje i subsuboperacje, suboperacja – jej subsuboperacje.
  // Przeciągać można tylko w obrębie jednego rodzica; litery się zamieniają, a powiązania (także z innych operacji) poprawiają się same.
  // Edytor gałęzi (dwuklik na operacji albo „Edycja gałęzi…” we właściwościach): numery, opisy, stanowiska, czasy, zależności, kolejność,
  // dodawanie i usuwanie suboperacji, notatnik i plik .txt – views/harmTreeEditor.js
  const editTree = (rootId) => { if (st.m && acc().add) treeEditor({ getOps: () => st.m.opsByLp, rootId, stations: stationList(st.m.cfg), access: acc() }); };


  // Udostępnianie: dane dla okna (wiersze, kolumny, style i paski jak na ekranie)
  function openShare() {
    if (!st.data || !st.m) { toast('Poczekaj na wczytanie danych'); return; }
    const ops = st.m.opsByLp, res = st.data.result;
    const dateMs = (r, key) => (r.komisRow ? r.ms[key] ?? null : key === 'start' ? res.get(r.id)?.start : key === 'koniec' ? res.get(r.id)?.end : (ops[r.id] || {})[key]) ?? null;
    const stationBg = (r) => parseSheetColor(r.stanowiskoBg, '#cccccc');
    const all = st.data.rows;
    const maxEnd = Math.max(Date.now(), ...all.map((r) => res.get(r.id)?.end || 0));
    shareDialog({
      user: appCtx && appCtx.user ? (appCtx.user.name || appCtx.user.email || '') : '',
      version: appCtx && appCtx.version ? appCtx.version : '',
      cols: COLS, shownKeys: shownCols().map((c) => c.key), rowsScreen: st.rows, rowsAll: withKomisRows(arrangeRows(all, new Set(), new Set()), komisSummaryList(), new Set(), { inline: st.komisOpt.inline }), komisShown: st.komisOpt.show, selectedId: st.selected,
      levelsHidden: st.hiddenLevels, interval: st.interval, holidays: holidayMap(st.m.cfg && st.m.cfg.holidays),
      axisStart: axisStartMs(H.localNow().getTime(), st.shift), maxEnd, nowMs: H.localNow().getTime(),
      cellOf: (r, c) => {
        const text = c.key === 'lp' ? (r.komisRow ? '' : '\u00a0\u00a0'.repeat(r.depth || 0) + (r.lp || '')) : val(r, c);
        if (r.komisRow && c.key === 'koniec' && r.late) return { text, date: r.ms.koniec, bg: '#ff0000', color: '#ffffff', bold: true };
        if (r.komisRow && c.key === 'hours') return r.sumHours > 0 ? { text, value: r.sumHours, bold: true } : { text, bold: true };
        if (c.key === 'station' && r.station) return { text, bg: stationBg(r), color: parseSheetColor(r.stanowiskoColor, '#000000'), bold: true, italic: true };
        if (c.isDate) { const ms = dateMs(r, c.key); return { text, date: ms == null ? null : ms }; }
        if (c.key === 'hours') { const v = (ops[r.id] || {}).hours; return v > 0 ? { text, value: v } : { text }; }
        return { text };
      },
      rowStyle: (r) => {
        if (r.komisRow) { const kc0 = komisColor(r.komis); return { bg: kc0 ? parseSheetColor(kc0.bg, '#fff2cc') : '#fff2cc', color: kc0 ? parseSheetColor(kc0.color, '#000000') : '#000000', bold: true }; }
        const kc = komisColor(r.komis), done = String(r.status).trim().toLowerCase() === 'zak.';
        return kc ? { bg: parseSheetColor(kc.bg, '#ffffff'), color: parseSheetColor(kc.color, '#000000'), bold: !!kc.bold, italic: !!kc.italic, underline: !!kc.underline } : { bg: done ? '#e6f2e0' : '#ffffff' };
      },
      barsOf: (r) => {
        const done = String(r.status).trim().toLowerCase() === 'zak.';
        if (r.komisRow) return { label: [r.komisName, r.hoursShown, r.status].filter(Boolean).join(' · '), frame: r.segs.length ? { start: r.ms.start, end: r.ms.koniec } : null, bars: r.segs.map(([s0, e0, c]) => ({ start: s0, end: e0, color: c })) };
        const label = chartLabel(r);
        // kolor operacji (komisu) jak na ekranie: z lewej pasek koloru maszyny, reszta w kolorze komisu (opcja „Kolor komisu na pasku”)
        const kcb = !done && st.chartOpt.komisColor ? komisColor(r.komis) : null;
        const fill = kcb ? parseSheetColor(kcb.bg, null) : null;
        const bar = (start, end, color) => (fill ? { start, end, color, fill } : { start, end, color });
        if (r.segs && r.segs.length) return { label, frame: { start: Math.min(...r.segs.map((x) => x[0])), end: Math.max(...r.segs.map((x) => x[1])) }, bars: r.segs.map(([s0, e0, c]) => bar(s0, e0, done ? ZAK_BAR : c)) };
        const rr = res.get(r.id);
        return { label, frame: null, bars: rr && rr.start != null && rr.end != null ? [bar(rr.start, rr.end, done ? ZAK_BAR : stationBg(r))] : [] };
      },
    });
  }

  // Szczegóły operacji: tylko prawy przycisk myszy (lewy zaznacza linię i edytuje komórki)
  function detail(r) {
    if (r.komisRow) { komisDetail(r); return; }
    const subs = st.data ? st.data.rows.filter((x) => x.parent === r.id) : [];
    const line = (k, v) => (String(v ?? '').trim() ? h('div', { class: 'row', style: { margin: '2px 0' } }, h('b', { style: { width: '150px' } }, k), h('span', {}, v)) : null);
    const body = [
      line('Komis', r.komis), line('Klient', r.client), line('Element', r.element), line('Stanowisko', r.stanowisko),
      line('Start', r.start), line('Koniec', r.koniec), line('Godziny', r.hoursShown || r.godziny), line('Dostawa', r.dostawa), line('Wysyłka', r.wysylka),
      line('Start ręczny', r.startManual), line('Koniec ręczny', r.endManual), line('Status', r.status),
      line('Lp / poprzedzające', [r.lp, r.z1, r.z2, r.z3, r.z4].filter(Boolean).join(' / ')),
      r.sub ? line(r.depth === 2 ? 'Suboperacja (detal)' : 'Operacja główna', r.parent) : null,
      subs.length ? h('div', { style: { marginTop: '6px' } }, h('b', {}, `${r.depth === 1 ? 'Subsuboperacje' : 'Suboperacje'} (${subs.length}):`), ...subs.map((x) => h('div', { style: { margin: '2px 0 2px 12px' } }, `${x.lp}  ·  ${x.start || '—'} → ${x.koniec || '—'}  ·  ${x.hours ? x.hours + ' h' : ''}${x.element ? '  ·  ' + x.element : ''}`))) : null,
    ].filter(Boolean);
    const m = modal('Operacja', h('div', {}, ...body, h('div', { class: 'actions' },
      acc().add ? h('button', { class: 'btn', title: acc().edit ? 'Edycja operacji z suboperacjami jako drzewo: numery, opisy, kolejność, nowe suboperacje, notatnik, plik .txt' : 'Dodawanie suboperacji do tej operacji (poziom ' + acc().label + ': bez zmian istniejących)', onclick: () => { m.close(); editTree(r.id); } }, acc().edit ? 'Edycja gałęzi…' : 'Dodaj suboperacje…') : null,
      h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))));
  }

  // Podsumowanie komisu (poziom IV): terminy, godziny, postęp, godziny na stanowiskach i lista operacji
  function komisDetail(r) {
    const ops = st.data.rows.filter((x) => String(x.komis || '').trim() === r.komisName);
    const line = (k, v) => (String(v ?? '').trim() ? h('div', { class: 'row', style: { margin: '2px 0' } }, h('b', { style: { width: '170px' } }, k), h('span', {}, v)) : null);
    const perStation = new Map();
    for (const x of ops) if (!x.subCount && x.stanowisko) perStation.set(x.stanowisko, (perStation.get(x.stanowisko) || 0) + (Number(x.hours) || 0));
    const m = modal(`Komis ${r.komisName}`, h('div', {},
      h('div', { class: 'muted', style: { marginBottom: '6px' } }, 'Pasek podsumowania: liczony z operacji komisu, nie zapisuje się w bazie i nie wpływa na harmonogram.'),
      line('Klient', r.client), line('Start pierwszej operacji', r.start), line('Koniec ostatniej operacji', r.koniec),
      line('Najbliższa wysyłka', r.wysylka), r.late ? h('div', { class: 'err' }, 'Koniec ostatniej operacji jest po wysyłce.') : null, line('Ostatnia dostawa', r.dostawa),
      line('Godziny (suma)', r.hoursShown), line('Operacji', `${r.opCount} (wykonywanych na stanowiskach: ${r.leafCount}, zakończonych: ${r.zakCount})`),
      perStation.size ? line('Godziny na stanowiskach', [...perStation].map(([k, v]) => `${k}: ${Math.round(v * 100) / 100}`).join(', ')) : null,
      h('div', { style: { marginTop: '6px', maxHeight: '300px', overflow: 'auto' } }, ...ops.map((x) => h('div', { style: { margin: '2px 0 2px ' + (6 + 14 * (x.depth || 0)) + 'px' } }, [x.lp || '—', x.stanowisko, `${x.start || '—'} → ${x.koniec || '—'}`, x.hoursShown ? x.hoursShown + ' h' : '', x.element, x.status].filter(Boolean).join('  ·  ')))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  }

  // ---------- informacje o dniu (prawy przycisk na dniu osi) ----------
  // Obsada maszyn z grafiku (graf_norm), pracownicy z Grafiku (karta G, kolory jak w Grafiku) i zadania z harmonogramu w dobie 6:00–6:00.
  function dayDialog(ms) {
    if (!st.data || !st.m) return;
    const day = dayOf(ms), stations = stationList(st.m.cfg);
    const look = Object.fromEntries(stations.map((x) => [x.name, x]));
    const holiday = holidayMap(st.m.cfg && st.m.cfg.holidays).get(day.iso);
    const slots = daySlots(st.days || {}, day.iso, stations);
    const order = Object.entries((st.days || {})[day.iso] || {}).map(([slot, code]) => ({ slot, code }));   // miejsca w kolejności kolumn graf_norm
    const work = slots.reduce((t, x) => t + x.hours, 0);
    const tasks = dayTasks(st.data.rows, st.data.result, day.start, day.end);
    const chip = (text, bg, color, extra = {}) => h('span', { style: { display: 'inline-block', padding: '1px 6px', margin: '1px 3px 1px 0', borderRadius: '3px', border: '1px solid rgba(0,0,0,.25)', background: bg || '#fff', color: color || '#000', fontSize: '12px', whiteSpace: 'nowrap', ...extra } }, text);
    const td = (content, style = {}, attrs = {}) => h('td', { ...attrs, style: { border: '1px solid #bbb', padding: '2px 5px', verticalAlign: 'middle', fontSize: '12px', ...style } }, content);
    const th = (t) => h('th', { style: { border: '1px solid #999', padding: '3px 5px', background: '#e4e4e4', fontSize: '12px', textAlign: 'left' } }, t);
    const hhmm = (v) => { const d = new Date(v); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`; };
    const personChip = (p, same) => chip(p.name, parseSheetColor(p.bg, '#ffffff'), parseSheetColor(p.color, '#000000'),
      { fontWeight: 700, title: `${p.fullName}: ${p.text}${p.value ? ' · ' + p.value : ''}${same === false ? '\nKod w Grafiku różni się od graf_norm' : ''}`, ...(same === false ? { outline: '2px dashed #c00000' } : {}) });
    // pozioma linia operatora: doba 6:00–6:00, jego zmiana podświetlona, na niej zadania stanowiska w czasie jego zmiany
    const STRIP = 360, x = (v) => ((v - day.start) / (day.end - day.start)) * STRIP;
    const line = (station, code, uncovered) => {
      const wins = code == null ? [] : shiftWindows(code, day.start);
      const segs = uncovered || operatorSegments(tasks.byStation.get(station) || [], wins, day.start, day.end);
      const sl = look[station] || { bg: '#cccccc', color: '#000000' };
      const box = h('div', { style: { position: 'relative', width: STRIP + 'px', height: '20px', background: '#f2f2f2', border: '1px solid #ccc' } });
      for (const w of wins) box.append(h('div', { style: { position: 'absolute', left: x(w.from) + 'px', width: x(w.to) - x(w.from) + 'px', top: 0, bottom: 0, background: '#d9ead3' } }));
      for (const hh of [8, 16]) box.append(h('div', { style: { position: 'absolute', left: (hh / 24) * STRIP + 'px', top: 0, bottom: 0, borderLeft: '1px dotted #888' } }));
      for (const sg of segs) {
        const r = sg.task.row, done = String(r.status).trim().toLowerCase() === 'zak.', kc = komisColor(r.komis);
        box.append(h('div', { title: `${r.lp} · ${r.komis} · ${r.element}\n${hhmm(sg.task.start)} → ${hhmm(sg.task.end)} · ${r.hoursShown || ''} h${r.status ? ' · ' + r.status : ''}`,
          style: { position: 'absolute', left: x(sg.from) + 'px', width: Math.max(2, x(sg.to) - x(sg.from)) + 'px', top: '2px', bottom: '2px', background: done ? ZAK_BAR : sl.bg, color: sl.color, border: '1px solid #000', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: '11px', fontWeight: 700, lineHeight: '14px', padding: '0 2px' } },
          h('span', { style: kc ? { background: parseSheetColor(kc.bg, '#fff'), color: parseSheetColor(kc.color, '#000'), padding: '0 2px' } : {} }, `${r.lp} ${r.komis}`)));
      }
      if (code != null && !wins.length) box.append(h('div', { style: { position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg,#eee,#eee 4px,#ddd 4px,#ddd 8px)' } }));
      return box;
    };
    const tbody = h('tbody', {}), restBox = h('div', {}), status = h('div', { class: 'muted', style: { margin: '4px 0' } }, 'Wczytywanie operatorów z Grafiku…');
    let operators = new Map();
    const render = () => {
      clear(tbody);
      const names = new Set(slots.map((s) => s.station));
      const list = [...slots, ...[...tasks.byStation.keys()].filter((k) => !names.has(k)).map((k) => ({ station: k, bg: (look[k] || {}).bg || '#cccccc', color: (look[k] || {}).color || '#000', slots: [], hours: 0 }))];
      for (const s of list) {
        const rowsOf = s.slots.length ? s.slots : [null];
        // zadania stanowiska poza zmianami operatorów z grafiku
        const unc = s.slots.length ? uncoveredSegments(tasks.byStation.get(s.station) || [], s.slots.flatMap((x) => shiftWindows(x.code, day.start))) : [];
        const span = rowsOf.length + (unc.length ? 1 : 0);
        rowsOf.forEach((x, k) => {
          const op = x && operators.get(x.slot);
          tbody.append(h('tr', {},
            k === 0 ? td(h('b', {}, s.station), { background: s.bg, color: s.color, fontStyle: 'italic', whiteSpace: 'nowrap', verticalAlign: 'top' }, { rowSpan: span }) : null,
            k === 0 ? td(`${s.hours} h`, { textAlign: 'right', fontWeight: 700, verticalAlign: 'top' }, { rowSpan: span }) : null,
            td(x ? h('span', {}, chip(x.slot, s.bg, s.color, { fontWeight: 700 }), chip(x.text || '—', x.work ? '#d9ead3' : x.text ? '#f4cccc' : '#fff', '#000', { title: x.shifts })) : h('span', { class: 'muted' }, 'brak w grafiku'), { whiteSpace: 'nowrap' }),
            td(op ? personChip(op.person, op.same) : h('span', { class: 'muted' }, x ? '—' : ''), { whiteSpace: 'nowrap' }),
            td(line(s.station, x ? x.code : null))));
        });
        if (unc.length) {
          tbody.append(h('tr', {}, td(h('span', { style: { color: '#c00000', fontWeight: 700 } }, 'bez obsady'), {}, { colSpan: 2, title: 'Zadania w godzinach, w których na stanowisku nie ma nikogo według grafiku' }), td(line(s.station, null, unc))));
        }
      }
      if (!list.length) tbody.append(h('tr', {}, td('Brak danych grafiku (graf_norm) i zadań dla tego dnia.', {}, { colSpan: 5 })));
    };
    render();
    const komisChips = tasks.komis.map((k) => { const kc = komisColor(k.komis); return chip(`${k.komis}${k.client ? ' · ' + k.client : ''} · zadań ${k.tasks} · ${k.stations.join(', ')}`, kc ? parseSheetColor(kc.bg, '#ffe599') : '#fff2cc', kc ? parseSheetColor(kc.color, '#000') : '#000', { fontWeight: 700 }); });
    const m = modal(`Dzień ${day.label} (${day.weekday})`, h('div', {},
      holiday != null ? h('div', { style: { background: HOLIDAY_BG, color: '#fff', fontWeight: 700, padding: '3px 8px', marginBottom: '6px', display: 'inline-block' } }, 'Święto' + (holiday ? ': ' + holiday : '')) : null,
      h('div', { class: 'muted', style: { marginBottom: '4px' } }, `Doba produkcyjna 06:00 – 06:00. Godzin pracy maszyn i stanowisk: ${work} h · zadań: ${tasks.tasks.length} · zleceń: ${tasks.komis.length}`),
      komisChips.length ? h('div', { style: { marginBottom: '6px' } }, h('b', { style: { fontSize: '12px', marginRight: '6px' } }, 'Zlecenia:'), ...komisChips) : null,
      h('div', { style: { overflowX: 'auto' } }, h('table', { style: { borderCollapse: 'collapse' } },
        h('thead', {}, h('tr', {}, th('Stanowisko'), th('Godziny'), th('Miejsce pracy (grafik)'), th('Operator'), th(h('div', { style: { position: 'relative', width: STRIP + 'px', height: '14px' } },
          ...[[0, '06'], [8, '14'], [16, '22'], [24, '06']].map(([hh, t]) => h('span', { style: { position: 'absolute', left: Math.min(STRIP - 14, (hh / 24) * STRIP) + 'px', fontSize: '11px' } }, t)))))),
        tbody)),
      status, restBox,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
    m.root.style.width = 'min(1000px, 96vw)'; m.root.style.maxWidth = '96vw';

    // operatorzy z karty G (Grafik): po kolei na wypełnione miejsca pracy; brak uprawnienia albo dnia w grafiku nie blokuje okna
    api('getGrData', [day.iso, day.iso]).then((gr) => {
      const people = grafikPeople(gr);
      const res = matchOperators(people, order);
      operators = res.bySlot; render();
      const diff = [...res.bySlot.values()].filter((v) => !v.same).length;
      status.textContent = people.length ? `Operatorzy z Grafiku: ${res.bySlot.size} z ${people.length}. Kolory jak w Grafiku.` + (diff ? ` Kod zmiany różny od graf_norm: ${diff} (czerwona przerywana ramka).` : '') : 'W Grafiku nie ma wpisów na ten dzień.';
      clear(restBox);
      if (res.rest.length) restBox.append(h('div', {}, h('b', { style: { fontSize: '12px', marginRight: '6px' } }, 'Bez miejsca pracy:'), ...res.rest.map((p) => chip(`${p.name}: ${p.text}`, parseSheetColor(p.bg, '#fff'), parseSheetColor(p.color, '#000')))));
    }).catch((e) => { status.textContent = 'Nie wczytano Grafiku: ' + (e.message || e); });
  }

  // Zwijanie strzałką ▾/▸ w kolumnie lp. (chowa potomków jednego węzła); całe poziomy chowają przyciski III, II, I.
  const toggleCollapse = (id) => { if (st.collapsed.has(id)) st.collapsed.delete(id); else st.collapsed.add(id); draw(); };

  // ---------- ustawienia harmonogramu (kolory stanowisk, nowe stanowiska, kolory komisów) ----------
  function stationsDialog() {
    const god = acc().style;   // kolory i czcionki operacji, stanowiska, komisy i święta – tylko GOD
    const cur = stationList(st.m && st.m.cfg);
    const rows = cur.map((x) => ({ name: x.name, bg: x.bg, color: x.color, sum: !!x.sum, builtin: x.builtin }));
    const box = h('div', {});
    const render = () => {
      clear(box);
      for (const r of rows) {
        const def = DEFAULT_STATIONS.find((d) => d.name === r.name);
        const bgI = h('input', { type: 'color', value: parseSheetColor(r.bg, '#cccccc'), oninput: () => { r.bg = bgI.value; sample.style.background = r.bg; } });
        const fgI = h('input', { type: 'color', value: parseSheetColor(r.color, '#000000'), oninput: () => { r.color = fgI.value; sample.style.color = r.color; } });
        const sample = h('span', { style: { display: 'inline-block', width: '64px', textAlign: 'center', fontStyle: 'italic', fontWeight: 700, padding: '2px 6px', background: r.bg, color: r.color } }, r.name);
        box.append(h('div', { class: 'row', style: { margin: '4px 0', alignItems: 'center' } }, sample, h('span', { class: 'muted' }, 'tło'), bgI, h('span', { class: 'muted' }, 'tekst'), fgI,
          def ? h('button', { class: 'btn small', title: 'Przywraca kolory ze zrzutu arkusza', onclick: () => { r.bg = def.bg; r.color = def.color; render(); } }, 'Domyślne')
              : h('label', { class: 'muted', title: 'Zaznacz, gdy godziny wszystkich miejsc pracy mają się sumować (jak Śl, Do, Narz). Bez zaznaczenia stanowisko liczy się jak maszyna: jeden operator, do 8 h na zmianę' }, h('input', { type: 'checkbox', checked: r.sum, onchange: (e) => { r.sum = e.target.checked; } }), ' sumuj godziny'),
          def ? null : h('button', { class: 'btn small', title: 'Usuwa dodane stanowisko z listy (operacje zostają)', onclick: () => { rows.splice(rows.indexOf(r), 1); render(); } }, 'Usuń')));
      }
    };
    render();
    // kolory komisów: wiersz = komis + kolor tła + kolor tekstu
    const kRows = ((st.m && st.m.cfg && st.m.cfg.komisColors) || []).map((x) => ({ komis: x.komis, bg: x.bg || '#ffe599', color: x.color || '#000000', bold: !!x.bold, italic: !!x.italic, underline: !!x.underline }));
    const kBox = h('div', {});
    const kRender = () => {
      clear(kBox);
      if (!kRows.length) kBox.append(h('div', { class: 'muted' }, 'Brak pozycji. Wpisz komis (np. 25/803) i wybierz kolor.'));
      for (const r of kRows) {
        const bgI = h('input', { type: 'color', value: parseSheetColor(r.bg, '#ffe599'), oninput: () => { r.bg = bgI.value; sample.style.background = r.bg; } });
        const fgI = h('input', { type: 'color', value: parseSheetColor(r.color, '#000000'), oninput: () => { r.color = fgI.value; sample.style.color = r.color; } });
        const styleOf = () => ({ fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? 'italic' : 'normal', textDecoration: r.underline ? 'underline' : 'none' });
        // nazwę komisu można poprawić w miejscu (pole pokazuje od razu wybrany kolor i styl)
        const sample = h('input', { type: 'text', value: r.komis, spellcheck: 'false', title: 'Komis (można edytować)', list: 'harm-komis-list', oninput: () => { r.komis = sample.value; },
          style: { width: '110px', textAlign: 'center', padding: '2px 6px', border: '1px solid #999', background: r.bg, color: r.color, ...styleOf() } });
        const flag = (key, label, title) => h('label', { class: 'muted', title }, h('input', { type: 'checkbox', checked: r[key], onchange: (e) => { r[key] = e.target.checked; Object.assign(sample.style, styleOf()); } }), ' ' + label);
        kBox.append(h('div', { class: 'row', style: { margin: '4px 0', alignItems: 'center', flexWrap: 'wrap' } }, sample, h('span', { class: 'muted' }, 'tło'), bgI, h('span', { class: 'muted' }, 'tekst'), fgI,
          flag('bold', 'B', 'Pogrubienie'), flag('italic', 'I', 'Kursywa'), flag('underline', 'U', 'Podkreślenie'),
          h('button', { class: 'btn small', onclick: () => { kRows.splice(kRows.indexOf(r), 1); kRender(); } }, 'Usuń')));
      }
    };
    kRender();
    const komisI = h('input', { type: 'text', placeholder: 'Komis, np. 25/803', style: { padding: '4px', width: '220px' }, spellcheck: 'false', list: 'harm-komis-list' });
    const komisHints = h('datalist', { id: 'harm-komis-list' }, ...[...new Set(((st.data && st.data.rows) || []).map((r) => r.komis).filter(Boolean))].sort().map((k) => h('option', { value: k })));
    const kAdd = h('button', { class: 'btn small', onclick: () => {
      const k = komisI.value.trim();
      if (!k) { toast('Wpisz komis'); return; }
      if (kRows.some((r) => r.komis === k)) { toast('Ten komis ma już kolor'); return; }
      kRows.push({ komis: k, bg: '#ffe599', color: '#000000', bold: false, italic: false, underline: false }); komisI.value = ''; kRender();
    } }, 'Dodaj komis');
    // wygląd tabeli (zapamiętywany na tym komputerze)
    const num = (value, min, max) => h('input', { type: 'number', value: String(value), min: String(min), max: String(max), style: { width: '80px', padding: '4px' } });
    const rowHI = num(st.layout.rowH, 16, 80), dateWI = num(st.layout.dateW, 60, 220);
    const kOpt = { ...st.komisOpt };
    const cOpt = { ...st.chartOpt, fields: [...st.chartOpt.fields] };   // wykres: pola napisu, czcionka, kolor komisu
    const kCheck = (key, label, tip) => h('label', { style: { display: 'block', margin: '3px 0' }, title: tip || '' }, h('input', { type: 'checkbox', checked: !!kOpt[key], onchange: (e) => { kOpt[key] = e.target.checked; } }), ' ' + label);
    // święta: tabela dat (dd.mm.rrrr) z opisem; w nagłówku osi są bordowe z białą pogrubioną czcionką
    const fmtDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso; };
    const hRows = [...holidayMap(st.m && st.m.cfg && st.m.cfg.holidays)].sort((a, b) => a[0].localeCompare(b[0])).map(([date, name]) => ({ text: fmtDay(date), name }));
    const hBox = h('div', {});
    const hRender = () => {
      clear(hBox);
      const table = h('table', { style: { borderCollapse: 'collapse' } }, h('thead', {}, h('tr', {}, ...['Data (dd.mm.rrrr)', 'Opis', ''].map((t) => h('th', { style: { textAlign: 'left', padding: '2px 6px', background: '#eee', border: '1px solid #999', fontSize: '12px' } }, t)))));
      const tb = h('tbody', {});
      for (const r of hRows) {
        const dI = h('input', { type: 'text', value: r.text, placeholder: 'np. 11.11.2026', spellcheck: 'false', style: { width: '110px', border: 'none', padding: '3px 6px' }, oninput: () => { r.text = dI.value; } });
        const nI = h('input', { type: 'text', value: r.name, placeholder: 'np. Święto Niepodległości', style: { width: '240px', border: 'none', padding: '3px 6px' }, oninput: () => { r.name = nI.value; } });
        tb.append(h('tr', {}, h('td', { style: { border: '1px solid #999', padding: 0, whiteSpace: 'nowrap' } }, dI, calendarButton(dI, { title: 'Wybierz datę święta z kalendarza', holidays: holidayMap(st.m && st.m.cfg && st.m.cfg.holidays) })), h('td', { style: { border: '1px solid #999', padding: 0 } }, nI),
          h('td', { style: { border: '1px solid #999', padding: '0 4px' } }, h('button', { class: 'btn small', onclick: () => { hRows.splice(hRows.indexOf(r), 1); hRender(); } }, 'Usuń'))));
      }
      table.append(tb); hBox.append(table);
    };
    hRender();
    const hAdd = h('button', { class: 'btn small', onclick: () => { hRows.push({ text: '', name: '' }); hRender(); const ins = hBox.querySelectorAll('tbody tr:last-child input'); if (ins[0]) ins[0].focus(); } }, 'Dodaj święto');
    const nameI = h('input', { type: 'text', placeholder: 'Nazwa nowego stanowiska, np. 4Fr', style: { padding: '4px', width: '220px' }, spellcheck: 'false' });
    const addBtn = h('button', { class: 'btn small', onclick: () => {
      const name = nameI.value.trim();
      if (!name) { toast('Wpisz nazwę stanowiska'); return; }
      if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) { toast('Takie stanowisko już jest'); return; }
      rows.push({ name, bg: '#cccccc', color: '#000000', sum: false, builtin: false }); nameI.value = ''; render();
    } }, 'Dodaj stanowisko');
    const save = async () => {
      // zapisujemy tylko zmiany: stanowiska dodane i te, których kolory różnią się od domyślnych
      const list = rows.filter((r) => { const d = DEFAULT_STATIONS.find((x) => x.name === r.name); return !d || d.bg !== r.bg || d.color !== r.color || r.sum; });
      // komisy: bez pustych i powtórzonych nazw; święta: poprawne daty bez powtórzeń
      const komisList = kRows.map((r) => ({ ...r, komis: r.komis.trim() })).filter((r) => r.komis);
      if (new Set(komisList.map((r) => r.komis)).size !== komisList.length) { toast('Ten sam komis jest na liście kolorów dwa razy'); return; }
      const holidays = [];
      for (const r of hRows) {
        if (!r.text.trim() && !r.name.trim()) continue;
        const t = parseDateTime(r.text.trim());
        if (t == null) { toast(`Święta: nie rozpoznano daty „${r.text}” (wpisz np. 11.11.2026)`); return; }
        const iso = new Date(t).toISOString().slice(0, 10);
        if (holidays.some((x) => x.date === iso)) { toast(`Święta: data ${r.text.trim()} jest wpisana dwa razy`); return; }
        holidays.push({ date: iso, name: r.name.trim() });
      }
      holidays.sort((a, b) => a.date.localeCompare(b.date));
      try {
        const clamp = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
        st.layout = { rowH: clamp(rowHI.value, 16, 80, DEFAULT_LAYOUT.rowH), dateW: clamp(dateWI.value, 60, 220, DEFAULT_LAYOUT.dateW) }; lsSet(LS.layout, st.layout);
        st.komisOpt = kOpt; lsSet(LS.komis, kOpt);
        if (god) st.chartOpt = { ...cOpt, fields: CHART_FIELDS.map(([k]) => k).filter((k) => cOpt.fields.includes(k)) }; lsSet(LS.chart, st.chartOpt);
        if (god) await saveSettings(list, komisList, holidays);
        m.close(); toast('Zapisano ustawienia'); if (st.data) draw();
      } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
    };
    const m = modal('Ustawienia harmonogramu', h('div', {},
      h('h3', { style: { margin: '4px 0' } }, 'Wygląd tabeli'),
      h('div', { class: 'row', style: { alignItems: 'center' } }, 'Wysokość wiersza operacji [px]', rowHI, ' Szerokość kolumn dat [px]', dateWI, h('button', { class: 'btn small', onclick: () => { rowHI.value = String(DEFAULT_LAYOUT.rowH); dateWI.value = String(DEFAULT_LAYOUT.dateW); } }, 'Domyślne')),
      h('p', { class: 'muted' }, 'Zapisywane na tym komputerze. Domyślnie szerokość pasuje do daty „dd.mm.rrrr hh”.'),
      h('label', { style: { display: 'block', margin: '6px 0' } }, h('input', { type: 'checkbox', checked: st.confirmChanges, onchange: (e) => { st.confirmChanges = e.target.checked; lsSet(LS.confirm, st.confirmChanges); } }), ' Potwierdzaj zmiany komórek (okno ze starą i nową wartością przed zapisem)'),
      ...(god ? [h('h3', { style: { margin: '14px 0 4px' } }, 'Wykres'),
      h('p', { class: 'muted' }, 'Napis na pasku operacji (zaznaczone pola, w tej kolejności) i wielkość jego czcionki. Zapisywane na tym komputerze.'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '2px 14px' } }, ...CHART_FIELDS.map(([k, label]) => h('label', {}, h('input', { type: 'checkbox', checked: cOpt.fields.includes(k),
        onchange: (e) => { cOpt.fields = e.target.checked ? [...cOpt.fields, k] : cOpt.fields.filter((x) => x !== k); } }), ' ' + label))),
      h('div', { class: 'row', style: { alignItems: 'center', marginTop: '6px' } }, 'Czcionka napisów na wykresie: ',
        (() => { const sel = h('select', { onchange: () => { cOpt.font = Number(sel.value); } }, h('option', { value: 0 }, 'jak w tabeli'), ...[8, 9, 10, 11, 12, 13, 14, 16, 18].map((n) => h('option', { value: n }, n + ' px'))); sel.value = String(cOpt.font || 0); return sel; })()),
      h('label', { style: { display: 'block', margin: '6px 0' } }, h('input', { type: 'checkbox', checked: !!cOpt.komisColor, onchange: (e) => { cOpt.komisColor = e.target.checked; } }),
        ' Kolor komisu na pasku: z lewej 10 px koloru maszyny (stanowiska), reszta w kolorze komisu z listy „Kolory komisów”')] : []),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Podsumowanie komisów'),
      h('p', { class: 'muted' }, 'Pasek komisu zbiera wszystkie operacje komisu (terminy, godziny, postęp, wysyłka). Tylko informacja – nie wpływa na harmonogram. Zapisywane na tym komputerze.'),
      kCheck('show', 'Pokazuj paski podsumowania komisów'),
      kCheck('inline', 'Przypasuj pasek do pierwszego wystąpienia komisu (zamiast wszystkich na górze tabeli)'),
      kCheck('filter', 'Filtruj i sortuj także paski podsumowania (wg filtrów i sortowania kolumn)', 'Bez zaznaczenia paski są zawsze widoczne i ułożone wg pierwszego wystąpienia komisu'),
      ...(god ? [h('h3', { style: { margin: '14px 0 4px' } }, 'Stanowiska'),
      h('p', { class: 'muted' }, 'Kolor stanowiska widać w kolumnie „Stan.” i na paskach wykresu. Nowe stanowisko ma też kolumny z miejscami pracy w karcie graf_norm (np. „4Fr1”); bez nich program nie wyliczy końca jego operacji.'),
      box, h('div', { class: 'row', style: { marginTop: '8px' } }, nameI, addBtn),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Kolory komisów'), h('p', { class: 'muted' }, 'Wiersze operacji danego komisu są podświetlone wybranym kolorem w tabeli. Nazwę komisu można poprawić w polu.'),
      kBox, h('div', { class: 'row', style: { marginTop: '8px' } }, komisI, komisHints, kAdd),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Dni świąteczne'), h('p', { class: 'muted' }, 'Święta są w nagłówku osi czasu bordowe, z białą pogrubioną czcionką, a ich tło na wykresie jest białe jak w weekend.'),
      hBox, h('div', { class: 'row', style: { marginTop: '8px' } }, hAdd),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Kopia całego harmonogramu'),
      h('p', { class: 'muted' }, 'Eksport zapisuje wszystkie operacje i ustawienia (stanowiska, kolory komisów, święta) do pliku .json. Import zastępuje cały harmonogram zawartością pliku – przed zapisem pokazuje zmiany i może najpierw zapisać kopię obecnego stanu. Tylko poziom GOD.'),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn small', onclick: () => exportBackup() }, 'Eksport do pliku…'),
        h('button', { class: 'btn small', onclick: () => { m.close(); importBackup(); } }, 'Import z pliku…'))] : [h('p', { class: 'muted', style: { marginTop: '14px' } }, `Kolory i czcionki wykresu, stanowiska, kolory komisów i święta zmienia tylko poziom GOD (Twój: ${acc().label}).`)]),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: save }, 'Zapisz'))));
  }

  // ---------- kopia całego harmonogramu (tylko GOD) ----------
  const b64utf8 = (text) => { const bytes = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  async function exportBackup() {
    if (!st.m) { toast('Poczekaj na wczytanie danych'); return false; }
    if (!acc().style) { toast(`Poziom ${acc().label}: eksport tylko dla GOD`); return false; }
    const data = backupData(st.m.opsByLp, st.m.cfg, { app: 'PC ' + ((appCtx && appCtx.version) || ''), user: (appCtx && appCtx.user && (appCtx.user.name || appCtx.user.email)) || '' });
    const name = backupFileName();
    const ok = await window.zks.saveFile(name, 'application/json', b64utf8(backupText(data)));
    if (ok) toast(`Zapisano kopię: ${name} (operacji: ${data.count})`);
    return !!ok;
  }
  function importBackup() {
    if (!acc().style) { toast(`Poziom ${acc().label}: import tylko dla GOD`); return; }
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0]; fileIn.remove();
      if (!f || !st.m) return;
      const p = parseBackup(await f.text());
      const d = backupDiff(st.m.opsByLp, p.ops);
      const list = (title, items, color) => (items.length ? h('div', { style: { margin: '3px 0', color } }, h('b', {}, `${title}: ${items.length}`), ' ', items.slice(0, 30).join(', ') + (items.length > 30 ? ' …' : '')) : null);
      const withCfg = h('input', { type: 'checkbox', checked: !!p.config, disabled: !p.config });
      const backupFirst = h('input', { type: 'checkbox', checked: true });
      const go = h('button', { class: 'btn primary', disabled: p.errors.length > 0 || !Object.keys(p.ops).length, style: { background: '#c00000', borderColor: '#c00000' } }, 'Zastąp harmonogram');
      const dm = modal('Import całego harmonogramu', h('div', {},
        h('div', {}, h('b', {}, f.name), p.meta.exportedAt ? `  ·  wyeksportowano ${new Date(p.meta.exportedAt).toLocaleString('pl-PL')}` : '', p.meta.user ? `  ·  ${p.meta.user}` : '', p.meta.app ? `  ·  ${p.meta.app}` : ''),
        h('div', { style: { margin: '6px 0' } }, `Operacji w pliku: ${Object.keys(p.ops).length}, obecnie w bazie: ${Object.keys(st.m.opsByLp).length}.`),
        list('Nowe', d.added, '#1e7b34'), list('Zmienione', d.changed, '#b45309'), list('Usunięte (nie ma ich w pliku)', d.removed, '#c00000'),
        h('div', { class: 'muted' }, `Bez zmian: ${d.unchanged}`),
        p.errors.length ? h('div', { class: 'err', style: { whiteSpace: 'pre-wrap', marginTop: '6px' } }, 'Błędy (import zablokowany):\n' + p.errors.join('\n')) : null,
        p.warnings.length ? h('div', { class: 'muted', style: { whiteSpace: 'pre-wrap', marginTop: '6px', maxHeight: '90px', overflow: 'auto' } }, 'Uwagi:\n' + p.warnings.join('\n')) : null,
        h('label', { style: { display: 'block', marginTop: '8px' } }, withCfg, ' Importuj też ustawienia: stanowiska, kolory komisów, święta' + (p.config ? '' : ' (brak w pliku)')),
        h('label', { style: { display: 'block' } }, backupFirst, ' Najpierw zapisz kopię obecnego harmonogramu do pliku'),
        h('p', { style: { color: '#c00000', fontWeight: 700 } }, 'Import zastępuje CAŁY harmonogram (wszyscy użytkownicy zobaczą zmianę od razu). Nie da się go cofnąć ikoną ↶.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => dm.close() }, 'Anuluj'), go)), { wide: true });
      go.addEventListener('click', async () => {
        if (backupFirst.checked && !(await exportBackup())) { toast('Import przerwany: nie zapisano kopii obecnego harmonogramu'); return; }
        go.disabled = true;
        try { const r = await restoreBackup(p.ops, withCfg.checked ? p.config : null); dm.close(); toast(`Zaimportowano operacji: ${r.operations}` + (withCfg.checked ? ' i ustawienia' : '')); }
        catch (e) { go.disabled = false; toast('Nie zaimportowano: ' + (e.code === 'permission-denied' ? 'brak uprawnień (tylko GOD)' : e.message || e)); }
      });
    });
    document.body.append(fileIn); fileIn.click();
  }

  // ---------- rysowanie ----------
  function draw() {
    const sc = st.scale, iv = intervalOf(st.interval), ROW = Math.round(st.layout.rowH * sc), FONT = BASE.font * sc;
    const HOUR = CELL_W * sc / iv.hours;        // px na godzinę: kolumna osi ma stałą szerokość, więc interwał działa jak powiększenie osi czasu
    const HEAD = Math.ceil(Math.max(textW(sampleLabel(st.interval), FONT, true), ...COLS.filter((c) => c.vertical).map((c) => textW(c.title, FONT, true)))) + 14;   // wysokość nagłówka = najdłuższy opis w pionie
    const cols = shownCols();
    const colW = (c) => Math.round((c.isDate ? st.layout.dateW : c.w) * sc);
    const LEFT = cols.reduce((a, c) => a + colW(c), 0) + Math.round(34 * sc);
    const now = H.localNow();
    syncTools();
    if (!st.data || !st.data.rows.length) { clear(body); body.append(h('div', { class: 'muted', style: { padding: '12px' } }, st.data ? 'Baza jest pusta. Użyj „Dodaj operację”.' : 'Wczytywanie…')); st.rows = []; return; }
    const all = st.data.rows;
    // suboperacje pod operacją główną; zwinięte pomijane; paski podsumowania komisów na górze (albo przy pierwszym wystąpieniu komisu)
    const rows = withKomisRows(arrangeRows(sortRows(visibleRows(all, COLS, st.filters, val), COLS, st.sorts, val), st.collapsed, st.hiddenLevels), komisSummaryList(), st.collapsed, { inline: st.komisOpt.inline });
    const startMs = axisStartMs(now.getTime(), st.shift);
    const chart = H.buildChart({ rows, holidays: [], rapData: {} }, { komis: new Set(), station: new Set() }, H.emptySorts(), 0, now, { keepAll: true, axisStartMs: startMs });
    const maxEnd = Math.max(startMs, ...chart.items.filter((it) => it.end).map((it) => it.end.getTime()));
    const cells = buildCells(startMs, maxEnd, st.interval, holidayMap(st.m && st.m.cfg && st.m.cfg.holidays));
    const n = chart.items.length, chartW = Math.ceil(cells.reduce((a, c) => a + c.hours, 0) * HOUR);
    st.rows = rows; st.chart = chart; st.geom = { HOUR, ROW, FONT, HEAD, cols, colW, LEFT, chartW, now };
    const nOps = rows.filter((r) => !r.komisRow).length;
    if (document.activeElement !== shiftInput) shiftInput.value = String(st.shift);
    syncTools();
    for (const [lvl, b] of levelBtns) { const on = !st.hiddenLevels.has(lvl); b.classList.toggle('primary', on); b.style.textDecoration = on ? 'none' : 'line-through'; }

    // nagłówek
    const left = h('div', { style: { position: st.compact ? 'sticky' : 'relative', left: 0, zIndex: 6, width: LEFT + 'px', flex: 'none', background: '#fff', borderRight: '2px solid #888' } });
    const leftHead = h('div', { style: { position: 'sticky', top: 0, zIndex: 8, display: 'flex', height: HEAD + 'px', width: LEFT + 'px', background: '#eee', borderBottom: '1px solid #888', boxSizing: 'border-box' } });
    for (const c of cols) {
      const filtered = !!st.filters[c.key];
      const hideable = st.hideSet.has(c.key);
      leftHead.append(h('div', { title: `Kolumna ${c.letter}${c.ro ? ' (liczona przez program)' : ''}. Kliknij: filtr i sortowanie`, onclick: () => openFilter(c),
        style: { width: colW(c) + 'px', flex: 'none', boxSizing: 'border-box', borderRight: '1px solid #999', padding: '3px', fontSize: FONT + 'px', fontWeight: 700, cursor: 'pointer', userSelect: 'none', overflow: 'hidden', display: 'flex', alignItems: 'flex-end',
          background: filtered ? '#cfe3ff' : hideable ? '#ff0000' : '#e4e4e4', color: hideable && !filtered ? '#fff' : '#000' } },
        h('span', { style: c.vertical ? { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', lineHeight: '1.15', margin: '0 auto' } : { lineHeight: '1.15', wordBreak: 'break-word', whiteSpace: c.w <= 40 ? 'nowrap' : 'normal' } }, c.title + (filtered ? ' ▼' : '') + (sortLabel(c.key) ? ' ' + sortLabel(c.key) : ''))));
    }
    leftHead.append(h('div', { style: { flex: 1 } }));
    left.append(leftHead);
    const leftRows = h('div', { style: { position: 'relative', height: n * ROW + 'px', width: LEFT + 'px' } });
    left.append(leftRows);

    const chartEl = h('div', { style: { position: 'relative', width: chartW + 'px', flex: 'none' } });
    const head = h('div', { style: { position: 'sticky', top: 0, zIndex: 5, height: HEAD + 'px', width: chartW + 'px', overflow: 'hidden' } });
    const rowsEl = h('div', { style: { position: 'relative', height: n * ROW + 'px', width: chartW + 'px', background: '#f2f2f2' } });
    // kolumny osi: dzień roboczy zielony, sobota niebieska, niedziela czerwona, święto bordowe (biała pogrubiona czcionka); tygodnie i miesiące zielone
    let x = 0;
    for (const c of cells) {
      const w = c.hours * HOUR, isNow = now.getTime() >= c.start && now.getTime() < c.end, off = c.kind === 'sat' || c.kind === 'sun' || c.kind === 'holiday';
      const bg = c.kind === 'holiday' ? HOLIDAY_BG : c.kind === 'sun' ? '#ff0000' : c.kind === 'sat' ? '#00b0f0' : '#00b050';
      const cellMs = (e) => { const b = e.currentTarget.getBoundingClientRect(); return c.start + Math.max(0, Math.min(1, (e.clientX - b.left) / Math.max(1, b.width))) * (c.end - c.start); };
      head.append(h('div', { title: (c.kind === 'holiday' ? 'Święto' + (c.holidayName ? ': ' + c.holidayName : '') + '\n' : '') + 'Prawy przycisk: informacje o dniu (obsada, pracownicy, zadania)',
        oncontextmenu: (e) => { e.preventDefault(); dayDialog(cellMs(e)); }, style: { position: 'absolute', left: x + 'px', top: 0, width: w + 'px', height: HEAD + 'px', background: bg, borderRight: '1px solid #999', borderBottom: '1px solid #999', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
        h('span', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', fontSize: FONT + 'px', fontWeight: isNow || c.kind === 'holiday' ? 700 : 400, color: c.kind === 'sat' ? '#000' : '#fff' } }, c.label)));
      if (off) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 0, pointerEvents: 'none', left: x + 'px', top: 0, width: w + 'px', height: n * ROW + 'px', background: '#ffffff' } }));   // weekend i święta: białe tło
      if (isNow) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 2, pointerEvents: 'none', left: x + 'px', top: 0, width: w + 'px', height: n * ROW + 'px', background: 'rgba(0,176,80,.18)' } }));
      x += w;
    }
    const nowX = (now.getTime() - chart.axisStart.getTime()) / 3600000 * HOUR;
    if (nowX > 0) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 3, pointerEvents: 'none', left: nowX + 'px', top: 0, width: 0, height: n * ROW + 'px', borderLeft: '2px dashed #ff6600' } }));
    const dyn = h('div', { style: { position: 'absolute', left: 0, top: 0, width: chartW + 'px', height: n * ROW + 'px' } });   // paski i zależności tylko dla widocznych wierszy
    rowsEl.append(dyn);
    chartEl.append(head, rowsEl);
    st.geom.leftRows = leftRows; st.geom.dyn = dyn;

    const sy = body.scrollTop, sx = body.scrollLeft;
    clear(body);
    body.append(h('div', { style: { display: 'flex', width: (LEFT + chartW) + 'px', minHeight: '100%' } }, left, chartEl));
    body.scrollTop = sy; body.scrollLeft = sx;
    paintWindow();
  }

  function paintWindow() {
    const g = st.geom; if (!g || !g.leftRows || st.editing) return;
    const { ROW, FONT, HEAD, HOUR, cols, colW, LEFT } = g, chart = st.chart, n = chart.items.length;
    const top = Math.max(0, body.scrollTop - HEAD - ROW * 3), vh = body.clientHeight || 700;
    const from = Math.max(0, Math.floor(top / ROW)), to = Math.min(n, Math.ceil((top + vh + 6 * ROW) / ROW));
    clear(g.leftRows); clear(g.dyn); g.rowEls = new Map();
    // pasek podsumowania komisu: tylko informacja – bez edycji i usuwania; strzałka zwija operacje komisu, prawy przycisk pokazuje podsumowanie
    const paintKomis = (i, r) => {
      const kc = komisColor(r.komis);
      const bgRow = kc ? parseSheetColor(kc.bg, '#fff2cc') : '#fff2cc';
      const line = h('div', { title: 'Podsumowanie komisu – nie wpływa na harmonogram. Prawy przycisk: szczegóły',
        style: { position: 'absolute', top: i * ROW + 'px', left: 0, display: 'flex', height: ROW + 'px', width: LEFT + 'px', background: bgRow, color: kc ? parseSheetColor(kc.color, '#000000') : '#000', fontWeight: 700, borderTop: '2px solid #000', borderBottom: '1px solid #8c8c8c', boxSizing: 'border-box' } });
      for (const col of cols) {
        let text = col.key === 'lp' ? (st.collapsed.has(r.id) ? '▸' : '▾') : col.key === 'station' ? '' : val(r, col);   // kolumna lp. pusta (tylko strzałka zwijania), komis w kolumnie Komis
        const late = col.key === 'koniec' && r.late;
        const cell = h('div', { title: late ? 'Koniec ostatniej operacji jest po najbliższej wysyłce komisu' : col.key === 'lp' ? 'Kliknij strzałkę, aby zwinąć lub rozwinąć operacje komisu' : '',
          style: { width: colW(col) + 'px', flex: 'none', height: ROW - 2 + 'px', lineHeight: ROW - 3 + 'px', padding: '0 3px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: FONT + 'px', borderRight: '1px solid #8c8c8c', cursor: col.key === 'lp' ? 'pointer' : 'default', ...(late ? { background: '#ff0000', color: '#fff' } : {}) } }, text);
        if (col.key === 'lp') cell.addEventListener('click', () => toggleCollapse(r.id));
        else cell.addEventListener('click', () => setCursor(r.id, col.key, { scroll: false }));
        cell.dataset.cid = r.id; cell.dataset.ckey = col.key;
        if (st.cursor && st.cursor.id === r.id && st.cursor.key === col.key) Object.assign(cell.style, { outline: '2px solid #1a73e8', outlineOffset: '-2px' });
        line.append(cell);
      }
      line.addEventListener('mousedown', () => selectRow(r.id));
      line.addEventListener('contextmenu', (e) => { e.preventDefault(); selectRow(r.id); detail(r); });
      g.leftRows.append(line);
      const chartRow = h('div', { onclick: () => selectRow(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, style: { position: 'absolute', left: 0, top: i * ROW + 'px', width: g.chartW + 'px', height: ROW + 'px', cursor: 'pointer', boxSizing: 'border-box', borderTop: '2px solid rgba(0,0,0,.35)' } });
      g.dyn.append(chartRow); g.rowEls.set(r.id, { line, chart: chartRow, komis: r.komis });
      const x0 = chart.axisStart.getTime(), at = (ms) => Math.max(0, (ms - x0) / 3600000) * HOUR;
      if (r.segs.length && r.ms.koniec > x0) {
        const L = at(r.ms.start), W = Math.max(2, at(r.ms.koniec) - L);
        const tip = `Komis ${r.komisName}\n${r.start} → ${r.koniec}\nGodziny: ${r.hoursShown || '—'}, zakończone ${r.zakCount}/${r.leafCount}` + (r.wysylka ? `\nWysyłka: ${r.wysylka}` : '');
        const box = h('div', { title: tip, onclick: () => selectRow(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: L + 'px', top: i * ROW + 2 + 'px', width: W + 'px', height: ROW - 4 + 'px', border: '2px solid #000', boxSizing: 'border-box', background: '#fff', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000' } });
        for (const [s0, e0, color] of r.segs) { if (e0 <= x0) continue; const l = at(s0) - L, w = Math.max(1, at(e0) - at(s0)); box.append(h('div', { style: { position: 'absolute', left: l - 2 + 'px', top: 0, bottom: 0, width: w + 'px', background: color, borderRight: '1px solid #fff', boxSizing: 'border-box', pointerEvents: 'none' } })); }
        box.append(h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 6 - FONT * 1.25) / 2) + 'px', lineHeight: '1.25', background: 'rgba(255,255,255,.75)', padding: '0 2px' } }, [r.komisName, r.hoursShown, r.status].filter(Boolean).join(' · ')));
        g.dyn.append(box);
      }
      if (r.ms.wysylka != null && r.ms.wysylka > x0) g.dyn.append(h('div', { title: 'Wysyłka komisu: ' + r.wysylka, style: { position: 'absolute', zIndex: 2, left: at(r.ms.wysylka) - 1 + 'px', top: i * ROW + 'px', width: '3px', height: ROW + 'px', background: '#c00000' } }));
    };
    for (let i = from; i < to; i++) {
      const it = chart.items[i], r = it.row;
      if (r.komisRow) { paintKomis(i, r); continue; }
      const done = String(r.status).trim().toLowerCase() === 'zak.';
      const kc = komisColor(r.komis);
      const line = h('div', { style: { position: 'absolute', top: i * ROW + 'px', left: 0, display: 'flex', height: ROW + 'px', width: LEFT + 'px', background: kc ? parseSheetColor(kc.bg, '#ffffff') : done ? '#e6f2e0' : i % 2 ? '#fafafa' : '#fff', color: kc ? parseSheetColor(kc.color, '#000000') : '#000', fontWeight: kc && kc.bold ? 700 : 400, fontStyle: (kc && kc.italic) || (r.sub && !kc) ? 'italic' : 'normal', textDecoration: kc && kc.underline ? 'underline' : 'none', borderBottom: '1px solid #8c8c8c', boxSizing: 'border-box' } });
      for (const col of cols) {
        let text = val(r, col);
        if (col.key === 'lp') text = '\u00a0\u00a0\u00a0\u00a0'.repeat(r.depth || 0) + (r.subCount ? (st.collapsed.has(r.id) ? '▸ ' : '▾ ') : r.sub ? '↳ ' : '\u00a0\u00a0\u00a0') + text;   // wcięcie wg poziomu: operacja › suboperacja › subsuboperacja
        const predMissing = col.pred !== undefined && text && !(st.m && st.m.opsByLp[text]);
        const iss = st.issueMap.get(r.id), issLevel = iss && (iss.cols.get(col.key) || (col.key === 'lp' ? iss.level : null));
        const cell = h('div', { title: issLevel ? iss.texts.join('\n') : predMissing ? 'Brak operacji o tym numerze' : col.key === 'start' && !text && r.state === 'no-start' ? 'Brak startu: ustaw start ręcznie albo uzupełnij poprzedników' : col.key === 'key' ? text : '',
          style: { width: colW(col) + 'px', flex: 'none', height: ROW + 'px', lineHeight: ROW - 2 + 'px', padding: '0 3px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: FONT + 'px', borderRight: '1px solid #8c8c8c',
            background: col.ro ? 'rgba(0,0,0,.04)' : predMissing ? '#ffd6d6' : 'transparent', cursor: 'cell',
            ...(col.key === 'station' && text ? { background: parseSheetColor(r.stanowiskoBg, '#cccccc'), color: parseSheetColor(r.stanowiskoColor, '#000000'), fontStyle: 'italic', fontWeight: 700 } : {}),
            ...(issLevel && col.key !== 'lp' ? { background: issLevel === 'error' ? '#ff9b9b' : '#ffe699' } : {}),
            ...(issLevel && col.key === 'lp' ? { boxShadow: `inset 4px 0 0 ${issLevel === 'error' ? '#c00000' : '#e0a800'}` } : {}),
            ...(st.cursor && st.cursor.id === r.id && st.cursor.key === col.key ? { outline: '2px solid #1a73e8', outlineOffset: '-2px' } : {}) } }, text);
        cell.dataset.cid = r.id; cell.dataset.ckey = col.key;
        if (col.key === 'lp' && st.path && st.path.ops.has(r.id)) Object.assign(cell.style, { background: '#ffc7c7', fontWeight: 700 });
        if (col.key === 'lp' && r.subCount && !issLevel) cell.title = 'Kliknij strzałkę, aby zwinąć lub rozwinąć suboperacje';
        // jak w Excelu: klik zaznacza komórkę, dwuklik edytuje (daty – kalendarz, Z1–Z4 – lista), pisanie zaczyna edycję
        cell.addEventListener('click', (ev) => {
          if (col.key === 'lp' && r.subCount && ev.offsetX < (20 + 26 * (r.depth || 0)) * st.scale) { toggleCollapse(r.id); return; }
          setCursor(r.id, col.key, { scroll: false });
        });
        if (!col.ro) cell.addEventListener('dblclick', (ev) => {
          if (col.key === 'lp' && r.subCount && ev.offsetX < (20 + 26 * (r.depth || 0)) * st.scale) return;
          st.cursor = { id: r.id, key: col.key };
          if (col.pred !== undefined || col.date) openPicker(); else beginEdit();
        });
        line.append(cell);
      }
      line.append(h('div', { style: { flex: 1, textAlign: 'center' } }, acc().del ? h('button', { class: 'btn small', style: { padding: '0 4px', lineHeight: ROW - 6 + 'px' }, title: 'Usuń operację', onclick: () => removeOp(st.m.opsByLp, r.id) }, '✕') : null));
      line.addEventListener('mousedown', () => selectRow(r.id));
      line.addEventListener('contextmenu', (e) => { e.preventDefault(); selectRow(r.id); detail(r); });   // właściwości operacji: prawy przycisk myszy
      g.leftRows.append(line);
      const chartRow = h('div', { onclick: () => selectRow(r.id), ondblclick: () => editTree(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, style: { position: 'absolute', left: 0, top: i * ROW + 'px', width: g.chartW + 'px', height: ROW + 'px', cursor: 'pointer', boxSizing: 'border-box' } });   // klik w wiersz wykresu
      g.dyn.append(chartRow); g.rowEls.set(r.id, { line, chart: chartRow, komis: r.komis });
      const bg = done ? ZAK_BAR : barBackground(r, parseSheetColor(r.stanowiskoBg, '#cccccc'));
      const LF = st.chartOpt.font ? st.chartOpt.font * st.scale : FONT;   // czcionka napisów na wykresie
      const tip = [r.komis, r.element, r.stanowisko].filter(Boolean).join(' - ') + `\n${r.start} → ${r.koniec}`;
      const label = chartLabel(r);
      const hoursAt = (ms) => (ms - chart.axisStart.getTime()) / 3600000;
      // każdy pasek wypełniony kolorem stanowiska z czarną ramką; węzeł złożony z dzieci (operacja albo detal) ma jedną czarną ramkę od pierwszego
      // do ostatniego odcinka, a w środku odcinki wszystkich subsuboperacji w kolorach ich stanowisk, oddzielone białymi przerwami (plan i kolejność stanowisk)
      const bar = (left, width, withLabel) => {
        const box = h('div', { title: tip, onclick: () => selectRow(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, ondblclick: () => editTree(r.id), style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: left + 'px', top: i * ROW + 2 + 'px', width: width + 'px', height: ROW - 4 + 'px', border: '1px solid #000', boxSizing: 'border-box', fontSize: LF + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000', background: bg } });
        if (withLabel && label) box.append(h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 4 - LF * 1.25) / 2) + 'px', lineHeight: '1.25', ...(st.chartOpt.komisColor ? { paddingLeft: '10px' } : {}) } }, label));
        g.dyn.append(box);
      };
      if (r.segs && r.segs.length) {
        const lefts = r.segs.map(([s0]) => Math.max(0, hoursAt(s0)) * HOUR), rights = r.segs.map(([, e0]) => Math.max(0, hoursAt(e0)) * HOUR);
        const L = Math.min(...lefts), W = Math.max(2, Math.max(...rights) - L);
        if (Math.max(...rights) > 0) {
          const box = h('div', { title: tip, onclick: () => selectRow(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, ondblclick: () => editTree(r.id), style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: L + 'px', top: i * ROW + 2 + 'px', width: W + 'px', height: ROW - 4 + 'px', border: '1px solid #000', boxSizing: 'border-box', background: '#fff', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000' } });
          r.segs.forEach(([, , color], k) => { const l = lefts[k] - L, w = Math.max(1, rights[k] - lefts[k]); box.append(h('div', { style: { position: 'absolute', left: l - 1 + 'px', top: 0, bottom: 0, width: w + 'px', background: done ? ZAK_BAR : barBackground(r, color), borderRight: '1px solid #fff', boxSizing: 'border-box', pointerEvents: 'none' } })); });
          if (label) box.append(h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 4 - LF * 1.25) / 2) + 'px', lineHeight: '1.25', fontSize: LF + 'px' } }, label));
          g.dyn.append(box);
        }
      } else if (!it.noBar) {
        bar(it.startHours * HOUR, Math.max(2, it.durationHours * HOUR), true);
      }
      if (it.noBar) continue;
      for (const sg of it.delivery) g.dyn.append(h('div', { style: { position: 'absolute', zIndex: 1, pointerEvents: 'none', left: sg.left * HOUR + 'px', top: i * ROW + ROW - Math.max(3, ROW * 0.14) + 'px', width: Math.max(2, sg.width * HOUR) + 'px', height: Math.max(3, ROW * 0.14) + 'px', background: sg.kind === 'green' ? '#00b050' : '#f00' } }));
    }
    for (const d of chart.deps) {
      const a = Math.min(d.from, d.to), b = Math.max(d.from, d.to);
      if (a === b || b < from || a >= to) continue;
      g.dyn.append(h('div', { style: { position: 'absolute', zIndex: 3, pointerEvents: 'none', left: d.x * HOUR + 'px', top: a * ROW + ROW / 2 + 'px', width: 0, height: (b - a) * ROW + 'px', borderLeft: '1px dashed #555' } }));
    }
    drawPath(g, chart);
    applySelection();
  }
  body.addEventListener('scroll', () => requestAnimationFrame(paintWindow));

  // ---------- edycja w komórce ----------
  // [typed] – edycja zaczęta pisaniem (strzałki ↑ ↓ zatwierdzają i przechodzą jak w Excelu); [old] – wartość w bazie (do porównania)
  function startEdit(cell, id, col, text, { typed = false, old = text } = {}) {
    if (st.editing) return;
    st.editing = true;
    const { ROW, FONT } = st.geom;
    const input = h('input', { type: 'text', value: text, spellcheck: 'false', placeholder: col.date ? 'dd.mm.rrrr gg:mm' : '', style: { width: '100%', height: ROW - 2 + 'px', boxSizing: 'border-box', border: '2px solid #1a73e8', padding: '0 3px', fontSize: FONT + 'px' } });
    clear(cell); cell.style.padding = '0'; cell.append(input); input.focus();
    if (typed) input.setSelectionRange(input.value.length, input.value.length); else input.select();
    let done = false;
    const finish = async (commit, move) => {
      if (done) return; done = true;
      if (commit && input.value.trim() !== String(old).trim()) await saveWithConfirm(id, col, old, input.value.trim());
      st.editing = false;
      if (st.pending) { st.pending = false; recompute(); } else paintWindow();
      if (move) moveCursor(...move);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true, [e.shiftKey ? -1 : 1, 0]); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(true, [0, e.shiftKey ? -1 : 1]); }
      else if (typed && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); finish(true, [e.key === 'ArrowDown' ? 1 : -1, 0]); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---------- pasek narzędzi ----------
  const setScale = (v) => { st.scale = Math.max(0.5, Math.min(2.5, Math.round(v * 100) / 100)); if (st.data) draw(); };
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setScale(st.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
  // przesunięcie początku osi względem dziś w dniach (ujemne = przeszłość, dodatnie = przyszłość)
  const setShift = (v) => { const n = Math.round(Number(v)); if (!Number.isFinite(n)) return; st.shift = Math.max(-MAX_SHIFT_DAYS, Math.min(MAX_SHIFT_DAYS, n)); if (st.data) draw(); };
  const shiftInput = h('input', { type: 'number', value: '-3', step: '1', title: 'Początek osi względem dziś [dni]: ujemne = cofnięte (przeszłość), dodatnie = przyszłość. Kliknij: suwak, dni albo data',
    style: { width: '64px', padding: '3px', textAlign: 'center' },
    onchange: () => setShift(shiftInput.value), onkeydown: (e) => { if (e.key === 'Enter') { setShift(shiftInput.value); shiftInput.blur(); } },
    onclick: () => openShiftPopup() });
  // Okienko przesunięcia: suwak (±365 dni), liczba dni albo data początku osi (z kalendarzem); w polu zostaje liczba dni od dziś
  let shiftPopup = null;
  function openShiftPopup() {
    if (shiftPopup) return;
    const DAY = 86400000, now = H.localNow(), today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const fmtD = (ms) => fmtDt(ms).slice(0, 10);
    const range = h('input', { type: 'range', min: -365, max: 365, step: 1, value: st.shift, style: { width: '260px' } });
    const days = h('input', { type: 'number', value: st.shift, step: 1, style: { width: '70px', padding: '3px' } });
    const date = h('input', { type: 'text', value: fmtD(today + st.shift * DAY), placeholder: 'dd.mm.rrrr', style: { width: '100px', padding: '3px' } });
    const label = h('div', { class: 'muted', style: { fontSize: '12px' } });
    let timer = null;
    const apply = (n, from) => {
      n = Math.max(-MAX_SHIFT_DAYS, Math.min(MAX_SHIFT_DAYS, Math.round(n)));
      if (from !== 'range') range.value = String(Math.max(-365, Math.min(365, n)));
      if (from !== 'days') days.value = String(n);
      if (from !== 'date') date.value = fmtD(today + n * DAY);
      label.textContent = n < 0 ? `Cofnięte o ${-n} dni (początek osi: ${fmtD(today + n * DAY)})` : n > 0 ? `Do przodu o ${n} dni (początek osi: ${fmtD(today + n * DAY)})` : 'Początek osi: dziś';
      shiftInput.value = String(n);
      clearTimeout(timer); timer = setTimeout(() => setShift(n), 120);   // rysowanie z opóźnieniem – płynny suwak
    };
    range.addEventListener('input', () => apply(+range.value, 'range'));
    days.addEventListener('input', () => { if (days.value.trim() !== '' && Number.isFinite(+days.value)) apply(+days.value, 'days'); });
    const fromDate = () => { const d = parseDateTime(date.value.trim()); if (d != null) apply((Math.floor(d / DAY) * DAY - today) / DAY, 'date'); };
    date.addEventListener('change', fromDate); date.addEventListener('keydown', (e) => { if (e.key === 'Enter') fromDate(); });
    const close = () => { if (!shiftPopup) return; shiftPopup.remove(); shiftPopup = null; document.removeEventListener('mousedown', outside, true); };
    const outside = (e) => { if (shiftPopup && !shiftPopup.contains(e.target) && e.target !== shiftInput && !e.target.closest('.overlay')) close(); };
    const r = shiftInput.getBoundingClientRect();
    shiftPopup = h('div', { style: { position: 'fixed', left: Math.max(8, r.left) + 'px', top: r.bottom + 4 + 'px', zIndex: 60, background: '#fff', border: '1px solid #999', boxShadow: '0 4px 14px rgba(0,0,0,.25)', padding: '10px', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('b', {}, 'Przesunięcie harmonogramu'),
      h('div', { class: 'row', style: { alignItems: 'center', gap: '6px' } }, h('span', { style: { fontSize: '12px' } }, '−365'), range, h('span', { style: { fontSize: '12px' } }, '+365')),
      h('div', { class: 'row', style: { alignItems: 'center', gap: '6px' } }, 'Dni: ', days, h('span', { style: { marginLeft: '10px' } }, 'albo data: '), date, calendarButton(date, { title: 'Początek osi – kalendarz', holidays: holidayMap(st.m && st.m.cfg && st.m.cfg.holidays) })),
      label,
      h('div', { class: 'row', style: { gap: '6px' } }, ...[[-7, '−7'], [-3, '−3'], [0, 'Dziś'], [7, '+7']].map(([v, t]) => h('button', { class: 'btn small', onclick: () => apply(v) }, t)), h('span', { class: 'grow' }), h('button', { class: 'btn small primary', onclick: close }, 'Zamknij')));
    document.body.append(shiftPopup);
    document.addEventListener('mousedown', outside, true);
    apply(st.shift);
  }
  const intervalSel = h('select', { title: 'Interwał osi czasu: długość jednej kolumny', onchange: () => { st.interval = intervalOf(intervalSel.value).id; lsSet(LS.interval, st.interval); if (st.data) draw(); } },
    ...INTERVALS.map((i) => h('option', { value: i.id }, i.label)));
  intervalSel.value = st.interval;
  // poziomy III, II, I: przycisk wciśnięty = poziom widoczny; kliknięcie chowa albo pokazuje wszystkie wiersze tego poziomu
  const LEVEL_TIPS = { 3: 'III – najwyższy poziom: operacje zbierające wszystkie poziomy niższe', 2: 'II – poziom pośredni: zbiera informacje z poziomu I', 1: 'I – najniższy, najważniejszy poziom: operacje wykonywane na stanowiskach' };
  const levelBtns = new Map([3, 2, 1].map((lvl) => [lvl, h('button', { class: 'btn small primary', style: { minWidth: '36px', fontWeight: 700 }, title: LEVEL_TIPS[lvl] + ' (kliknij, aby ukryć albo pokazać)',
    onclick: () => { if (st.hiddenLevels.has(lvl)) st.hiddenLevels.delete(lvl); else st.hiddenLevels.add(lvl); if (st.data) draw(); } }, ['', 'I', 'II', 'III'][lvl])]));
  // Przyciski z ikonami (te same co na Androidzie): kwadrat z ramką, wypełniony = włączone
  const ICON_BTN = { width: '30px', height: '30px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' };
  const iconBtn = (icon, title, onclick) => { const b = h('button', { class: 'btn small', title, 'aria-label': title, style: ICON_BTN, onclick }); b.append(iconSvg(icon)); return b; };
  const setIcon = (b, icon) => { b.replaceChildren(iconSvg(icon)); };
  const komisBtn = iconBtn('sigma', 'Podsumowanie komisów – paski komisów (tylko informacja, nie wpływają na harmonogram). Położenie i filtrowanie: Ustawienia', () => { st.komisOpt.show = !st.komisOpt.show; lsSet(LS.komis, st.komisOpt); if (st.data) draw(); });
  const hideBtn = iconBtn('eye', 'Ukryj dane. Prawy przycisk myszy: co pokazywać', () => { st.compact = !st.compact; lsSet(LS.mode, st.compact); if (st.data) draw(); });
  hideBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); hideDialog(); });   // prawy przycisk na oku: wybór kolumn widocznych przy ukrytych danych
  const broomBtn = iconBtn('broom', 'Wyczyść filtry i sortowanie', () => { st.filters = {}; st.sorts = []; saveFilters(); if (st.data) draw(); });
  const addBtn = iconBtn('plus', 'Dodaj operację', () => st.m && acc().add && addDialog(st.m.opsByLp, stationList(st.m.cfg), null, (lp) => treeEditor({ getOps: () => st.m.opsByLp, newLp: lp, stations: stationList(st.m.cfg), access: acc() })));
  const shareBtn = iconBtn('share', 'Udostępnij – JPG, obraz do schowka, Excel, PDF albo wydruk', openShare);
  const gearBtn = iconBtn('gear', 'Ustawienia – wygląd tabeli, potwierdzanie zmian, wykres, podsumowanie komisów, stanowiska, komisy, święta', stationsDialog);
  const refreshBtn = iconBtn('refresh', 'Odśwież', load);
  const undoBtn = iconBtn('undo', 'Cofnij ostatnią zmianę (Ctrl+Z)', doUndo);
  onUndoChange((n, label) => { undoBtn.disabled = !n; undoBtn.title = n ? `Cofnij: ${label} (Ctrl+Z)` : 'Nie ma zmian do cofnięcia'; });
  const onKey = (e) => {
    if (!el.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (acc().edit && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) && !document.querySelector('.overlay')) { e.preventDefault(); doUndo(); }
  };
  document.addEventListener('keydown', onKey);
  for (const b of levelBtns.values()) Object.assign(b.style, ICON_BTN);
  shiftInput.style.width = '52px'; shiftInput.style.height = '30px'; shiftInput.style.boxSizing = 'border-box';
  intervalSel.style.height = '30px';
  // stan przycisków (oko / oko przekreślone, Σ / Σ przekreślona, miotełka nieaktywna bez filtrów) – odświeżany w draw()
  syncTools = () => {
    setIcon(hideBtn, st.compact ? 'eyeOff' : 'eye'); hideBtn.classList.toggle('primary', st.compact); hideBtn.title = (st.compact ? 'Pokaż dane – wszystkie kolumny' : 'Ukryj dane – zostają tylko kolumny wybrane do pokazywania') + '. Prawy przycisk myszy: co pokazywać';
    setIcon(komisBtn, st.komisOpt.show ? 'sigma' : 'sigmaOff'); komisBtn.classList.toggle('primary', st.komisOpt.show);
    broomBtn.disabled = !(Object.keys(st.filters).length || st.sorts.length);
    const a = acc();
    addBtn.style.display = a.add ? 'inline-flex' : 'none'; undoBtn.style.display = a.edit ? 'inline-flex' : 'none';
    levelTag.textContent = a.label; levelTag.title = `Twój poziom dostępu do Harmonogramu: ${a.label} – ${LEVEL_INFO[a.level]}. Ustawia go administrator w zakładce Uzytkownicy (kolumna „Harmonogram”).`;
  };
  const LEVEL_INFO = { god: 'przeglądanie, dodawanie, edycja, usuwanie, kolory i czcionki, stanowiska, komisy, święta', master: 'przeglądanie, dodawanie, edycja', clerik: 'przeglądanie, dodawanie', tourist: 'przeglądanie', none: 'brak dostępu' };
  const levelTag = h('span', { class: 'muted', style: { fontSize: '11px', fontWeight: 700, padding: '0 4px', border: '1px solid #bbb', borderRadius: '3px', lineHeight: '18px' } });
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '4px';
  el.append(h('div', { class: 'row panel', style: { flexWrap: 'wrap', gap: '4px', alignItems: 'center' } },
    ...levelBtns.values(), komisBtn, shiftInput, intervalSel,
    h('span', { class: 'grow' }),
    h('span', { style: { display: 'inline-flex', gap: '3px', alignItems: 'center' } }, issuesBtn, levelTag, undoBtn, hideBtn, broomBtn, addBtn, shareBtn, gearBtn, refreshBtn)), pathBar, body);
  syncTools(); syncIssues();
  load();
}
