import { h, clear, api, apiCached, modal } from '../ui.js';
import * as H from '../logic/harm.js';
import { parseSheetColor } from '../logic/common.js';

const HOUR_PX = 3;      // szerokość godziny na ekranie
const ROW_H = 22;
const HEAD_H = 36;

export function mountHarm(el, ctx) {
  const st = { data: null, filters: { komis: new Set(), station: new Set() }, sorts: H.emptySorts(), daysBack: 3 };
  const body = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0, position: 'relative' } });
  const info = h('span', { class: 'muted' });

  async function load() {
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie harmonogramu…'));
    try { await apiCached('getHarmData', [], (d) => { st.data = d; draw(); }, { timeoutMs: 180000 }); }
    catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: load }, 'Ponów'))); }
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
    const now = H.localNow();
    const chart = H.buildChart(st.data, st.filters, st.sorts, st.daysBack, now);
    const holidays = H.holidaySet(st.data.holidays);
    const width = chart.totalDays * 24 * HOUR_PX;
    const height = HEAD_H + chart.items.length * ROW_H;
    const wrap = h('div', { style: { position: 'relative', width: width + 'px', height: height + 'px' } });
    // Nagłówek: doby
    let x = 0, day = new Date(Date.UTC(chart.axisStart.getUTCFullYear(), chart.axisStart.getUTCMonth(), chart.axisStart.getUTCDate()));
    for (let i = 0; i < chart.totalDays + 1; i++) {
      const w = (i === 0 ? chart.firstDayHours : 24) * HOUR_PX;
      const kind = H.dayKind(day, holidays);
      const bg = kind === 'sun' ? '#ffb3b3' : kind === 'sat' ? '#00b0f0' : '#eee';
      const isToday = day.getTime() === Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      wrap.append(h('div', { style: { position: 'absolute', left: x + 'px', top: 0, width: w + 'px', height: HEAD_H + 'px', background: bg, borderRight: '1px solid #999', borderBottom: '1px solid #999', fontSize: '11px', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: isToday ? 700 : 400 } }, H.dayLabel(day)));
      if (kind !== 'work' || isToday) wrap.append(h('div', { style: { position: 'absolute', left: x + 'px', top: HEAD_H + 'px', width: w + 'px', height: (height - HEAD_H) + 'px', background: isToday ? 'rgba(0,176,80,.18)' : kind === 'sun' ? 'rgba(255,179,179,.25)' : 'rgba(0,176,240,.12)' } }));
      x += w; day = new Date(day.getTime() + 24 * 3600000);
    }
    chart.items.forEach((it, i) => {
      const top = HEAD_H + i * ROW_H;
      const left = it.startHours * HOUR_PX, w = it.durationHours * HOUR_PX;
      const done = String(it.row.zak).trim().toLowerCase().startsWith('zak');
      const bar = h('div', { title: [it.row.komis, it.row.element, it.row.stanowisko].filter(Boolean).join(' - '), onclick: () => detail(it),
        style: { position: 'absolute', left: left + 'px', top: top + 2 + 'px', width: w + 'px', height: ROW_H - 4 + 'px', background: done ? '#93c47d' : parseSheetColor(it.row.stanowiskoBg, '#6d9f3d'), border: '1px solid #000', fontSize: '11px', fontWeight: 700, overflow: 'visible', whiteSpace: 'nowrap', cursor: 'pointer', color: parseSheetColor(it.row.stanowiskoColor, '#000') } },
        h('span', { style: { position: 'absolute', left: '3px', top: '1px' } }, [it.row.komis, it.row.element, it.row.godziny].filter((s) => String(s).trim()).join(' - ')));
      wrap.append(bar);
      for (const s of it.delivery) wrap.append(h('div', { style: { position: 'absolute', left: s.left * HOUR_PX + 'px', top: top + ROW_H - 4 + 'px', width: Math.max(2, s.width * HOUR_PX) + 'px', height: '3px', background: s.kind === 'green' ? '#00b050' : '#f00' } }));
      if (it.pct !== null) wrap.append(h('div', { style: { position: 'absolute', left: left + 'px', top: top + 2 + 'px', width: Math.max(1, w * it.pct / 100) + 'px', height: '4px', background: it.pct <= 100 ? '#00b050' : '#cc2200' } }));
    });
    // Linie zależności
    for (const d of chart.deps) {
      const a = Math.min(d.from, d.to), b = Math.max(d.from, d.to);
      wrap.append(h('div', { style: { position: 'absolute', left: d.x * HOUR_PX + 'px', top: HEAD_H + a * ROW_H + ROW_H / 2 + 'px', width: 0, height: (b - a) * ROW_H + 'px', borderLeft: '1px dashed #555' } }));
    }
    // Linia „teraz”
    const nowX = (now.getTime() - chart.axisStart.getTime()) / 3600000 * HOUR_PX;
    wrap.append(h('div', { style: { position: 'absolute', left: nowX + 'px', top: HEAD_H + 'px', width: 0, height: (height - HEAD_H) + 'px', borderLeft: '2px dashed #ff6600' } }));
    clear(body); body.append(wrap);
    info.textContent = `Operacji: ${chart.items.length}`;
    daysLabel.textContent = st.daysBack + ' dni';
    for (const [k, b] of Object.entries(sortBtns)) b.textContent = { komis: 'Komis', start: 'Start', station: 'Stanowisko' }[k] + (st.sorts[k] === 'asc' ? ' ↑' : st.sorts[k] === 'desc' ? ' ↓' : '');
    fK.classList.toggle('primary', st.filters.komis.size > 0); fS.classList.toggle('primary', st.filters.station.size > 0);
  }

  const daysLabel = h('span', {});
  const sortBtns = {};
  for (const k of ['komis', 'start', 'station']) sortBtns[k] = h('button', { class: 'btn small', onclick: () => { st.sorts = H.cycleSort(st.sorts, k); draw(); } }, k);
  const fK = h('button', { class: 'btn small', onclick: () => openFilter('komis', 'Filtr: komis', st.data.rows.map((r) => r.komis)) }, 'Filtr komis');
  const fS = h('button', { class: 'btn small', onclick: () => openFilter('station', 'Filtr: stanowisko', st.data.rows.map((r) => r.stanowisko)) }, 'Filtr stanowisko');
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' },
    h('button', { class: 'btn small', onclick: () => { if (st.daysBack > 0) { st.daysBack--; draw(); } } }, '−'), daysLabel, h('button', { class: 'btn small', onclick: () => { if (st.daysBack < 30) { st.daysBack++; draw(); } } }, '+'), h('span', { class: 'muted' }, 'dni wstecz'),
    fK, fS, ...Object.values(sortBtns),
    h('button', { class: 'btn small', onclick: () => { st.filters = { komis: new Set(), station: new Set() }; st.sorts = H.emptySorts(); draw(); } }, 'Wyczyść'),
    h('span', { class: 'grow' }), info, h('button', { class: 'btn', onclick: load }, 'Odśwież')), body);
  load();
}
