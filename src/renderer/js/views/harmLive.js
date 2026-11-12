// Harmonogram (baza Firebase): widok klasyczny jak w arkuszu. Jedna tabela: z lewej dane (kolumny jak w pliku), z prawej oś czasu z paskami w tych samych wierszach.
// Dane twarde edytujesz w komórkach; Start, Koniec i klucz liczy program. Przycisk „Ukryj dane” chowa kolumny z listy ukrywanych (domyślnie „czerwone”).
import { h, clear, api, apiCached, modal, toast, columnFilterDialog, confirmBox } from '../ui.js';
import { datePickerDialog, calendarButton } from './datePicker.js';
import * as H from '../logic/harm.js';
import { visibleRows, filterOptions, sortRows, rangeFilter, isRangeFilter } from '../logic/tableFilter.js';
import { buildHarmData, parseGrafik, daysByKeyOf, stationList, DEFAULT_STATIONS, fmtDt, arrangeRows, subParent, subOps, reorderIds, reorderPlan, withKomisRows, isKomisId, KOMIS_PREFIX } from '../logic/harmModel.js';
import { watchHarm, saveSettings, setOpsSource, undoLast, onUndoChange } from '../harmStore.js';
import { COLS, saveCell, removeOp, addDialog, predPicker } from './harmEdit.js';
import { treeEditor } from './harmTreeEditor.js';
import { iconSvg } from './harmIcons.js';
import { parseSheetColor } from '../logic/common.js';
import { INTERVALS, DEFAULT_INTERVAL, intervalOf, axisStartMs, buildCells, holidayMap, sampleLabel, MAX_SHIFT_DAYS } from '../logic/harmAxis.js';
import { parseDateTime } from '../logic/harmImport.js';
import { dayOf, daySlots, grafikPeople, matchOperators, shiftWindows, operatorSegments, uncoveredSegments, dayTasks } from '../logic/harmDay.js';
import { shareDialog } from './harmShare.js';

const BASE = { hour: 0.75, row: 26, font: 12 };
const DEFAULT_LAYOUT = { rowH: 26, dateW: 104 };   // dateW dopasowana do „dd.mm.rrrr hh”
const DEFAULT_KEEP = new Set(['lp', 'start', 'koniec', 'station']);   // kolumny, które zostają po „Ukryj dane”
const LS = { confirm: 'zks.harm.confirmChanges', filters: 'zks.harm.filters', komis: 'zks.harm.komisSummary', hide: 'zks.harm.hideSet', mode: 'zks.harm.hideMode', layout: 'zks.harm.layout', interval: 'zks.harm.interval' };
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
    confirmChanges: lsGet(LS.confirm, true) !== false,   // okno potwierdzenia przed zapisem zmiany komórki
    collapsed: new Set(), hiddenLevels: new Set(), selected: null, rows: [], chart: null, geom: null, layout: { ...DEFAULT_LAYOUT, ...lsGet(LS.layout, {}) },
  };
  const saveFilters = () => lsSet(LS.filters, { filters: Object.fromEntries(Object.entries(st.filters).map(([k, v]) => [k, isRangeFilter(v) ? { range: true, from: v.from, to: v.to } : [...v]])), sorts: st.sorts });
  let syncTools = () => {};
  setOpsSource(() => (st.m ? st.m.opsByLp : {}));   // stan sprzed zmiany – do cofania
  // Zmiana komórki: informacja o zmianie i potwierdzenie (można wyłączyć w Ustawieniach), potem zapis; po zapisie można cofnąć (↶, Ctrl+Z)
  const saveWithConfirm = async (id, col, oldText, newText) => {
    if (String(oldText ?? '').trim() === String(newText ?? '').trim()) return false;
    const lp = id;
    if (st.confirmChanges && !(await confirmBox('Potwierdź zmianę', `Operacja ${lp}\n${col.title}:  „${String(oldText || '').trim() || '—'}”  →  „${String(newText || '').trim() || '—'}”\n\nZapisać zmianę?`, 'Zapisz'))) return false;
    const ok = await saveCell(st.m.opsByLp, id, col, String(newText ?? '').trim());
    if (ok) toast(`Zapisano: ${col.title} operacji ${lp}. Cofnij: ↶ albo Ctrl+Z`);
    return ok;
  };
  const doUndo = async () => {
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
  const shownCols = () => COLS.filter((c) => !(st.compact && st.hideSet.has(c.key)));

  // ---------- dane: baza + grafik z arkusza ----------
  let stop = null, grJson = '', grTimer = null;
  const recompute = () => {
    if (!st.m) return;
    st.data = buildHarmData(st.m.opsByLp, st.days || {}, st.m.cfg, H.localNow().getTime());
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
      loadGrafik();
      stop = await watchHarm((m) => { st.m = m; recompute(); },
        (e) => { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy: ' + (e.code || '') + ' ' + (e.message || e))); });
    } catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: load }, 'Ponów'))); }
  }
  // ---------- filtry / kolumny ----------
  const sortLabel = (key) => { const i = st.sorts.findIndex((s) => s.key === key); return i < 0 ? '' : (st.sorts[i].ascending ? '↑' : '↓') + (st.sorts.length > 1 ? i + 1 : ''); };
  function openFilter(c) {
    const cur = st.sorts.find((s) => s.key === c.key);
    columnFilterDialog({
      title: c.title, options: filterOptions(st.komisOpt.show && st.komisOpt.filter ? [...st.data.rows, ...st.data.komisRows.values()] : st.data.rows, COLS, st.filters, val, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null, dateRange: !!c.isDate,
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
      const cb = h('input', { type: 'checkbox', checked: keys.every((k) => st.hideSet.has(k)) });
      boxes.set(keys, cb);
      return h('label', { style: { display: 'block', margin: '3px 0' } }, cb, ' ', c.group === 'z' ? 'Zależności Z1–Z4 (B–E)' : `${c.title} (${c.letter})`);
    }));
    const apply = () => { st.hideSet = new Set(); for (const [keys, cb] of boxes) if (cb.checked) keys.forEach((k) => st.hideSet.add(k)); lsSet(LS.hide, [...st.hideSet]); m.close(); draw(); };
    const m = modal('Które dane ukrywać', h('div', {}, h('p', { class: 'muted' }, 'Zaznaczone kolumny znikają po kliknięciu „Ukryj dane”. Odznaczone zostają na ekranie. Zależności Z1–Z4 działają jako grupa.'), list,
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
  const selectRow = (id) => { st.selected = id; applySelection(); };

  // Zmiana kolejności dzieci (przeciągnij i upuść): operacja główna – suboperacje i subsuboperacje, suboperacja – jej subsuboperacje.
  // Przeciągać można tylko w obrębie jednego rodzica; litery się zamieniają, a powiązania (także z innych operacji) poprawiają się same.
  // Edytor gałęzi (dwuklik na operacji albo „Edycja gałęzi…” we właściwościach): numery, opisy, stanowiska, czasy, zależności, kolejność,
  // dodawanie i usuwanie suboperacji, notatnik i plik .txt – views/harmTreeEditor.js
  const editTree = (rootId) => { if (st.m) treeEditor({ getOps: () => st.m.opsByLp, rootId, stations: stationList(st.m.cfg) }); };


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
        const label = [r.komis, r.element, r.godziny].filter((v) => String(v).trim()).join(' - ');
        if (r.segs && r.segs.length) return { label, frame: { start: Math.min(...r.segs.map((x) => x[0])), end: Math.max(...r.segs.map((x) => x[1])) }, bars: r.segs.map(([s0, e0, c]) => ({ start: s0, end: e0, color: done ? ZAK_BAR : c })) };
        const rr = res.get(r.id);
        return { label, frame: null, bars: rr && rr.start != null && rr.end != null ? [{ start: rr.start, end: rr.end, color: done ? ZAK_BAR : stationBg(r) }] : [] };
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
      h('button', { class: 'btn', title: 'Edycja operacji z suboperacjami jako drzewo: numery, opisy, kolejność, nowe suboperacje, notatnik, plik .txt', onclick: () => { m.close(); editTree(r.id); } }, 'Edycja gałęzi…'),
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
        await saveSettings(list, komisList, holidays); m.close(); toast('Zapisano ustawienia'); if (st.data) draw();
      } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
    };
    const m = modal('Ustawienia harmonogramu', h('div', {},
      h('h3', { style: { margin: '4px 0' } }, 'Wygląd tabeli'),
      h('div', { class: 'row', style: { alignItems: 'center' } }, 'Wysokość wiersza operacji [px]', rowHI, ' Szerokość kolumn dat [px]', dateWI, h('button', { class: 'btn small', onclick: () => { rowHI.value = String(DEFAULT_LAYOUT.rowH); dateWI.value = String(DEFAULT_LAYOUT.dateW); } }, 'Domyślne')),
      h('p', { class: 'muted' }, 'Zapisywane na tym komputerze. Domyślnie szerokość pasuje do daty „dd.mm.rrrr hh”.'),
      h('div', { class: 'row', style: { alignItems: 'center' } }, h('button', { class: 'btn small', title: 'Lista kolumn chowanych ikoną oka (zapisuje się od razu)', onclick: hideDialog }, 'Które dane ukrywać…'), h('span', { class: 'muted' }, 'kolumny chowane ikoną oka na pasku')),
      h('label', { style: { display: 'block', margin: '6px 0' } }, h('input', { type: 'checkbox', checked: st.confirmChanges, onchange: (e) => { st.confirmChanges = e.target.checked; lsSet(LS.confirm, st.confirmChanges); } }), ' Potwierdzaj zmiany komórek (okno ze starą i nową wartością przed zapisem)'),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Podsumowanie komisów'),
      h('p', { class: 'muted' }, 'Pasek komisu zbiera wszystkie operacje komisu (terminy, godziny, postęp, wysyłka). Tylko informacja – nie wpływa na harmonogram. Zapisywane na tym komputerze.'),
      kCheck('show', 'Pokazuj paski podsumowania komisów'),
      kCheck('inline', 'Przypasuj pasek do pierwszego wystąpienia komisu (zamiast wszystkich na górze tabeli)'),
      kCheck('filter', 'Filtruj i sortuj także paski podsumowania (wg filtrów i sortowania kolumn)', 'Bez zaznaczenia paski są zawsze widoczne i ułożone wg pierwszego wystąpienia komisu'),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Stanowiska'),
      h('p', { class: 'muted' }, 'Kolor stanowiska widać w kolumnie „Stan.” i na paskach wykresu. Nowe stanowisko ma też kolumny z miejscami pracy w karcie graf_norm (np. „4Fr1”); bez nich program nie wyliczy końca jego operacji.'),
      box, h('div', { class: 'row', style: { marginTop: '8px' } }, nameI, addBtn),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Kolory komisów'), h('p', { class: 'muted' }, 'Wiersze operacji danego komisu są podświetlone wybranym kolorem w tabeli. Nazwę komisu można poprawić w polu.'),
      kBox, h('div', { class: 'row', style: { marginTop: '8px' } }, komisI, komisHints, kAdd),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Dni świąteczne'), h('p', { class: 'muted' }, 'Święta są w nagłówku osi czasu bordowe, z białą pogrubioną czcionką, a ich tło na wykresie jest białe jak w weekend.'),
      hBox, h('div', { class: 'row', style: { marginTop: '8px' } }, hAdd),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: save }, 'Zapisz'))));
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
        const cell = h('div', { title: predMissing ? 'Brak operacji o tym numerze' : col.key === 'start' && !text && r.state === 'no-start' ? 'Brak startu: ustaw start ręcznie albo uzupełnij poprzedników' : col.key === 'key' ? text : '',
          style: { width: colW(col) + 'px', flex: 'none', height: ROW + 'px', lineHeight: ROW - 2 + 'px', padding: '0 3px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: FONT + 'px', borderRight: '1px solid #8c8c8c',
            background: col.ro ? 'rgba(0,0,0,.04)' : predMissing ? '#ffd6d6' : 'transparent', cursor: col.ro ? 'default' : 'text',
            ...(col.key === 'station' && text ? { background: parseSheetColor(r.stanowiskoBg, '#cccccc'), color: parseSheetColor(r.stanowiskoColor, '#000000'), fontStyle: 'italic', fontWeight: 700 } : {}) } }, text);
        if (col.key === 'lp' && r.subCount) cell.title = 'Kliknij strzałkę, aby zwinąć lub rozwinąć suboperacje; resztę komórki, aby zmienić numer';
        if (!col.ro) cell.addEventListener('click', (ev) => {
          if (col.key === 'lp' && r.subCount && ev.offsetX < (20 + 26 * (r.depth || 0)) * st.scale) { toggleCollapse(r.id); return; }
          if (col.pred !== undefined) {
            predPicker(st.m.opsByLp, r.id, col.pred, (lp) => saveWithConfirm(r.id, col, text, lp));
            return;
          }
          const op = st.m.opsByLp[r.id] || {};
          if (col.date) {   // komórka z datą: okno z kalendarzem
            datePickerDialog({ title: `${col.title} · operacja ${r.lp || r.id}`, value: op[col.key] ?? null, holidays: holidayMap(st.m.cfg && st.m.cfg.holidays),
              onPick: (ms) => saveWithConfirm(r.id, col, fmtDt(op[col.key]), ms == null ? '' : fmtDt(ms)) });
            return;
          }
          const initial = col.key === 'lp' ? r.lp : col.date ? fmtDt(op[col.key]) : col.key === 'hours' ? (op.hours == null ? '' : String(op.hours)) : text;
          startEdit(cell, r.id, col, initial);
        });
        line.append(cell);
      }
      line.append(h('div', { style: { flex: 1, textAlign: 'center' } }, h('button', { class: 'btn small', style: { padding: '0 4px', lineHeight: ROW - 6 + 'px' }, title: 'Usuń operację', onclick: () => removeOp(st.m.opsByLp, r.id) }, '✕')));
      line.addEventListener('mousedown', () => selectRow(r.id));
      line.addEventListener('contextmenu', (e) => { e.preventDefault(); selectRow(r.id); detail(r); });   // właściwości operacji: prawy przycisk myszy
      g.leftRows.append(line);
      const chartRow = h('div', { onclick: () => selectRow(r.id), ondblclick: () => editTree(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, style: { position: 'absolute', left: 0, top: i * ROW + 'px', width: g.chartW + 'px', height: ROW + 'px', cursor: 'pointer', boxSizing: 'border-box' } });   // klik w wiersz wykresu
      g.dyn.append(chartRow); g.rowEls.set(r.id, { line, chart: chartRow, komis: r.komis });
      const bg = done ? ZAK_BAR : parseSheetColor(r.stanowiskoBg, '#cccccc');
      const tip = [r.komis, r.element, r.stanowisko].filter(Boolean).join(' - ') + `\n${r.start} → ${r.koniec}`;
      const label = [r.komis, r.element, r.godziny].filter((v) => String(v).trim()).join(' - ');
      const hoursAt = (ms) => (ms - chart.axisStart.getTime()) / 3600000;
      // każdy pasek wypełniony kolorem stanowiska z czarną ramką; węzeł złożony z dzieci (operacja albo detal) ma jedną czarną ramkę od pierwszego
      // do ostatniego odcinka, a w środku odcinki wszystkich subsuboperacji w kolorach ich stanowisk, oddzielone białymi przerwami (plan i kolejność stanowisk)
      const bar = (left, width, withLabel) => {
        const box = h('div', { title: tip, onclick: () => selectRow(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, ondblclick: () => editTree(r.id), style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: left + 'px', top: i * ROW + 2 + 'px', width: width + 'px', height: ROW - 4 + 'px', border: '1px solid #000', boxSizing: 'border-box', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000', background: bg } });
        if (withLabel && label) box.append(h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 4 - FONT * 1.25) / 2) + 'px', lineHeight: '1.25' } }, label));
        g.dyn.append(box);
      };
      if (r.segs && r.segs.length) {
        const lefts = r.segs.map(([s0]) => Math.max(0, hoursAt(s0)) * HOUR), rights = r.segs.map(([, e0]) => Math.max(0, hoursAt(e0)) * HOUR);
        const L = Math.min(...lefts), W = Math.max(2, Math.max(...rights) - L);
        if (Math.max(...rights) > 0) {
          const box = h('div', { title: tip, onclick: () => selectRow(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, ondblclick: () => editTree(r.id), style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: L + 'px', top: i * ROW + 2 + 'px', width: W + 'px', height: ROW - 4 + 'px', border: '1px solid #000', boxSizing: 'border-box', background: '#fff', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000' } });
          r.segs.forEach(([, , color], k) => { const l = lefts[k] - L, w = Math.max(1, rights[k] - lefts[k]); box.append(h('div', { style: { position: 'absolute', left: l - 1 + 'px', top: 0, bottom: 0, width: w + 'px', background: done ? ZAK_BAR : color, borderRight: '1px solid #fff', boxSizing: 'border-box', pointerEvents: 'none' } })); });
          if (label) box.append(h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 4 - FONT * 1.25) / 2) + 'px', lineHeight: '1.25' } }, label));
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
    applySelection();
  }
  body.addEventListener('scroll', () => requestAnimationFrame(paintWindow));

  // ---------- edycja w komórce ----------
  function startEdit(cell, id, col, text) {
    if (st.editing) return;
    st.editing = true;
    const { ROW, FONT } = st.geom;
    const input = h('input', { type: 'text', value: text, spellcheck: 'false', style: { width: '100%', height: ROW - 2 + 'px', boxSizing: 'border-box', border: '2px solid #1a73e8', padding: '0 3px', fontSize: FONT + 'px' } });
    clear(cell); cell.style.padding = '0'; cell.append(input); input.focus(); input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      if (commit && input.value.trim() !== text.trim()) await saveWithConfirm(id, col, text, input.value.trim());
      st.editing = false;
      if (st.pending) { st.pending = false; recompute(); } else paintWindow();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---------- pasek narzędzi ----------
  const setScale = (v) => { st.scale = Math.max(0.5, Math.min(2.5, Math.round(v * 100) / 100)); if (st.data) draw(); };
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setScale(st.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
  // przesunięcie początku osi względem dziś w dniach (ujemne = przeszłość, dodatnie = przyszłość)
  const setShift = (v) => { const n = Math.round(Number(v)); if (!Number.isFinite(n)) return; st.shift = Math.max(-MAX_SHIFT_DAYS, Math.min(MAX_SHIFT_DAYS, n)); if (st.data) draw(); };
  const shiftInput = h('input', { type: 'number', value: '-3', step: '1', title: 'Początek osi względem dziś [dni]: ujemne = przeszłość, dodatnie = przyszłość', style: { width: '64px', padding: '3px', textAlign: 'center' },
    onchange: () => setShift(shiftInput.value), onkeydown: (e) => { if (e.key === 'Enter') { setShift(shiftInput.value); shiftInput.blur(); } } });
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
  const hideBtn = iconBtn('eye', 'Ukryj dane – chowa kolumny z listy „Które dane ukrywać” (Ustawienia)', () => { st.compact = !st.compact; lsSet(LS.mode, st.compact); if (st.data) draw(); });
  const broomBtn = iconBtn('broom', 'Wyczyść filtry i sortowanie', () => { st.filters = {}; st.sorts = []; saveFilters(); if (st.data) draw(); });
  const addBtn = iconBtn('plus', 'Dodaj operację', () => st.m && addDialog(st.m.opsByLp, stationList(st.m.cfg), null, (lp) => treeEditor({ getOps: () => st.m.opsByLp, newLp: lp, stations: stationList(st.m.cfg) })));
  const shareBtn = iconBtn('share', 'Udostępnij – JPG, obraz do schowka, Excel, PDF albo wydruk', openShare);
  const gearBtn = iconBtn('gear', 'Ustawienia – wygląd tabeli, które dane ukrywać, podsumowanie komisów, stanowiska, komisy, święta', stationsDialog);
  const refreshBtn = iconBtn('refresh', 'Odśwież', load);
  const undoBtn = iconBtn('undo', 'Cofnij ostatnią zmianę (Ctrl+Z)', doUndo);
  onUndoChange((n, label) => { undoBtn.disabled = !n; undoBtn.title = n ? `Cofnij: ${label} (Ctrl+Z)` : 'Nie ma zmian do cofnięcia'; });
  const onKey = (e) => {
    if (!el.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) && !document.querySelector('.overlay')) { e.preventDefault(); doUndo(); }
  };
  document.addEventListener('keydown', onKey);
  for (const b of levelBtns.values()) Object.assign(b.style, ICON_BTN);
  shiftInput.style.width = '52px'; shiftInput.style.height = '30px'; shiftInput.style.boxSizing = 'border-box';
  intervalSel.style.height = '30px';
  // stan przycisków (oko / oko przekreślone, Σ / Σ przekreślona, miotełka nieaktywna bez filtrów) – odświeżany w draw()
  syncTools = () => {
    setIcon(hideBtn, st.compact ? 'eyeOff' : 'eye'); hideBtn.classList.toggle('primary', st.compact); hideBtn.title = st.compact ? 'Pokaż dane – wszystkie kolumny' : 'Ukryj dane – chowa kolumny z listy „Które dane ukrywać” (Ustawienia)';
    setIcon(komisBtn, st.komisOpt.show ? 'sigma' : 'sigmaOff'); komisBtn.classList.toggle('primary', st.komisOpt.show);
    broomBtn.disabled = !(Object.keys(st.filters).length || st.sorts.length);
  };
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '4px';
  el.append(h('div', { class: 'row panel', style: { flexWrap: 'wrap', gap: '4px', alignItems: 'center' } },
    ...levelBtns.values(), komisBtn, shiftInput, intervalSel,
    h('span', { class: 'grow' }),
    h('span', { style: { display: 'inline-flex', gap: '3px' } }, undoBtn, hideBtn, broomBtn, addBtn, shareBtn, gearBtn, refreshBtn)), body);
  syncTools();
  load();
}
