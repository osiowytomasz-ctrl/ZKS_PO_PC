// Harmonogram (Firebase): widok klasyczny jak w arkuszu. Jedna tabela: z lewej dane (kolumny jak w pliku), z prawej oś czasu z paskami w tych samych wierszach.
// Dane twarde edytujesz w komórkach; Start, Koniec i klucz liczy program. Przycisk „Ukryj dane” chowa kolumny z listy ukrywanych (domyślnie „czerwone”).
import { h, clear, api, apiCached, modal, toast, columnFilterDialog } from '../ui.js';
import * as H from '../logic/harm.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { buildHarmData, parseGrafik, daysByKeyOf } from '../logic/harmModel.js';
import { opsFromSheetRows } from '../logic/harmImport.js';
import { watchHarm, importOps } from '../harmStore.js';
import { COLS, saveCell, removeOp, addDialog } from './harmEdit.js';
import { parseSheetColor } from '../logic/common.js';

const BASE = { hour: 0.75, row: 26, font: 12, head: 84 };
const DEFAULT_KEEP = new Set(['lp', 'start', 'koniec', 'station']);   // kolumny, które zostają po „Ukryj dane”
const LS = { hide: 'zks.harm.hideSet', mode: 'zks.harm.hideMode' };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* brak pamięci przeglądarki */ } };
const ZAK_BAR = '#93c47d';

export function mountHarmLive(el) {
  const st = {
    m: null, days: null, data: null, filters: {}, sorts: [], daysBack: 3, scale: 1, editing: false, pending: false,
    hideSet: new Set(lsGet(LS.hide, COLS.filter((c) => !DEFAULT_KEEP.has(c.key)).map((c) => c.key))), compact: !!lsGet(LS.mode, false),
    rows: [], chart: null, geom: null,
  };
  const body = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0, minWidth: 0, position: 'relative', overflow: 'auto' } });
  const info = h('span', { class: 'muted' });
  const val = (row, col) => String(row[col.key] ?? '');
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

  // ---------- rysowanie ----------
  function draw() {
    const sc = st.scale, HOUR = BASE.hour * sc, ROW = Math.round(BASE.row * sc), FONT = BASE.font * sc, HEAD = Math.round(BASE.head * sc);
    const cols = shownCols();
    const colW = (c) => Math.round(c.w * sc);
    const LEFT = cols.reduce((a, c) => a + colW(c), 0) + Math.round(34 * sc);
    const now = H.localNow();
    if (!st.data || !st.data.rows.length) { clear(body); body.append(h('div', { class: 'muted', style: { padding: '12px' } }, st.data ? 'Baza jest pusta. Użyj „Import z arkusza” albo „Dodaj operację”.' : 'Wczytywanie…')); info.textContent = 'Operacji: 0'; st.rows = []; return; }
    const all = st.data.rows;
    const rows = sortRows(visibleRows(all, COLS, st.filters, val), COLS, st.sorts, val);
    const chart = H.buildChart({ rows, holidays: [], rapData: {} }, { komis: new Set(), station: new Set() }, H.emptySorts(), st.daysBack, now, { keepAll: true });
    const n = chart.items.length, chartW = Math.ceil((chart.firstDayHours + chart.totalDays * 24) * HOUR);
    st.rows = rows; st.chart = chart; st.geom = { HOUR, ROW, FONT, HEAD, cols, colW, LEFT, chartW, now };
    info.textContent = `Operacji: ${n}` + (n !== all.length ? ` z ${all.length}` : '');
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
        h('span', { style: { lineHeight: '1.15', wordBreak: 'break-word' } }, c.title + (filtered ? ' ▼' : '') + (sortLabel(c.key) ? ' ' + sortLabel(c.key) : ''))));
    }
    leftHead.append(h('div', { style: { flex: 1 } }));
    left.append(leftHead);
    const leftRows = h('div', { style: { position: 'relative', height: n * ROW + 'px', width: LEFT + 'px' } });
    left.append(leftRows);

    const chartEl = h('div', { style: { position: 'relative', width: chartW + 'px', flex: 'none' } });
    const head = h('div', { style: { position: 'sticky', top: 0, zIndex: 5, height: HEAD + 'px', width: chartW + 'px', overflow: 'hidden' } });
    const rowsEl = h('div', { style: { position: 'relative', height: n * ROW + 'px', width: chartW + 'px' } });
    const holidays = H.holidaySet([]);
    let x = 0, day = new Date(Date.UTC(chart.axisStart.getUTCFullYear(), chart.axisStart.getUTCMonth(), chart.axisStart.getUTCDate()));
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (let i = 0; i < chart.totalDays + 1; i++) {
      const w = (i === 0 ? chart.firstDayHours : 24) * HOUR;
      const kind = H.dayKind(day, holidays), isToday = day.getTime() === todayUtc;
      const bg = kind === 'sun' ? '#ffb3b3' : kind === 'sat' ? '#00b0f0' : '#eee';
      head.append(h('div', { style: { position: 'absolute', left: x + 'px', top: 0, width: w + 'px', height: HEAD + 'px', background: bg, borderRight: '1px solid #999', borderBottom: '1px solid #999', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
        h('span', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', fontSize: FONT + 'px', fontWeight: isToday ? 700 : 400 } }, H.dayLabel(day))));
      if (kind !== 'work' || isToday) rowsEl.append(h('div', { style: { position: 'absolute', zIndex: 2, pointerEvents: 'none', left: x + 'px', top: 0, width: w + 'px', height: n * ROW + 'px', background: isToday ? 'rgba(0,176,80,.18)' : kind === 'sun' ? 'rgba(255,179,179,.25)' : 'rgba(0,176,240,.12)' } }));
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
      const line = h('div', { style: { position: 'absolute', top: i * ROW + 'px', left: 0, display: 'flex', height: ROW + 'px', width: LEFT + 'px', background: done ? '#e6f2e0' : i % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #ddd', boxSizing: 'border-box' } });
      for (const col of cols) {
        const text = val(r, col);
        const predMissing = col.pred !== undefined && text && !(st.m && st.m.opsByLp[text]);
        const cell = h('div', { title: predMissing ? 'Brak operacji o tym numerze' : col.key === 'start' && !text && r.state === 'no-start' ? 'Brak startu: ustaw start ręcznie albo uzupełnij poprzedników' : '',
          style: { width: colW(col) + 'px', flex: 'none', height: ROW + 'px', lineHeight: ROW - 2 + 'px', padding: '0 3px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: FONT + 'px', borderRight: '1px solid #e0e0e0',
            background: col.ro ? 'rgba(0,0,0,.04)' : predMissing ? '#ffd6d6' : 'transparent', cursor: col.ro ? 'default' : 'text' } }, text);
        if (!col.ro) cell.addEventListener('click', () => startEdit(cell, r.id, col, text));
        line.append(cell);
      }
      line.append(h('div', { style: { flex: 1, textAlign: 'center' } }, h('button', { class: 'btn small', style: { padding: '0 4px', lineHeight: ROW - 6 + 'px' }, title: 'Usuń operację', onclick: () => removeOp(st.m.opsByLp, r.id) }, '✕')));
      g.leftRows.append(line);
      g.dyn.append(h('div', { style: { position: 'absolute', left: 0, top: i * ROW + 'px', width: g.chartW + 'px', height: ROW + 'px', borderBottom: '1px solid #e8e8e8', boxSizing: 'border-box', pointerEvents: 'none' } }));
      if (it.noBar) continue;
      const left0 = it.startHours * HOUR, w = Math.max(2, it.durationHours * HOUR);
      const bg = done ? ZAK_BAR : parseSheetColor(r.stanowiskoBg, '#6d9f3d');
      g.dyn.append(h('div', { title: [r.komis, r.element, r.stanowisko].filter(Boolean).join(' - ') + `\n${r.start} → ${r.koniec}`,
        style: { position: 'absolute', zIndex: 1, left: left0 + 'px', top: i * ROW + 2 + 'px', width: w + 'px', height: ROW - 4 + 'px', background: bg, border: '1px solid #000', boxSizing: 'border-box', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000' } },
        h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 4 - FONT * 1.25) / 2) + 'px', lineHeight: '1.25' } }, [r.komis, r.element, r.godziny].filter((v) => String(v).trim()).join(' - '))));
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
    h('button', { class: 'btn small primary', onclick: () => st.m && addDialog(st.m.opsByLp) }, 'Dodaj operację'),
    h('span', { class: 'grow' }), info,
    h('button', { class: 'btn small', title: 'Pobiera dane wpisane ręcznie z arkusza Harmonogramu do bazy', onclick: importSheet }, 'Import z arkusza'),
    h('button', { class: 'btn', onclick: load }, 'Odśwież')), body);
  load();
}
