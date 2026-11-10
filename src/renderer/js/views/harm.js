import { h, clear, api, apiCached, modal, toast } from '../ui.js';
import { watchHarm, importOps } from '../harmStore.js';
import { buildHarmData, parseGrafik, daysByKeyOf } from '../logic/harmModel.js';
import { opsFromSheetRows } from '../logic/harmImport.js';
import * as H from '../logic/harm.js';
import { parseSheetColor } from '../logic/common.js';
import { HARM_MAX_AGE } from '../prefetch.js';

// Wymiary przy skali 100% (px). Skala zmienia je wszystkie razem, jak w aplikacji na Androida.
const BASE = { hour: 0.75, row: 22, font: 11, head: 78, startW: 92, endW: 92, stationW: 48 };
const ZAK_CELL = '#00b050';
const BLACK_TEXT_STATIONS = new Set(['3Co', '1Si', '5Śl']);

export function mountHarm(el, ctx) { return mountHarmView(el, ctx, false); }
export function mountHarmLive(el, ctx) { return mountHarmView(el, ctx, true); }

function mountHarmView(el, ctx, live) {
  const st = { data: null, filters: { komis: new Set(), station: new Set() }, sorts: H.emptySorts(), daysBack: 3, scale: 1 };
  const body = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0, position: 'relative' } });
  const info = h('span', { class: 'muted' });

  let stop = null;
  const live_ = { m: null, days: null };
  const recompute = () => {
    if (!live_.m) return;
    if (!live_.days) { info.textContent = 'Pobieranie grafiku…'; }
    const d = buildHarmData(live_.m.opsByLp, live_.days || {}, live_.m.cfg, H.localNow().getTime());
    st.data = d;
    if (!d.rows.length) { clear(body); body.append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Baza jest pusta. Użyj „Import z arkusza”.')); info.textContent = 'Operacji: 0'; return; }
    draw();
  };
  async function loadGrafik(force) {
    try { await apiCached('getGrafNorm', [], (g) => { live_.days = daysByKeyOf(parseGrafik(g)); recompute(); }, { timeoutMs: 180000, maxAge: HARM_MAX_AGE, force, callArgs: force ? ['fresh'] : undefined }); }
    catch (e) { toast('Grafik: ' + e.message); }
  }
  async function loadLive(force = false) {
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Łączenie z bazą…'));
    try {
      if (stop) stop();
      loadGrafik(force);
      stop = await watchHarm((m) => { live_.m = m; recompute(); },
        (e) => { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy: ' + (e.code || '') + ' ' + (e.message || e))); });
    } catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: () => loadLive(true) }, 'Ponów'))); }
  }
  const importSheet = async () => {
    try {
      toast('Pobieranie z arkusza…');
      const d = await api('getHarmData', ['fresh'], { timeoutMs: 180000 });
      const r = opsFromSheetRows(d.rows);
      if (!r.operations.length) { toast(r.warnings[0] || 'Brak operacji'); return; }
      const ok = window.confirm(`Zaimportować ${r.operations.length} operacji z arkusza? Obecne operacje w bazie zostaną ZASTĄPIONE.` + (r.warnings.length ? `\n\nOstrzeżeń: ${r.warnings.length}\n` + r.warnings.slice(0, 5).join('\n') : ''));
      if (!ok) return;
      const x = await importOps(r.operations, r.stations, d.holidays || []);
      toast(`Zaimportowano ${x.operations} operacji`);
    } catch (e) { toast('Błąd importu: ' + (e.code || e.message)); }
  };

  async function load(force = false) {
    if (live) return loadLive(force);
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie harmonogramu…'));
    try { await apiCached('getHarmData', [], (d) => { st.data = d; draw(); }, { timeoutMs: 180000, maxAge: HARM_MAX_AGE, force, callArgs: force ? ['fresh'] : undefined }); }
    catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: () => load(true) }, 'Ponów'))); }
  }

  function openFilter(kind, title, values) {
    const selected = new Set(st.filters[kind]);
    const opts = H.filterOptions(values);
    const list = h('div', { class: 'opts' });
    const search = h('input', { type: 'search', placeholder: 'Szukaj…', style: { width: '100%', padding: '6px' } });
    const render = () => { clear(list); const q = search.value.toLowerCase(); for (const o of opts.filter((x) => x.toLowerCase().includes(q))) {
      const cb = h('input', { type: 'checkbox', checked: selected.has(o), onchange: () => { cb.checked ? selected.add(o) : selected.delete(o); } }); list.append(h('label', {}, cb, o)); } };
    search.addEventListener('input', render); render();
    const m = modal(title, h('div', {}, search, list, h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { selected.clear(); st.filters[kind] = selected; m.close(); draw(); } }, 'Wyczyść filtr'),
      h('button', { class: 'btn primary', onclick: () => { st.filters[kind] = selected; m.close(); draw(); } }, 'OK'))));
  }

  function detail(item) {
    const r = item.row;
    const rows = [['Komis', r.komis], ['Element', r.element], ['Stanowisko', r.stanowisko], ['Start', H.shortDate(r.start)], ['Koniec', H.shortDate(r.koniec)], ['Godziny', r.godziny],
      ['Dostawa', r.dostawa ? H.shortDate(r.dostawa) : ''], ['Wysyłka', r.wysylka ? H.shortDate(r.wysylka) : ''], ['Realizacja', item.pct === null ? '' : item.pct + '%'],
      ['Lp / poprzedzające', [r.lp, r.z1, r.z2, r.z3, r.z4].filter(Boolean).join(' / ')]].filter(([, v]) => v);
    const m = modal('Operacja', h('div', {}, ...rows.map(([k, v]) => h('div', { class: 'row', style: { margin: '2px 0' } }, h('b', { style: { width: '140px' } }, k), h('span', {}, v))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))));
  }

  function draw() {
    const sc = st.scale;
    const HOUR = BASE.hour * sc, ROW = Math.round(BASE.row * sc), FONT = BASE.font * sc, HEAD = Math.round(BASE.head * sc);
    const SW = Math.round(BASE.startW * sc), EW = Math.round(BASE.endW * sc), TW = Math.round(BASE.stationW * sc);
    const LEFT = SW + EW + TW;
    const now = H.localNow();
    const chart = H.buildChart(st.data, st.filters, st.sorts, st.daysBack, now);
    const holidays = H.holidaySet(st.data.holidays);
    const n = chart.items.length;
    const chartW = Math.ceil((chart.firstDayHours + chart.totalDays * 24) * HOUR);
    const rowsH = n * ROW;
    const cell = (w, extra) => h('div', { style: { width: w + 'px', flex: 'none', height: ROW + 'px', lineHeight: ROW + 'px', fontSize: FONT + 'px', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', borderRight: '1px solid #ddd', borderBottom: '1px solid #ddd', boxSizing: 'border-box', ...extra } });
    const arrow = (d) => (d === 'asc' ? ' ↑' : d === 'desc' ? ' ↓' : '');

    // ---- lewa część: stałe kolumny Start, Koniec, st. (nie przewijają się poziomo) ----
    const headCell = (text, w, field) => h('div', { title: field ? 'Kliknij, aby sortować' : '', onclick: field ? () => { st.sorts = H.cycleSort(st.sorts, field); draw(); } : null,
      style: { width: w + 'px', flex: 'none', height: HEAD + 'px', background: '#eee', borderRight: '1px solid #888', borderBottom: '1px solid #888', boxSizing: 'border-box', fontSize: FONT + 'px', fontWeight: 700, cursor: field ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' } },
      h('span', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap' } }, text));
    const left = h('div', { style: { position: 'sticky', left: 0, zIndex: 6, width: LEFT + 'px', flex: 'none', background: '#fff', borderRight: '2px solid #888' } },
      h('div', { style: { position: 'sticky', top: 0, zIndex: 7, display: 'flex', height: HEAD + 'px' } },
        headCell('Start' + arrow(st.sorts.start), SW, 'start'), headCell('Koniec', EW, null), headCell('st.' + arrow(st.sorts.station), TW, 'station')));
    chart.items.forEach((it) => {
      const r = it.row;
      const zak = String(r.zak).trim().toLowerCase().startsWith('zak');
      const zakStyle = zak ? { background: ZAK_CELL, color: '#fff' } : { background: '#fff', color: '#000' };
      left.append(h('div', { style: { display: 'flex', height: ROW + 'px', cursor: 'pointer' }, onclick: () => detail(it) },
        cell(SW, zakStyle), cell(EW, zakStyle), ...[cell(TW, { background: parseSheetColor(r.stanowiskoBg, '#fff'), color: parseSheetColor(r.stanowiskoColor, '#000'), fontWeight: 700 })]));
      const cells = left.lastChild.children;
      cells[0].textContent = H.shortDate(r.start); cells[1].textContent = H.shortDate(r.koniec); cells[2].textContent = r.stanowisko;
    });

    // ---- wykres: nagłówek z dobami (daty w pionie) i wiersze ----
    const chartEl = h('div', { style: { position: 'relative', width: chartW + 'px', flex: 'none' } });
    const head = h('div', { style: { position: 'sticky', top: 0, zIndex: 5, height: HEAD + 'px', width: chartW + 'px', overflow: 'hidden' } });
    const rowsEl = h('div', { style: { position: 'relative', height: rowsH + 'px', width: chartW + 'px' } });
    let x = 0, day = new Date(Date.UTC(chart.axisStart.getUTCFullYear(), chart.axisStart.getUTCMonth(), chart.axisStart.getUTCDate()));
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (let i = 0; i < chart.totalDays + 1; i++) {
      const w = (i === 0 ? chart.firstDayHours : 24) * HOUR;
      const kind = H.dayKind(day, holidays);
      const isToday = day.getTime() === todayUtc;
      const bg = kind === 'sun' ? '#ffb3b3' : kind === 'sat' ? '#00b0f0' : '#eee';
      head.append(h('div', { style: { position: 'absolute', left: x + 'px', top: 0, width: w + 'px', height: HEAD + 'px', background: bg, borderRight: '1px solid #999', borderBottom: '1px solid #999', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
        h('span', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', fontSize: FONT + 'px', fontWeight: isToday ? 700 : 400 } }, H.dayLabel(day))));
      if (kind !== 'work' || isToday) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 2, pointerEvents: 'none', left: x + 'px', top: 0, width: w + 'px', height: rowsH + 'px', background: isToday ? 'rgba(0,176,80,.18)' : kind === 'sun' ? 'rgba(255,179,179,.25)' : 'rgba(0,176,240,.12)' } }));
      x += w; day = new Date(day.getTime() + 24 * 3600000);
    }
    chart.items.forEach((it, i) => {
      const top = i * ROW;
      const left0 = it.startHours * HOUR, w = it.durationHours * HOUR;
      const r = it.row;
      const done = String(r.zak).trim().toLowerCase().startsWith('zak');
      const textColor = BLACK_TEXT_STATIONS.has(String(r.stanowisko).trim()) ? '#000' : parseSheetColor(r.stanowiskoColor, '#000');
      rowsEl.append(h('div', { onclick: () => detail(it), style: { position: 'absolute', left: 0, top: top + 'px', width: chartW + 'px', height: ROW + 'px', borderBottom: '1px solid #f0f0f0', boxSizing: 'border-box', cursor: 'pointer' } }));
      rowsEl.append(h('div', { title: [r.komis, r.element, r.stanowisko].filter(Boolean).join(' - '), onclick: () => detail(it),
        style: { position: 'absolute', zIndex: 1, left: left0 + 'px', top: top + 2 + 'px', width: w + 'px', height: ROW - 4 + 'px', background: done ? '#93c47d' : parseSheetColor(r.stanowiskoBg, '#6d9f3d'), border: '1px solid #000', boxSizing: 'border-box', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', color: textColor } },
        h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 4 - FONT * 1.25) / 2) + 'px', lineHeight: '1.25' } }, [r.komis, r.element, r.godziny].filter((v) => String(v).trim()).join(' - '))));
      for (const sg of it.delivery) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 1, pointerEvents: 'none', left: sg.left * HOUR + 'px', top: top + ROW - Math.max(3, ROW * 0.14) + 'px', width: Math.max(2, sg.width * HOUR) + 'px', height: Math.max(3, ROW * 0.14) + 'px', background: sg.kind === 'green' ? '#00b050' : '#f00' } }));
      if (it.pct !== null) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 1, pointerEvents: 'none', left: left0 + 'px', top: top + 2 + 'px', width: Math.max(1, w * it.pct / 100) + 'px', height: Math.max(3, ROW * 0.18) + 'px', background: it.pct <= 100 ? '#00b050' : '#cc2200' } }));
    });
    for (const d of chart.deps) {
      const a = Math.min(d.from, d.to), b = Math.max(d.from, d.to);
      if (a === b) continue;
      rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 3, pointerEvents: 'none', left: d.x * HOUR + 'px', top: a * ROW + ROW / 2 + 'px', width: 0, height: (b - a) * ROW + 'px', borderLeft: '1px dashed #555' } }));
    }
    const nowX = (now.getTime() - chart.axisStart.getTime()) / 3600000 * HOUR;
    if (nowX > 0) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 3, pointerEvents: 'none', left: nowX + 'px', top: 0, width: 0, height: rowsH + 'px', borderLeft: '2px dashed #ff6600' } }));
    chartEl.append(head, rowsEl);

    const sy = body.scrollTop, sx = body.scrollLeft;
    clear(body);
    body.append(h('div', { style: { display: 'flex', width: (LEFT + chartW) + 'px', minHeight: '100%' } }, left, chartEl));
    body.scrollTop = sy; body.scrollLeft = sx;
    info.textContent = `Operacji: ${n}`;
    daysLabel.textContent = st.daysBack + ' dni';
    scaleLabel.textContent = Math.round(sc * 100) + '%';
    for (const [k, b] of Object.entries(sortBtns)) b.textContent = { komis: 'Komis', start: 'Start', station: 'Stanowisko' }[k] + (st.sorts[k] === 'asc' ? ' ↑' : st.sorts[k] === 'desc' ? ' ↓' : '');
    fK.classList.toggle('primary', st.filters.komis.size > 0); fS.classList.toggle('primary', st.filters.station.size > 0);
  }

  const setScale = (v) => { st.scale = Math.max(0.5, Math.min(2.5, Math.round(v * 100) / 100)); if (st.data) draw(); };
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setScale(st.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
  const scaleLabel = h('button', { class: 'btn small', title: 'Kliknij, aby wrócić do 100%', onclick: () => setScale(1) }, '100%');

  const daysLabel = h('span', {});
  const sortBtns = {};
  for (const k of ['komis', 'start', 'station']) sortBtns[k] = h('button', { class: 'btn small', onclick: () => { st.sorts = H.cycleSort(st.sorts, k); draw(); } }, k);
  const fK = h('button', { class: 'btn small', onclick: () => openFilter('komis', 'Filtr: komis', st.data.rows.map((r) => r.komis)) }, 'Filtr komis');
  const fS = h('button', { class: 'btn small', onclick: () => openFilter('station', 'Filtr: stanowisko', st.data.rows.map((r) => r.stanowisko)) }, 'Filtr stanowisko');
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' },
    h('button', { class: 'btn small', onclick: () => { if (st.daysBack > 0) { st.daysBack--; draw(); } } }, '−'), daysLabel, h('button', { class: 'btn small', onclick: () => { if (st.daysBack < 30) { st.daysBack++; draw(); } } }, '+'), h('span', { class: 'muted' }, 'dni wstecz'),
    h('button', { class: 'btn small', title: 'Pomniejsz (Ctrl+kółko)', onclick: () => setScale(st.scale / 1.15) }, '−'), scaleLabel, h('button', { class: 'btn small', title: 'Powiększ (Ctrl+kółko)', onclick: () => setScale(st.scale * 1.15) }, '+'),
    fK, fS, ...Object.values(sortBtns),
    h('button', { class: 'btn small', onclick: () => { st.filters = { komis: new Set(), station: new Set() }; st.sorts = H.emptySorts(); draw(); } }, 'Wyczyść'),
    h('span', { class: 'grow' }), info, ...(live ? [h('button', { class: 'btn small', title: 'Pobiera dane wpisane ręcznie z arkusza Harmonogramu do bazy', onclick: importSheet }, 'Import z arkusza')] : []), h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), body);
  load();
}
