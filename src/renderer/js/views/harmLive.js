// Harmonogram (Firebase): widok klasyczny jak w arkuszu. Jedna tabela: z lewej dane (kolumny jak w pliku), z prawej oś czasu z paskami w tych samych wierszach.
// Dane twarde edytujesz w komórkach; Start, Koniec i klucz liczy program. Przycisk „Ukryj dane” chowa kolumny z listy ukrywanych (domyślnie „czerwone”).
import { h, clear, api, apiCached, modal, toast, columnFilterDialog } from '../ui.js';
import * as H from '../logic/harm.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { buildHarmData, parseGrafik, daysByKeyOf, stationList, DEFAULT_STATIONS, fmtDt, arrangeRows, subParent, subOps, reorderIds, reorderPlan } from '../logic/harmModel.js';
import { opsFromSheetRows } from '../logic/harmImport.js';
import { watchHarm, importOps, saveSettings, renameOp } from '../harmStore.js';
import { COLS, saveCell, removeOp, addDialog, predPicker } from './harmEdit.js';
import { parseSheetColor } from '../logic/common.js';
import { INTERVALS, DEFAULT_INTERVAL, intervalOf, axisStartMs, buildCells, holidayMap, sampleLabel, MAX_SHIFT_DAYS } from '../logic/harmAxis.js';
import { parseDateTime } from '../logic/harmImport.js';

const BASE = { hour: 0.75, row: 26, font: 12 };
const DEFAULT_LAYOUT = { rowH: 26, dateW: 104 };   // dateW dopasowana do „dd.mm.rrrr hh”
const DEFAULT_KEEP = new Set(['lp', 'start', 'koniec', 'station']);   // kolumny, które zostają po „Ukryj dane”
const LS = { hide: 'zks.harm.hideSet', mode: 'zks.harm.hideMode', layout: 'zks.harm.layout', interval: 'zks.harm.interval' };
const CELL_W = 18;            // szerokość kolumny osi przy skali 100% (px) dla pełnego interwału
const HOLIDAY_BG = '#800000';  // święta: bordowe tło, biała pogrubiona czcionka
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* brak pamięci przeglądarki */ } };
const ZAK_BAR = '#93c47d';

export function mountHarmLive(el) {
  const st = {
    m: null, days: null, data: null, filters: {}, sorts: [], shift: -3, interval: intervalOf(lsGet(LS.interval, DEFAULT_INTERVAL)).id, scale: 1, editing: false, pending: false,
    hideSet: new Set(lsGet(LS.hide, COLS.filter((c) => !DEFAULT_KEEP.has(c.key)).map((c) => c.key))), compact: !!lsGet(LS.mode, false),
    collapsed: new Set(), hiddenLevels: new Set(), selected: null, rows: [], chart: null, geom: null, layout: { ...DEFAULT_LAYOUT, ...lsGet(LS.layout, {}) },
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

  // Zaznaczenie wiersza: kliknięcie w dowolne miejsce linii (tabela albo wykres) podświetla ją ramką z poświatą.
  // Kliknięta linia: zielona poświata; jej suboperacje (dzieci): pomarańczowa; subsuboperacje (wnuki): żółta.
  const GLOW = { self: '0, 176, 80', child: '255, 140, 0', grand: '255, 215, 0' };
  const relationTo = (id, sel) => (sel == null ? null : id === sel ? 'self' : subParent(id) === sel ? 'child' : subParent(subParent(id) || '') === sel ? 'grand' : null);
  const applySelection = () => {
    const g = st.geom; if (!g || !g.rowEls) return;
    for (const [id, els] of g.rowEls) {
      const rel = relationTo(id, st.selected), c = rel && GLOW[rel];
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
  function reorderDialog(rootId) {
    const ops = st.m.opsByLp;
    const order = {};
    const fill = (id) => { const k = subOps(ops, id); if (k.length) { order[id] = k; k.forEach(fill); } };
    fill(rootId);
    const box = h('div', {}), status = h('div', { style: { marginTop: '8px', whiteSpace: 'pre-wrap', fontSize: '12px' } });
    let dragging = null;   // { parent, id }
    const label = (id) => { const o = ops[id] || {}; const st0 = o.station || ''; return [o.element, st0, o.hours > 0 ? o.hours + ' h' : ''].filter(Boolean).join('  ·  '); };
    const render = () => {
      clear(box);
      let preview;
      try { preview = reorderIds(ops, rootId, order); } catch (e) { preview = new Map(); }
      const group = (parent, depth) => {
        const list = h('div', { style: { marginLeft: depth ? '22px' : 0, borderLeft: depth ? '2px solid #ddd' : 'none', paddingLeft: depth ? '6px' : 0 } });
        order[parent].forEach((id, idx) => {
          const newId = preview.get(id) || id, moved = newId !== id;
          const row = h('div', { draggable: 'true', title: 'Przeciągnij, aby zmienić kolejność (tylko w obrębie tej samej operacji)',
            style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', margin: '2px 0', border: '1px solid #bbb', background: moved ? '#fff4d6' : '#fff', cursor: 'grab', userSelect: 'none' },
            ondragstart: (e) => { dragging = { parent, id }; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); },
            ondragover: (e) => { if (dragging && dragging.parent === parent) { e.preventDefault(); e.stopPropagation(); row.style.borderTop = '3px solid #1a73e8'; } },
            ondragleave: () => { row.style.borderTop = '1px solid #bbb'; },
            ondrop: (e) => {
              e.preventDefault(); e.stopPropagation(); row.style.borderTop = '1px solid #bbb';
              if (!dragging || dragging.parent !== parent || dragging.id === id) return;
              const arr = order[parent].filter((x) => x !== dragging.id);
              arr.splice(arr.indexOf(id), 0, dragging.id);
              order[parent] = arr; dragging = null; render();
            } },
            h('span', { style: { color: '#888' } }, '⠿'),
            h('b', { style: { minWidth: '64px' } }, id), moved ? h('span', { style: { color: '#b45309', fontWeight: 700 } }, '→ ' + newId) : h('span', { style: { color: '#888', minWidth: '64px' } }, ''),
            h('span', { class: 'muted', style: { flex: 1 } }, label(id)),
            h('button', { class: 'btn small', title: 'W górę', disabled: idx === 0, onclick: () => { const a = order[parent]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; render(); } }, '↑'),
            h('button', { class: 'btn small', title: 'W dół', disabled: idx === order[parent].length - 1, onclick: () => { const a = order[parent]; [a[idx + 1], a[idx]] = [a[idx], a[idx + 1]]; render(); } }, '↓'));
          list.append(row);
          if (order[id]) list.append(group(id, depth + 1));
        });
        return list;
      };
      box.append(group(rootId, 0));
      const plan = reorderPlan(ops, rootId, order);
      status.className = plan.error ? 'err' : 'muted';
      status.textContent = plan.error ? plan.error
        : plan.same ? 'Kolejność bez zmian.'
        : `Zmiana numerów: ${plan.moves.length}` + (plan.referrers.length ? `\nPowiązania innych operacji poprawione automatycznie: ${plan.referrers.map(([lp, p]) => lp + ' → ' + p.join(', ')).join('; ')}` : '\nBrak powiązań z innymi operacjami.') + '\nKonfliktów (cykli) nie ma.';
      applyBtn.disabled = !!plan.error || !!plan.same;
    };
    const applyBtn = h('button', { class: 'btn primary', onclick: async () => {
      const plan = reorderPlan(st.m.opsByLp, rootId, order);
      if (plan.error || plan.same) { render(); return; }
      try { await renameOp(plan); m.close(); toast(`Zmieniono kolejność w ${rootId}: ${plan.moves.length} numerów`); }
      catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
    } }, 'Zastosuj');
    const m = modal(`Kolejność: ${subParent(rootId) ? 'suboperacja' : 'operacja'} ${rootId}`, h('div', {},
      h('p', { class: 'muted' }, 'Przeciągnij wiersz (albo użyj ↑ ↓), aby zmienić kolejność. Można przesuwać tylko w obrębie tej samej operacji; zmiana kolejności zmienia litery w numerach, a operacje wykonują się w kolejności liter.'),
      h('div', { style: { maxHeight: '60vh', overflow: 'auto' } }, box), status,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), applyBtn)), { wide: true });
    render();
  }

  // Szczegóły operacji: tylko prawy przycisk myszy (lewy zaznacza linię i edytuje komórki)
  function detail(r) {
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
      r.subCount ? h('button', { class: 'btn', title: 'Zmiana kolejności suboperacji przeciąganiem', onclick: () => { m.close(); reorderDialog(r.id); } }, 'Kolejność suboperacji…') : null,
      h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))));
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
        tb.append(h('tr', {}, h('td', { style: { border: '1px solid #999', padding: 0 } }, dI), h('td', { style: { border: '1px solid #999', padding: 0 } }, nI),
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
        await saveSettings(list, komisList, holidays); m.close(); toast('Zapisano ustawienia'); if (st.data) draw();
      } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
    };
    const m = modal('Ustawienia harmonogramu', h('div', {},
      h('h3', { style: { margin: '4px 0' } }, 'Wygląd tabeli'),
      h('div', { class: 'row', style: { alignItems: 'center' } }, 'Wysokość wiersza operacji [px]', rowHI, ' Szerokość kolumn dat [px]', dateWI, h('button', { class: 'btn small', onclick: () => { rowHI.value = String(DEFAULT_LAYOUT.rowH); dateWI.value = String(DEFAULT_LAYOUT.dateW); } }, 'Domyślne')),
      h('p', { class: 'muted' }, 'Zapisywane na tym komputerze. Domyślnie szerokość pasuje do daty „dd.mm.rrrr hh”.'),
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
    if (!st.data || !st.data.rows.length) { clear(body); body.append(h('div', { class: 'muted', style: { padding: '12px' } }, st.data ? 'Baza jest pusta. Użyj „Import z arkusza” albo „Dodaj operację”.' : 'Wczytywanie…')); info.textContent = 'Operacji: 0'; st.rows = []; return; }
    const all = st.data.rows;
    const rows = arrangeRows(sortRows(visibleRows(all, COLS, st.filters, val), COLS, st.sorts, val), st.collapsed, st.hiddenLevels);   // suboperacje pod operacją główną; zwinięte pomijane
    const startMs = axisStartMs(now.getTime(), st.shift);
    const chart = H.buildChart({ rows, holidays: [], rapData: {} }, { komis: new Set(), station: new Set() }, H.emptySorts(), 0, now, { keepAll: true, axisStartMs: startMs });
    const maxEnd = Math.max(startMs, ...chart.items.filter((it) => it.end).map((it) => it.end.getTime()));
    const cells = buildCells(startMs, maxEnd, st.interval, holidayMap(st.m && st.m.cfg && st.m.cfg.holidays));
    const n = chart.items.length, chartW = Math.ceil(cells.reduce((a, c) => a + c.hours, 0) * HOUR);
    st.rows = rows; st.chart = chart; st.geom = { HOUR, ROW, FONT, HEAD, cols, colW, LEFT, chartW, now };
    info.textContent = `Operacji: ${n}` + (n !== all.length ? ` z ${all.length}` : '') + (st.collapsed.size ? ` (zwinięte: ${st.collapsed.size})` : '');
    scaleLabel.textContent = Math.round(sc * 100) + '%'; if (document.activeElement !== shiftInput) shiftInput.value = String(st.shift);
    for (const [lvl, b] of levelBtns) { const on = !st.hiddenLevels.has(lvl); b.classList.toggle('primary', on); b.style.textDecoration = on ? 'none' : 'line-through'; }
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
    // kolumny osi: dzień roboczy zielony, sobota niebieska, niedziela czerwona, święto bordowe (biała pogrubiona czcionka); tygodnie i miesiące zielone
    let x = 0;
    for (const c of cells) {
      const w = c.hours * HOUR, isNow = now.getTime() >= c.start && now.getTime() < c.end, off = c.kind === 'sat' || c.kind === 'sun' || c.kind === 'holiday';
      const bg = c.kind === 'holiday' ? HOLIDAY_BG : c.kind === 'sun' ? '#ff0000' : c.kind === 'sat' ? '#00b0f0' : '#00b050';
      head.append(h('div', { title: c.kind === 'holiday' ? 'Święto' + (c.holidayName ? ': ' + c.holidayName : '') : '', style: { position: 'absolute', left: x + 'px', top: 0, width: w + 'px', height: HEAD + 'px', background: bg, borderRight: '1px solid #999', borderBottom: '1px solid #999', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
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
    for (let i = from; i < to; i++) {
      const it = chart.items[i], r = it.row;
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
      line.addEventListener('mousedown', () => selectRow(r.id));
      line.addEventListener('contextmenu', (e) => { e.preventDefault(); selectRow(r.id); detail(r); });   // właściwości operacji: prawy przycisk myszy
      g.leftRows.append(line);
      const chartRow = h('div', { onclick: () => selectRow(r.id), ondblclick: () => { if (r.subCount) reorderDialog(r.id); }, oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, style: { position: 'absolute', left: 0, top: i * ROW + 'px', width: g.chartW + 'px', height: ROW + 'px', cursor: 'pointer', boxSizing: 'border-box' } });   // klik w wiersz wykresu
      g.dyn.append(chartRow); g.rowEls.set(r.id, { line, chart: chartRow });
      const bg = done ? ZAK_BAR : parseSheetColor(r.stanowiskoBg, '#cccccc');
      const tip = [r.komis, r.element, r.stanowisko].filter(Boolean).join(' - ') + `\n${r.start} → ${r.koniec}`;
      const label = [r.komis, r.element, r.godziny].filter((v) => String(v).trim()).join(' - ');
      const hoursAt = (ms) => (ms - chart.axisStart.getTime()) / 3600000;
      // każdy pasek wypełniony kolorem stanowiska z czarną ramką; węzeł złożony z dzieci (operacja albo detal) ma jedną czarną ramkę od pierwszego
      // do ostatniego odcinka, a w środku odcinki wszystkich subsuboperacji w kolorach ich stanowisk, oddzielone białymi przerwami (plan i kolejność stanowisk)
      const bar = (left, width, withLabel) => {
        const box = h('div', { title: tip, onclick: () => selectRow(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, ondblclick: () => { if (r.subCount) reorderDialog(r.id); }, style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: left + 'px', top: i * ROW + 2 + 'px', width: width + 'px', height: ROW - 4 + 'px', border: '1px solid #000', boxSizing: 'border-box', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000', background: bg } });
        if (withLabel && label) box.append(h('span', { style: { position: 'absolute', left: '3px', top: Math.max(0, (ROW - 4 - FONT * 1.25) / 2) + 'px', lineHeight: '1.25' } }, label));
        g.dyn.append(box);
      };
      if (r.segs && r.segs.length) {
        const lefts = r.segs.map(([s0]) => Math.max(0, hoursAt(s0)) * HOUR), rights = r.segs.map(([, e0]) => Math.max(0, hoursAt(e0)) * HOUR);
        const L = Math.min(...lefts), W = Math.max(2, Math.max(...rights) - L);
        if (Math.max(...rights) > 0) {
          const box = h('div', { title: tip, onclick: () => selectRow(r.id), oncontextmenu: (e) => { e.preventDefault(); selectRow(r.id); detail(r); }, ondblclick: () => { if (r.subCount) reorderDialog(r.id); }, style: { cursor: 'pointer', position: 'absolute', zIndex: 1, left: L + 'px', top: i * ROW + 2 + 'px', width: W + 'px', height: ROW - 4 + 'px', border: '1px solid #000', boxSizing: 'border-box', background: '#fff', fontSize: FONT + 'px', fontWeight: 700, whiteSpace: 'nowrap', color: '#000' } });
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
  // przesunięcie początku osi względem dziś: „+” przesuwa harmonogram do przodu (przyszłość), „−” cofa (przeszłość); można też wpisać liczbę dni
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
  const hideBtn = h('button', { class: 'btn small primary', title: 'Ukrywa kolumny z listy „Które dane ukrywać” (domyślnie wszystkie poza lp, startem, końcem i stanowiskiem)', onclick: () => { st.compact = !st.compact; lsSet(LS.mode, st.compact); if (st.data) draw(); } }, 'Ukryj dane');
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel', style: { flexWrap: 'wrap' } },
    h('button', { class: 'btn small', title: 'Cofnij harmonogram o dzień (przeszłość)', onclick: () => setShift(st.shift - 1) }, '−'), shiftInput,
    h('button', { class: 'btn small', title: 'Przesuń harmonogram o dzień do przodu', onclick: () => setShift(st.shift + 1) }, '+'), h('span', { class: 'muted' }, 'dni od dziś'),
    h('span', { class: 'muted' }, 'Interwał:'), intervalSel,
    h('button', { class: 'btn small', title: 'Pomniejsz (Ctrl+kółko)', onclick: () => setScale(st.scale / 1.15) }, '−'), scaleLabel, h('button', { class: 'btn small', title: 'Powiększ (Ctrl+kółko)', onclick: () => setScale(st.scale * 1.15) }, '+'),
    hideBtn, h('button', { class: 'btn small', title: 'Wybierz, które kolumny chowa przycisk „Ukryj dane”', onclick: hideDialog }, 'Które dane ukrywać…'),
    h('button', { class: 'btn small', onclick: () => { st.filters = {}; st.sorts = []; if (st.data) draw(); } }, 'Wyczyść filtry'),
    h('span', { class: 'muted' }, 'Poziomy:'), ...levelBtns.values(),
    h('button', { class: 'btn small primary', onclick: () => st.m && addDialog(st.m.opsByLp, stationList(st.m.cfg)) }, 'Dodaj operację'),
    h('button', { class: 'btn small', title: 'Kolory stanowisk, nowe stanowiska i kolory komisów', onclick: stationsDialog }, 'Ustawienia…'),
    h('span', { class: 'grow' }), info,
    h('button', { class: 'btn small', title: 'Pobiera dane wpisane ręcznie z arkusza Harmonogramu do bazy', onclick: importSheet }, 'Import z arkusza'),
    h('button', { class: 'btn', onclick: load }, 'Odśwież')), body);
  load();
}
