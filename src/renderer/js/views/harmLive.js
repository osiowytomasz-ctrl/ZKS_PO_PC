// Harmonogram (Firebase): widok klasyczny jak w arkuszu. Jedna tabela: z lewej dane (kolumny jak w pliku), z prawej oś czasu z paskami w tych samych wierszach.
// Dane twarde edytujesz w komórkach; Start, Koniec i klucz liczy program. Przycisk „Ukryj dane” chowa kolumny z listy ukrywanych (domyślnie „czerwone”).
import { h, clear, api, apiCached, modal, toast, columnFilterDialog } from '../ui.js';
import * as H from '../logic/harm.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { buildHarmData, parseGrafik, daysByKeyOf, stationList, DEFAULT_STATIONS, fmtDt, arrangeRows } from '../logic/harmModel.js';
import { opsFromSheetRows } from '../logic/harmImport.js';
import { watchHarm, importOps, saveSettings } from '../harmStore.js';
import { COLS, saveCell, removeOp, addDialog, predPicker } from './harmEdit.js';
import { parseSheetColor } from '../logic/common.js';

const BASE = { hour: 0.75, row: 26, font: 12 };
const DEFAULT_LAYOUT = { rowH: 26, dateW: 104 };   // dateW dopasowana do „dd.mm.rrrr hh”
const DEFAULT_KEEP = new Set(['lp', 'start', 'koniec', 'station']);   // kolumny, które zostają po „Ukryj dane”
const LS = { hide: 'zks.harm.hideSet', mode: 'zks.harm.hideMode', layout: 'zks.harm.layout', collapsed: 'zks.harm.collapsed' };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* brak pamięci przeglądarki */ } };
const ZAK_BAR = '#93c47d';

export function mountHarmLive(el) {
  const st = {
    m: null, days: null, data: null, filters: {}, sorts: [], daysBack: 3, scale: 1, editing: false, pending: false,
    hideSet: new Set(lsGet(LS.hide, COLS.filter((c) => !DEFAULT_KEEP.has(c.key)).map((c) => c.key))), compact: !!lsGet(LS.mode, false),
    collapsed: new Set(lsGet(LS.collapsed, [])), rows: [], chart: null, geom: null, layout: { ...DEFAULT_LAYOUT, ...lsGet(LS.layout, {}) },
  };
  const body = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0, minWidth: 0, position: 'relative', overflow: 'auto' } });
  const info = h('span', { class: 'muted' });
  const noMin = (t) => String(t ?? '').replace(/^(\d{2}\.\d{2}\.\d{4} \d{2}):\d{2}$/, '$1');   // wyświetlanie „dd.mm.rrrr hh” (bez minut)
  const val = (row, col) => (col.isDate ? noMin(row[col.key]) : col.key === 'hours' ? String(row.hoursShown ?? '') : String(row[col.key] ?? ''));
  let measureCtx = null;
  const textW = (text, font, bold) => { try { measureCtx = measureCtx || document.createElement('canvas').getContext('2d'); measureCtx.font = `${bold ? 'bold ' : ''}${font}px ${getComputedStyle(document.body).fontFamily}`; return measureCtx.measureText(text).width; } catch { return text.length * font * 0.6; } };
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
  const importSheet = async () => {
    try {
      toast('Pobieranie z arkusza…');
      const d = await api('getHarmData', ['fresh'], { timeoutMs: 180000 });
      const r = opsFromSheetRows(d.rows);
      if (!r.operations.length) { toast(r.warnings[0] || 'Brak operacji'); return; }
      const ok = window.confirm(`Zaimportować ${r.operations.length} operacji z arkusza? Obecne operacje w bazie zostaną ZASTĄPIONE.` + (r.warnings.length ? `\n\nOstrzeżeń: ${r.warnings.length}\n` + r.warnings.slice(0, 5).join('\n') : ''));
      if (!ok) return;
      const x = await importOps(r.operations);
      toast(`Zaimportowano ${x.operations} operacji`);
    } catch (e) { toast('Błąd importu: ' + (e.code || e.message)); }
  };

  // ---------- filtry / kolumny ----------
  const sortLabel = (key) => { const i = st.sorts.findIndex((s) => s.key === key); return i < 0 ? '' : (st.sorts[i].ascending ? '↑' : '↓') + (st.sorts.length > 1 ? i + 1 : ''); };
  function openFilter(c) {
    const cur = st.sorts.find((s) => s.key === c.key);
    columnFilterDialog({
      title: c.title, options: filterOptions(st.data.rows, COLS, st.filters, val, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null,
      onApply: (filter, sort) => {
        if (filter) st.filters[c.key] = filter; else delete st.filters[c.key];
        st.sorts = st.sorts.filter((s) => s.key !== c.key); if (sort !== null) st.sorts.unshift({ key: c.key, ascending: sort });
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

  // Szczegóły operacji (po kliknięciu paska albo wiersza wykresu)
  function detail(r) {
    const subs = st.data ? st.data.rows.filter((x) => x.parent === r.id) : [];
    const line = (k, v) => (String(v ?? '').trim() ? h('div', { class: 'row', style: { margin: '2px 0' } }, h('b', { style: { width: '150px' } }, k), h('span', {}, v)) : null);
    const body = [
      line('Komis', r.komis), line('Klient', r.client), line('Element', r.element), line('Stanowisko', r.stanowisko),
      line('Start', r.start), line('Koniec', r.koniec), line('Godziny', r.hoursShown || r.godziny), line('Dostawa', r.dostawa), line('Zakończenie / wysyłka', r.wysylka),
      line('Start ręczny', r.startManual), line('Koniec ręczny', r.endManual), line('Status', r.status),
      line('Lp / poprzedzające', [r.lp, r.z1, r.z2, r.z3, r.z4].filter(Boolean).join(' / ')),
      r.sub ? line('Operacja główna', r.parent) : null,
      subs.length ? h('div', { style: { marginTop: '6px' } }, h('b', {}, `Suboperacje (${subs.length}):`), ...subs.map((x) => h('div', { style: { margin: '2px 0 2px 12px' } }, `${x.lp}  ·  ${x.start || '—'} → ${x.koniec || '—'}  ·  ${x.hours ? x.hours + ' h' : ''}${x.element ? '  ·  ' + x.element : ''}`))) : null,
    ].filter(Boolean);
    const m = modal('Operacja', h('div', {}, ...body, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))));
  }

  const saveCollapsed = () => lsSet(LS.collapsed, [...st.collapsed]);
  const toggleCollapse = (id) => { if (st.collapsed.has(id)) st.collapsed.delete(id); else st.collapsed.add(id); saveCollapsed(); draw(); };
  const setAllCollapsed = (on) => {
    st.collapsed = new Set(on ? (st.data ? st.data.rows.filter((r) => r.subCount > 0).map((r) => r.id) : []) : []);
    saveCollapsed(); if (st.data) draw();
  };

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
        const sample = h('span', { style: { display: 'inline-block', minWidth: '84px', textAlign: 'center', padding: '2px 6px', background: r.bg, color: r.color, ...styleOf() } }, r.komis);
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
      try {
        const clamp = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
        st.layout = { rowH: clamp(rowHI.value, 16, 80, DEFAULT_LAYOUT.rowH), dateW: clamp(dateWI.value, 60, 220, DEFAULT_LAYOUT.dateW) }; lsSet(LS.layout, st.layout);
        await saveSettings(list, kRows); m.close(); toast('Zapisano ustawienia'); if (st.data) draw();
      } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
    };
    const m = modal('Ustawienia harmonogramu', h('div', {},
      h('h3', { style: { margin: '4px 0' } }, 'Wygląd tabeli'),
      h('div', { class: 'row', style: { alignItems: 'center' } }, 'Wysokość wiersza operacji [px]', rowHI, ' Szerokość kolumn dat [px]', dateWI, h('button', { class: 'btn small', onclick: () => { rowHI.value = String(DEFAULT_LAYOUT.rowH); dateWI.value = String(DEFAULT_LAYOUT.dateW); } }, 'Domyślne')),
      h('p', { class: 'muted' }, 'Zapisywane na tym komputerze. Domyślnie szerokość pasuje do daty „dd.mm.rrrr hh”.'),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Stanowiska'),
      h('p', { class: 'muted' }, 'Kolor stanowiska widać w kolumnie „Stan.” i na paskach wykresu. Nowe stanowisko ma też kolumny z miejscami pracy w karcie graf_norm (np. „4Fr1”); bez nich program nie wyliczy końca jego operacji.'),
      box, h('div', { class: 'row', style: { marginTop: '8px' } }, nameI, addBtn),
      h('h3', { style: { margin: '14px 0 4px' } }, 'Kolory komisów'), h('p', { class: 'muted' }, 'Wiersze operacji danego komisu są podświetlone wybranym kolorem w tabeli.'),
      kBox, h('div', { class: 'row', style: { marginTop: '8px' } }, komisI, komisHints, kAdd),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: save }, 'Zapisz'))));
  }

  // ---------- rysowanie ----------
  function draw() {
    const sc = st.scale, HOUR = BASE.hour * sc, ROW = Math.round(st.layout.rowH * sc), FONT = BASE.font * sc;
    const HEAD = Math.ceil(Math.max(textW('00.00.0000', FONT, false), ...COLS.filter((c) => c.vertical).map((c) => textW(c.title, FONT, true)))) + 14;   // wysokość nagłówka = najdłuższy opis w pionie (data albo tytuł kolumny)
    const cols = shownCols();
    const colW = (c) => Math.round((c.isDate ? st.layout.dateW : c.w) * sc);
    const LEFT = cols.reduce((a, c) => a + colW(c), 0) + Math.round(34 * sc);
    const now = H.localNow();
    if (!st.data || !st.data.rows.length) { clear(body); body.append(h('div', { class: 'muted', style: { padding: '12px' } }, st.data ? 'Baza jest pusta. Użyj „Import z arkusza” albo „Dodaj operację”.' : 'Wczytywanie…')); info.textContent = 'Operacji: 0'; st.rows = []; return; }
    const all = st.data.rows;
    const rows = arrangeRows(sortRows(visibleRows(all, COLS, st.filters, val), COLS, st.sorts, val), st.collapsed);   // suboperacje pod operacją główną; zwinięte pomijane
    const chart = H.buildChart({ rows, holidays: [], rapData: {} }, { komis: new Set(), station: new Set() }, H.emptySorts(), st.daysBack, now, { keepAll: true });
    const n = chart.items.length, chartW = Math.ceil((chart.firstDayHours + chart.totalDays * 24) * HOUR);
    st.rows = rows; st.chart = chart; st.geom = { HOUR, ROW, FONT, HEAD, cols, colW, LEFT, chartW, now };
    info.textContent = `Operacji: ${n}` + (n !== all.length ? ` z ${all.length}` : '') + (st.collapsed.size ? ` (zwinięte: ${st.collapsed.size})` : '');
    scaleLabel.textContent = Math.round(sc * 100) + '%'; daysLabel.textContent = st.daysBack + ' dni';
    hideBtn.textContent = st.compact ? 'Pokaż dane' : 'Ukryj dane';

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
    const holidays = H.holidaySet([]);
    let x = 0, day = new Date(Date.UTC(chart.axisStart.getUTCFullYear(), chart.axisStart.getUTCMonth(), chart.axisStart.getUTCDate()));
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (let i = 0; i < chart.totalDays + 1; i++) {
      const w = (i === 0 ? chart.firstDayHours : 24) * HOUR;
      const kind = H.dayKind(day, holidays), isToday = day.getTime() === todayUtc;
      const bg = kind === 'sun' ? '#ff0000' : kind === 'sat' ? '#00b0f0' : '#00b050';   // jak w arkuszu: dzień roboczy zielony, sobota niebieska, niedziela/święto czerwone
      head.append(h('div', { style: { position: 'absolute', left: x + 'px', top: 0, width: w + 'px', height: HEAD + 'px', background: bg, borderRight: '1px solid #999', borderBottom: '1px solid #999', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
        h('span', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', fontSize: FONT + 'px', fontWeight: isToday ? 700 : 400, color: kind === 'sat' ? '#000' : '#fff' } }, H.dayLabel(day))));
      if (kind !== 'work') rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 0, pointerEvents: 'none', left: x + 'px', top: 0, width: w + 'px', height: n * ROW + 'px', background: '#ffffff' } }));   // weekend i święta: białe tło
      if (isToday) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 2, pointerEvents: 'none', left: x + 'px', top: 0, width: w + 'px', height: n * ROW + 'px', background: 'rgba(0,176,80,.18)' } }));
      x += w; day = new Date(day.getTime() + 24 * 3600000);
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
    clear(g.leftRows); clear(g.dyn);
    for (let i = from; i < to; i++) {
      const it = chart.items[i], r = it.row;
      const done = String(r.status).trim().toLowerCase() === 'zak.';
      const kc = komisColor(r.komis);
      const line = h('div', { style: { position: 'absolute', top: i * ROW + 'px', left: 0, display: 'flex', height: ROW + 'px', width: LEFT + 'px', background: kc ? parseSheetColor(kc.bg, '#ffffff') : done ? '#e6f2e0' : i % 2 ? '#fafafa' : '#fff', color: kc ? parseSheetColor(kc.color, '#000000') : '#000', fontWeight: kc && kc.bold ? 700 : 400, fontStyle: (kc && kc.italic) || (r.sub && !kc) ? 'italic' : 'normal', textDecoration: kc && kc.underline ? 'underline' : 'none', borderBottom: '1px solid #8c8c8c', boxSizing: 'border-box' } });
      for (const col of cols) {
        let text = val(r, col);
        if (col.key === 'lp') text = (r.sub ? '    ↳ ' : r.subCount ? (st.collapsed.has(r.id) ? '▸ ' : '▾ ') : '    ') + text;
        const predMissing = col.pred !== undefined && text && !(st.m && st.m.opsByLp[text]);
        const cell = h('div', { title: predMissing ? 'Brak operacji o tym numerze' : col.key === 'start' && !text && r.state === 'no-start' ? 'Brak startu: ustaw start ręcznie albo uzupełnij poprzedników' : col.key === 'key' ? text : '',
          style: { width: colW(col) + 'px', flex: 'none', height: ROW + 'px', lineHeight: ROW - 2 + 'px', padding: '0 3px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: FONT + 'px', borderRight: '1px solid #8c8c8c',
            background: col.ro ? 'rgba(0,0,0,.04)' : predMissing ? '#ffd6d6' : 'transparent', cursor: col.ro ? 'default' : 'text',
            ...(col.key === 'station' && text ? { background: parseSheetColor(r.stanowiskoBg, '#cccccc'), color: parseSheetColor(r.stanowiskoColor, '#000000'), fontStyle: 'italic', fontWeight: 700 } : {}) } }, text);
        if (col.key === 'lp' && r.subCount) cell.title = 'Kliknij strzałkę, aby zwinąć lub rozwinąć suboperacje; resztę komórki, aby zmienić numer';
        if (!col.ro) cell.addEventListener('click', (ev) => {
          if (col.key === 'lp' && r.subCount && ev.offsetX < 20 * st.scale) { toggleCollapse(r.id); return; }
          if (col.pred !== undefined) {
            predPicker(st.m.opsByLp, r.id, col.pred, (lp) => saveCell(st.m.opsByLp, r.id, col, lp));
            return;
          }
          const op = st.m.opsByLp[r.id] || {};
          const initial = col.key === 'lp' ? r.lp : col.date ? fmtDt(op[col.key]) : col.key === 'hours' ? (op.hours == null ? '' : String(op.hours)) : text;
          startEdit(cell, r.id, col, initial);
        });
        line.append(cell);
      }
      line.append(h('div', { style: { flex: 1, textAlign: 'center' } }, h('button', { class: 'btn small', style: { padding: '0 4px', lineHeight: ROW - 6 + 'px' }, title: 'Usuń operację', onclick: () => removeOp(st.m.opsByLp, r.id) }, '✕')));
      g.leftRows.append(line);
      g.dyn.append(h('div', { onclick: () => detail(r), style: { position: 'absolute', left: 0, top: i * ROW + 'px', width: g.chartW + 'px', height: ROW + 'px', cursor: 'pointer' } }));   // klik w wiersz wykresu
      const bg = done ? ZAK_BAR : parseSheetColor(r.stanowiskoBg, '#cccccc');
      const tip = [r.komis, r.element, r.stanowisko].filter(Boolean).join(' - ') + `\n${r.start} → ${r.koniec}`;
      const label = [r.komis, r.element, r.godziny].filter((v) => String(v).trim()).join(' - ');
      const hoursAt = (ms) => (ms - chart.axisStart.getTime()) / 3600000;
      // suboperacja: czarna ramka, w środku tylko 2-pikselowa ramka w kolorze stanowiska (bez wypełnienia); operacja główna: pełny pasek
      // operacja główna złożona z suboperacji: pasek poszatkowany na odcinki suboperacji, przerwy między nimi to przesunięcia suboperacji
      const bar = (left, width, withLabel) => {
        const box = h('div', { title: tip, onclick: () => detail(r), style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: left + 'px', top: i * ROW + 2 + 'px', width: width + 'px', height: ROW - 4 + 'px', border: '1px solid #000', boxSizing: 'border-box', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000', ...(r.sub ? {} : { background: bg }) } });
        if (r.sub) box.append(h('div', { style: { position: 'absolute', inset: 0, border: '2px solid ' + bg, boxSizing: 'border-box', pointerEvents: 'none' } }));
        if (withLabel && label) box.append(h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 4 - FONT * 1.25) / 2) + 'px', lineHeight: '1.25' } }, label));
        g.dyn.append(box);
      };
      if (r.segs && r.segs.length) {
        // jedna czarna ramka od początku pierwszej do końca ostatniej suboperacji; w środku kolor stanowiska tylko w miejscach suboperacji, przerwy puste
        const lefts = r.segs.map(([s0]) => Math.max(0, hoursAt(s0)) * HOUR), rights = r.segs.map(([, e0]) => Math.max(0, hoursAt(e0)) * HOUR);
        const L = Math.min(...lefts), W = Math.max(2, Math.max(...rights) - L);
        if (Math.max(...rights) > 0) {
          const box = h('div', { title: tip, onclick: () => detail(r), style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: L + 'px', top: i * ROW + 2 + 'px', width: W + 'px', height: ROW - 4 + 'px', border: '1px solid #000', boxSizing: 'border-box', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000' } });
          r.segs.forEach((_, k) => { const l = lefts[k] - L, w = Math.max(1, rights[k] - lefts[k]); box.append(h('div', { style: { position: 'absolute', left: l - 1 + 'px', top: 0, bottom: 0, width: w + 'px', background: bg, pointerEvents: 'none' } })); });
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
      if (commit && input.value.trim() !== text.trim()) await saveCell(st.m.opsByLp, id, col, input.value.trim());
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
  const scaleLabel = h('button', { class: 'btn small', title: 'Kliknij, aby wrócić do 100%', onclick: () => setScale(1) }, '100%');
  const daysLabel = h('span', {});
  const hideBtn = h('button', { class: 'btn small primary', title: 'Ukrywa kolumny z listy „Które dane ukrywać” (domyślnie wszystkie poza lp, startem, końcem i stanowiskiem)', onclick: () => { st.compact = !st.compact; lsSet(LS.mode, st.compact); if (st.data) draw(); } }, 'Ukryj dane');
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel', style: { flexWrap: 'wrap' } },
    h('button', { class: 'btn small', onclick: () => { if (st.daysBack > 0) { st.daysBack--; if (st.data) draw(); } } }, '−'), daysLabel, h('button', { class: 'btn small', onclick: () => { if (st.daysBack < 30) { st.daysBack++; if (st.data) draw(); } } }, '+'), h('span', { class: 'muted' }, 'dni wstecz'),
    h('button', { class: 'btn small', title: 'Pomniejsz (Ctrl+kółko)', onclick: () => setScale(st.scale / 1.15) }, '−'), scaleLabel, h('button', { class: 'btn small', title: 'Powiększ (Ctrl+kółko)', onclick: () => setScale(st.scale * 1.15) }, '+'),
    hideBtn, h('button', { class: 'btn small', title: 'Wybierz, które kolumny chowa przycisk „Ukryj dane”', onclick: hideDialog }, 'Które dane ukrywać…'),
    h('button', { class: 'btn small', onclick: () => { st.filters = {}; st.sorts = []; if (st.data) draw(); } }, 'Wyczyść filtry'),
    h('button', { class: 'btn small', title: 'Chowa suboperacje (np. 3000a, 3000b) pod operacjami głównymi', onclick: () => setAllCollapsed(true) }, 'Zwiń suboperacje'),
    h('button', { class: 'btn small', onclick: () => setAllCollapsed(false) }, 'Rozwiń suboperacje'),
    h('button', { class: 'btn small primary', onclick: () => st.m && addDialog(st.m.opsByLp, stationList(st.m.cfg)) }, 'Dodaj operację'),
    h('button', { class: 'btn small', title: 'Kolory stanowisk, nowe stanowiska i kolory komisów', onclick: stationsDialog }, 'Ustawienia…'),
    h('span', { class: 'grow' }), info,
    h('button', { class: 'btn small', title: 'Pobiera dane wpisane ręcznie z arkusza Harmonogramu do bazy', onclick: importSheet }, 'Import z arkusza'),
    h('button', { class: 'btn', onclick: load }, 'Odśwież')), body);
  load();
}
