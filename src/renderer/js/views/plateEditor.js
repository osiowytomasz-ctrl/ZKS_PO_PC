// Pełny edytor płytki skrawającej (Narzędziownia → Kontury: kliknięcie w płytkę; Części): kontur płytki jako wielokąt (tabela punktów + rysunek
// z przeciąganiem), parametry 3D (liczba płytek, pochylenie / opad, grubość), położenie w narzędziu i podgląd 3D samej płytki.
// Zapis do arkusza PL_kontur (kolumna G, ścieżka SVG w mm) – MASTER / GOD; inaczej „Zastosuj” (podgląd w programie) i „Kopiuj SVG”.
import { h, clear, toast, modal } from '../ui.js';
import * as P from '../logic/plateEdit.js';
import { view3d } from './toolViews.js';

const DEFAULT_PLATE = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }];
const STEPS = [['0', 'bez siatki'], ['0.01', '0,01 mm'], ['0.02', '0,02 mm'], ['0.05', '0,05 mm'], ['0.1', '0,1 mm'], ['0.2', '0,2 mm'], ['0.5', '0,5 mm'], ['1', '1 mm'], ['custom', 'własny…']];
const f2 = (v) => v.toFixed(2);
const comma = (v) => String(Math.round(v * 1000) / 1000).replace('.', ',');
const num = (t) => Number(String(t).replace(',', '.'));

/**
 * o: { code, path (SVG mm), tool (kod narzędzia – opis), setup: { z, draft, thickness }, plate: { mode: auto|central|edge, dx, dz, ang, phi, z } | null,
 *      autoCentral (czy tryb „automatycznie” daje płytkę centralną), canSave, save: async (code, path) => void | null,
 *      onApply: ({ path, setup, plate }) => void }.
 */
export function openPlateEditor(o) {
  const orig = P.parsePlate(o.path);
  const st = { pts: orig.pts.length >= 3 ? orig.pts : DEFAULT_PLATE.map((p) => ({ ...p })), sel: 0, step: 0.1, hist: [], zoom: 1, pan: { x: 0, y: 0 }, view: null, drag: null,
    setup: { z: 2, draft: 7, thickness: 0, ...(o.setup || {}) }, plate: o.plate ? { mode: 'auto', dx: 0, dz: 0, ang: 0, phi: 0, z: 0, ...o.plate } : null, busy: false };
  const isCentral = () => (st.plate ? (st.plate.mode === 'central' ? true : st.plate.mode === 'edge' || st.plate.mode === 'irregular' ? false : !!o.autoCentral) : !!o.autoCentral);
  const status = h('div', { class: 'status-line', style: { minHeight: '18px' } });
  const say = (t, kind) => { status.textContent = t || ''; status.style.color = kind === 'error' ? '#c62828' : kind === 'neutral' ? '#666' : '#1b5e20'; };

  // ---------- rysunek 2D: siatka, wielokąt, punkty (przeciąganie), uchwyty odcinków (dodanie punktu), przesuwanie tła, powiększanie kółkiem ----------
  const W = 640, H = 520;
  const canvas = h('div', { style: { flex: 1, minHeight: '360px', border: '1px solid #bbb', background: '#fff', position: 'relative', touchAction: 'none' } });
  const fit = () => {
    const b = P.plateBounds(st.pts), s = Math.min((W - 80) / Math.max(b.w, 0.5), (H - 80) / Math.max(b.h, 0.5));
    st.view = { s: s * st.zoom, ox: W / 2 - b.cx * s * st.zoom + st.pan.x, oy: H / 2 - b.cy * s * st.zoom + st.pan.y, fit: s, b };
  };
  const X = (x) => st.view.ox + x * st.view.s, Y = (y) => st.view.oy + y * st.view.s;
  const stepVal = () => st.step;
  function drawCanvas() {
    if (!st.view || !st.drag) fit();   // widok zamrożony w czasie przeciągania punktu
    const v = st.view, n = st.pts.length;
    const gs = st.step > 0 ? st.step : [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find((q) => (W / v.s) / q <= 24) || 10;
    const x0 = (0 - v.ox) / v.s, x1 = (W - v.ox) / v.s, y0 = (0 - v.oy) / v.s, y1 = (H - v.oy) / v.s;
    let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block">`;
    const major = (g) => (Math.abs(Math.round(g / (gs * 5)) * gs * 5 - g) < gs * 1e-3);
    if ((x1 - x0) / gs < 300 && (y1 - y0) / gs < 300) {   // przy bardzo drobnym kroku na całym widoku – bez linii siatki
      for (let g = Math.ceil(x0 / gs) * gs; g <= x1; g += gs) out += `<line x1="${f2(X(g))}" y1="0" x2="${f2(X(g))}" y2="${H}" stroke="${major(g) ? '#d8d8d8' : '#eee'}" stroke-width="${major(g) ? 1 : 0.5}"/>`;
      for (let g = Math.ceil(y0 / gs) * gs; g <= y1; g += gs) out += `<line x1="0" y1="${f2(Y(g))}" x2="${W}" y2="${f2(Y(g))}" stroke="${major(g) ? '#d8d8d8' : '#eee'}" stroke-width="${major(g) ? 1 : 0.5}"/>`;
    }
    out += `<line x1="${f2(X(0))}" y1="0" x2="${f2(X(0))}" y2="${H}" stroke="#c33" stroke-width="0.8"/><line x1="0" y1="${f2(Y(0))}" x2="${W}" y2="${f2(Y(0))}" stroke="#36c" stroke-width="0.8"/>`;
    const pl = st.pts.map((p) => f2(X(p.x)) + ',' + f2(Y(p.y))).join(' ');
    out += `<polygon points="${pl}" fill="#c8a400" fill-opacity="0.75" stroke="#5d4a00" stroke-width="1.5" pointer-events="none"/>`;
    for (let i = 0; i < n; i++) {   // uchwyty odcinków (kliknięcie – nowy punkt w środku odcinka)
      const a = st.pts[i], b = st.pts[(i + 1) % n], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      out += `<rect data-s="${i}" x="${f2(X(mx) - 4)}" y="${f2(Y(my) - 4)}" width="8" height="8" fill="#fff" stroke="#1565c0" stroke-width="1" style="cursor:copy"><title>Dodaj punkt w środku odcinka</title></rect>`;
    }
    for (let i = 0; i < n; i++) {
      const p = st.pts[i], on = i === st.sel;
      out += `<circle data-i="${i}" cx="${f2(X(p.x))}" cy="${f2(Y(p.y))}" r="${on ? 6 : 4.5}" fill="${on ? '#ff6d00' : '#1565c0'}" stroke="#fff" stroke-width="1" style="cursor:move"/>`
        + `<text x="${f2(X(p.x) + 8)}" y="${f2(Y(p.y) - 7)}" font-size="11" fill="#333" pointer-events="none">${i + 1}</text>`;
    }
    const b = st.view.b;
    out += `<text x="8" y="${H - 8}" font-size="11" fill="#666" pointer-events="none">siatka ${String(gs).replace('.', ',')} mm · wymiary ${comma(b.w)} × ${comma(b.h)} mm</text></svg>`;
    canvas.innerHTML = out;
  }
  const svgPoint = (e) => {
    const svg = canvas.querySelector('svg'); if (!svg) return null;
    const q = svg.createSVGPoint(); q.x = e.clientX; q.y = e.clientY;
    return { m: q.matrixTransform(svg.getScreenCTM().inverse()), k: svg.getScreenCTM().a };
  };
  const toMm = (e) => { const r = svgPoint(e); return r ? { x: (r.m.x - st.view.ox) / st.view.s, y: (r.m.y - st.view.oy) / st.view.s } : null; };
  const snapPt = (p) => ({ x: P.snap(p.x, st.step), y: P.snap(p.y, st.step) });
  const push = () => { st.hist.push(JSON.stringify(st.pts)); if (st.hist.length > 100) st.hist.shift(); };
  canvas.addEventListener('pointerdown', (e) => {
    const t = e.target.closest ? e.target : null, pi = t && t.closest('[data-i]'), si = t && t.closest('[data-s]');
    if (pi) { st.sel = Number(pi.dataset.i); push(); st.drag = { kind: 'pt' }; }
    else if (si) { push(); st.pts = P.insertAfter(st.pts, Number(si.dataset.s)); st.sel = Number(si.dataset.s) + 1; st.drag = { kind: 'pt' }; drawTable(); }
    else { const r = svgPoint(e); st.drag = { kind: 'pan', from: { x: e.clientX, y: e.clientY }, pan0: { ...st.pan }, k: r ? r.k : 1 }; }
    canvas.setPointerCapture(e.pointerId); e.preventDefault(); drawCanvas(); markRows();
  });
  canvas.addEventListener('pointermove', (e) => {
    const d = st.drag; if (!d) return;
    if (d.kind === 'pan') { st.pan = { x: d.pan0.x + (e.clientX - d.from.x) / d.k, y: d.pan0.y + (e.clientY - d.from.y) / d.k }; st.view = null; st.drag = d; fit(); drawCanvas(); return; }
    const p = toMm(e); if (!p) return;
    st.pts[st.sel] = snapPt(p); drawCanvas(); fillRow(st.sel); schedule3d();
  });
  canvas.addEventListener('pointerup', () => { const d = st.drag; st.drag = null; if (d && d.kind === 'pt') { drawTable(); schedule3d(); } });
  canvas.addEventListener('wheel', (e) => {   // powiększenie wokół kursora
    e.preventDefault();
    const p = toMm(e), r = svgPoint(e); if (!p || !r) return;
    st.zoom = Math.max(0.2, Math.min(200, st.zoom * Math.pow(1.0018, -e.deltaY)));
    const b = P.plateBounds(st.pts), s2 = st.view.fit * st.zoom;
    st.pan = { x: r.m.x - W / 2 + b.cx * s2 - p.x * s2 - 0, y: r.m.y - H / 2 + b.cy * s2 - p.y * s2 - 0 };
    st.view = null; drawCanvas();
  }, { passive: false });

  // ---------- tabela punktów ----------
  const tbody = h('tbody', {});
  const inputs = [];
  function drawTable() {
    clear(tbody); inputs.length = 0;
    st.pts.forEach((p, i) => {
      const mk = (key) => { const inp = h('input', { type: 'text', value: comma(p[key]), style: { width: '70px', padding: '1px 4px' }, onfocus: () => { st.sel = i; markRows(); drawCanvas(); },
        onchange: () => { const v = num(inp.value); if (!Number.isFinite(v)) { inp.value = comma(st.pts[i][key]); return; } push(); st.pts[i] = { ...st.pts[i], [key]: P.snap(v, 0) }; st.view = null; drawCanvas(); schedule3d(); } }); return inp; };
      const x = mk('x'), y = mk('y'); inputs[i] = { x, y };
      tbody.append(h('tr', { 'data-row': i, style: { background: i === st.sel ? '#fff3e0' : '' } }, h('td', {}, String(i + 1)), h('td', {}, x), h('td', {}, y),
        h('td', {}, h('button', { class: 'btn small', title: 'Wyżej', onclick: () => { push(); st.pts = P.moveIndex(st.pts, i, -1); st.sel = Math.max(0, i - 1); drawTable(); drawCanvas(); schedule3d(); } }, '↑'),
          h('button', { class: 'btn small', title: 'Niżej', onclick: () => { push(); st.pts = P.moveIndex(st.pts, i, 1); st.sel = Math.min(st.pts.length - 1, i + 1); drawTable(); drawCanvas(); schedule3d(); } }, '↓'),
          h('button', { class: 'btn small', title: 'Dodaj punkt po tym punkcie (w środku odcinka)', onclick: () => { push(); st.pts = P.insertAfter(st.pts, i); st.sel = i + 1; drawTable(); drawCanvas(); schedule3d(); } }, '+'),
          h('button', { class: 'btn small', title: 'Usuń punkt (min. 3)', onclick: () => { if (st.pts.length <= 3) { say('Płytka musi mieć co najmniej 3 punkty.', 'error'); return; } push(); st.pts = P.removeAt(st.pts, i); st.sel = Math.min(st.sel, st.pts.length - 1); drawTable(); drawCanvas(); schedule3d(); } }, '✕'))));
    });
  }
  const markRows = () => tbody.querySelectorAll('tr').forEach((tr) => { tr.style.background = Number(tr.dataset.row) === st.sel ? '#fff3e0' : ''; });
  const fillRow = (i) => { const r = inputs[i]; if (r) { r.x.value = comma(st.pts[i].x); r.y.value = comma(st.pts[i].y); } };
  const act = (fn) => () => { push(); st.pts = fn(st.pts); st.view = null; drawTable(); drawCanvas(); schedule3d(); check(); };
  const undo = () => { const last = st.hist.pop(); if (!last) return; st.pts = JSON.parse(last); st.sel = Math.min(st.sel, st.pts.length - 1); st.view = null; drawTable(); drawCanvas(); schedule3d(); };
  const rotI = h('input', { type: 'text', value: '90', style: { width: '48px', padding: '1px 4px' } }), scaleI = h('input', { type: 'text', value: '100', style: { width: '48px', padding: '1px 4px' } });
  const customStep = h('input', { type: 'text', value: '0,03', title: 'Własny krok siatki i przyciągania, mm', style: { width: '56px', display: 'none', padding: '1px 4px' }, oninput: () => { const v = num(customStep.value); if (v > 0) { st.step = v; drawCanvas(); } } });
  const stepSel = h('select', { onchange: () => { const c = stepSel.value === 'custom'; customStep.style.display = c ? '' : 'none'; st.step = c ? (num(customStep.value) > 0 ? num(customStep.value) : 0.03) : Number(stepSel.value); drawCanvas(); } },
    ...STEPS.map(([v, l]) => h('option', { value: v, selected: v === '0.1' }, l)));
  const warn = h('div', { style: { fontSize: '12px', color: '#b26a00', minHeight: '16px' } });
  const check = () => { const t = []; if (orig.hasArcs && !st.arcOk) t.push('Kontur z arkusza miał łuki – w edytorze są odcinkami (zapis zastąpi łuki odcinkami).'); if (P.selfIntersects(st.pts)) t.push('Kontur przecina sam siebie – bryła 3D może być nieprawidłowa.'); warn.textContent = t.join(' '); };

  // ---------- parametry 3D i położenie ----------
  const field = (label, value, onSet, unit = '', w = '64px') => { const inp = h('input', { type: 'text', value: comma(value), style: { width: w, padding: '1px 4px' }, onchange: () => { const v = num(inp.value); if (Number.isFinite(v)) { onSet(v); schedule3d(); } else inp.value = comma(value); } }); return h('label', { class: 'row', style: { gap: '4px', margin: '2px 0', alignItems: 'center' } }, h('span', { style: { width: '110px' } }, label), inp, h('span', { class: 'muted' }, unit)); };
  const kindNote = h('div', { class: 'muted', style: { fontSize: '12px' } });
  const paintNote = () => { kindNote.textContent = st.plate && st.plate.mode === 'irregular' ? 'Płytka nieregularna (np. wiertło płytkowe Komet): jedna płytka w dowolnym miejscu – ustaw ΔX, ΔZ, obrót i kąt na obwodzie.' : isCentral() ? 'Płytka centralna (wiertło ISCAR / AMEC): jedna na osi narzędzia, opad na obie strony.' : 'Płytka obwodowa (frez): z kopii co 360° / z, przyłożenie z tyłu.'; };
  const modeSel = st.plate ? h('select', { onchange: () => { st.plate.mode = modeSel.value; paintNote(); paintParams(); schedule3d(); } }, ...[['auto', 'automatycznie'], ['central', 'centralna (na osi narzędzia)'], ['edge', 'obwodowa (przy krawędzi)'], ['irregular', 'nieregularna (dowolne położenie)']].map(([v, l]) => h('option', { value: v, selected: st.plate.mode === v }, l))) : null;
  const params = h('div', { style: { border: '1px solid #ddd', padding: '6px', margin: '6px 0' } });
  function paintParams() {
    clear(params);
    params.append(h('b', {}, 'Płytka w narzędziu (3D)'),
      modeSel ? h('label', { class: 'row', style: { gap: '4px', margin: '2px 0', alignItems: 'center' } }, h('span', { style: { width: '110px' } }, 'Rodzaj płytki'), modeSel) : null, kindNote,
      isCentral() || (st.plate && st.plate.mode === 'irregular') ? null : field('Liczba płytek z', st.plate && st.plate.z ? st.plate.z : st.setup.z, (v) => { const z = Math.max(1, Math.min(60, Math.round(v))); if (st.plate) st.plate.z = z; else st.setup.z = z; }, 'szt. (na obwodzie)'),
      field(isCentral() ? 'Opad na obie strony' : 'Pochylenie ścian', st.setup.draft, (v) => { st.setup.draft = Math.max(0, Math.min(30, v)); }, '°'),
      field('Grubość płytki', st.setup.thickness, (v) => { st.setup.thickness = Math.max(0, Math.min(30, v)); }, 'mm (0 – auto)'));
  }
  const place = st.plate ? h('div', { style: { border: '1px solid #ddd', padding: '6px', margin: '6px 0' } }, h('b', {}, 'Położenie w narzędziu' + (o.tool ? ` (${o.tool})` : '')),
    field('Korekta ΔX', st.plate.dx, (v) => { st.plate.dx = v; }, 'mm'), field('Korekta ΔZ', st.plate.dz, (v) => { st.plate.dz = v; }, 'mm (wzdłuż osi, w górę)'), field('Obrót płytki', st.plate.ang, (v) => { st.plate.ang = v; }, '°'),
    field('Kąt na obwodzie φ', st.plate.phi, (v) => { st.plate.phi = v; }, '° (obrót wokół osi narzędzia, 3D)')) : null;
  paintNote(); paintParams();

  // ---------- podgląd 3D samej płytki ----------
  const view3 = h('div', { style: { flex: 1, minHeight: '300px', border: '1px solid #bbb', background: '#fafafa' } });
  let t3 = 0;
  function render3d() {
    clear(view3);
    const poly = P.previewPoly(st.pts);
    view3.append(view3d(null, [{ poly, z: 1, draft: st.setup.draft, thickness: st.setup.thickness, central: isCentral(), alone: true }]));
  }
  function schedule3d() { clearTimeout(t3); t3 = setTimeout(render3d, 300); check(); }

  // ---------- zapis ----------
  const result = () => ({ path: P.plateToPath(st.pts), setup: { z: st.setup.z, draft: st.setup.draft, thickness: st.setup.thickness }, plate: st.plate ? { ...st.plate } : null });
  const copy = async () => { try { const t = P.plateToPath(st.pts); await (window.zks && window.zks.copyText ? window.zks.copyText(t) : navigator.clipboard.writeText(t)); toast('Skopiowano kontur płytki (SVG)'); } catch (e) { toast(e.message, true); } };
  const apply = () => { o.onApply(result()); m.close(); };
  const saveBtn = o.save ? h('button', { class: 'btn primary', disabled: !o.canSave, title: o.canSave ? 'Zapisuje kontur do arkusza PL_kontur (kolumna G) – dla wszystkich użytkowników' : 'Zapis do arkusza – poziom MASTER lub GOD', onclick: async () => {
    if (st.busy) return;
    if (P.plateToPath(st.pts) === '') { say('Kontur ma za mało punktów.', 'error'); return; }
    st.busy = true; saveBtn.disabled = true; say('Zapisywanie do arkusza PL_kontur…', 'neutral');
    try { await o.save(o.code, P.plateToPath(st.pts)); o.onApply({ ...result(), saved: true }); m.close(); toast('Kontur płytki zapisany w arkuszu PL_kontur'); }
    catch (e) {
      st.busy = false; saveBtn.disabled = !o.canSave;
      say(e && e.code === 'UNKNOWN_FN' ? 'Serwer nie ma jeszcze funkcji zapisu płytek (plSaveContour). Wklej backend (Api.gs, Kontury.gs), opublikuj nową wersję – a do tego czasu użyj „Kopiuj SVG” i wklej kontur w kolumnie G arkusza PL_kontur.' : 'Nie zapisano: ' + (e && e.message ? e.message : e), 'error');
    }
  } }, 'Zapisz do arkusza') : null;

  const content = h('div', { class: 'fs-dialog' },
    h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0, flex: 1 } }, `Edytor płytki – ${o.code}`), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Ctrl+Z – cofnij'),
      h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij')),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(320px, 380px) minmax(380px, 1fr) minmax(300px, 380px)', gap: '10px', flex: 1, minHeight: 0 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' } },
        h('b', {}, 'Punkty konturu (mm)'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'X w prawo, Y w dół (jak w arkuszu PL_kontur, kolumna G).'),
        h('div', { class: 'table-wrap', style: { maxHeight: '220px', margin: '4px 0' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Lp'), h('th', {}, 'X'), h('th', {}, 'Y'), h('th', {}, ''))), tbody)),
        h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } },
          h('button', { class: 'btn small', onclick: act(P.mirrorX) }, 'Odbij X'), h('button', { class: 'btn small', onclick: act(P.mirrorY) }, 'Odbij Y'),
          h('button', { class: 'btn small', onclick: act(P.toOrigin), title: 'Lewy górny róg obwiedni w (0, 0)' }, 'Do (0,0)'),
          h('button', { class: 'btn small', onclick: undo }, '↶ Cofnij')),
        h('div', { class: 'row', style: { gap: '4px', margin: '4px 0', alignItems: 'center' } }, h('button', { class: 'btn small', onclick: () => { const v = num(rotI.value); if (Number.isFinite(v)) act((p) => P.rotate(p, v))(); } }, 'Obróć o'), rotI, '°',
          h('button', { class: 'btn small', onclick: () => { const v = num(scaleI.value); if (v > 0) act((p) => P.scale(p, v))(); } }, 'Skaluj'), scaleI, '%'),
        h('div', { class: 'row', style: { gap: '4px', margin: '4px 0', alignItems: 'center' } }, h('span', {}, 'Krok siatki / przyciągania:'), stepSel, customStep),
        warn, params, place, status,
        h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '6px' } }, saveBtn, h('button', { class: 'btn' + (saveBtn ? '' : ' primary'), onclick: apply, title: 'Używa konturu i parametrów w podglądach programu (kontur tylko na tym komputerze do odświeżenia katalogu)' }, 'Zastosuj'),
          h('button', { class: 'btn', onclick: copy }, 'Kopiuj SVG'), h('button', { class: 'btn', onclick: () => { push(); st.pts = P.parsePlate(o.path).pts; if (st.pts.length < 3) st.pts = DEFAULT_PLATE.map((p) => ({ ...p })); st.view = null; drawTable(); drawCanvas(); schedule3d(); } }, 'Przywróć z arkusza'))),
      h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Rysunek: przeciągnij punkt · kliknij kwadrat na odcinku, aby dodać punkt · kółko – powiększenie · przeciągnięcie tła – przesuwanie'), canvas),
      h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Podgląd 3D płytki – przeciągnij, aby obrócić; kółko: przybliżenie'), view3)));
  const m = modal(null, content, { wide: true, sticky: true });
  m.root.classList.add('fs');
  const onKey = (e) => { if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !(e.target && e.target.tagName === 'INPUT')) { e.preventDefault(); undo(); } if (!m.root.isConnected) document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  drawTable(); fit(); drawCanvas(); render3d(); check();
  return m;
}
