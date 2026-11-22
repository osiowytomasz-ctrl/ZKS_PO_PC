// Wybór punktu bazowego płytki na jej rysunku – wspólny dla okna danych płytki w Konturach (ToolBuilder) i edytora płytki.
// Dwa tryby wyświetlania i wyboru: „Na narzędziu” (płytka z transformacją: obrót, kąt, odbicie) i „Standardowo” (pozycja z konturu płytki, bez transformacji);
// rogi skrajne płytki są zawsze liczone z transformacją na narzędziu.
import { h } from '../ui.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const isVertex = (id) => /^p\d/.test(id), isCorner = (id) => String(id).startsWith('k_');

/**
 * o: { mode: 'tool' | 'std', onMode(mode), presets: [{ id, label, pt }] (punkty we współrzędnych konturu płytki, mm),
 *      stdPts: kontur płytki bez transformacji (mm), toolPoly: kontur płytki na narzędziu (mm) albo null, toolPoint(pt) → { x, y } (mm) albo null – punkt po transformacji,
 *      cur: { x, y } | null – bieżący punkt bazowy, defLabel – opis punktu domyślnego, onPick(pt | null) – wybór (null – domyślny), onBack() – powrót }.
 * Wynik: lista elementów (przełącznik trybu, rysunek z punktami, podpowiedź, legenda, przyciski).
 */
export function basePicker(o) {
  const inTool = o.mode !== 'std' && !!o.toolPoly, presets = o.presets || [];
  const same = (pr) => !!o.cur && Math.abs(pr.pt.x - o.cur.x) < 1e-6 && Math.abs(pr.pt.y - o.cur.y) < 1e-6;
  const curPreset = presets.find(same), curLabel = curPreset ? curPreset.label : o.cur ? `własny (${r3(o.cur.x)}; ${r3(o.cur.y)})` : o.defLabel;
  let poly, pts;
  if (inTool) { poly = o.toolPoly; pts = presets.map((pr) => ({ pr, p: o.toolPoint(pr.pt) })).filter((e) => e.p).map((e) => ({ pr: e.pr, x: e.p.x, y: e.p.y })); }
  else { poly = o.stdPts || []; pts = presets.map((pr) => ({ pr, x: pr.pt.x, y: pr.pt.y })); }
  const xs = [...poly.map((v) => v.x), ...pts.map((v) => v.x)], ys = [...poly.map((v) => v.y), ...pts.map((v) => v.y)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), W = 224, Hh = 230, sc = Math.min((W - 24) / Math.max(x1 - x0, 1e-6), (Hh - 24) / Math.max(y1 - y0, 1e-6));
  const X = (v) => r3(12 + (v - x0) * sc + (W - 24 - (x1 - x0) * sc) / 2), Y = (v) => r3(12 + (v - y0) * sc + (Hh - 24 - (y1 - y0) * sc) / 2);
  const order = [...pts.filter((e) => !isVertex(e.pr.id) && !isCorner(e.pr.id)), ...pts.filter((e) => isVertex(e.pr.id)), ...pts.filter((e) => isCorner(e.pr.id))];
  const dots = order.map((e) => {
    const cx = X(e.x), cy = Y(e.y), on = same(e.pr), k = isCorner(e.pr.id), v = isVertex(e.pr.id);
    const mark = on ? `<circle cx="${cx}" cy="${cy}" r="7" fill="#fff" stroke="#2e7d32" stroke-width="2"/><path d="M${cx - 10} ${cy}H${cx + 10}M${cx} ${cy - 10}V${cy + 10}" stroke="#2e7d32" stroke-width="2"/>`
      : k ? `<path d="M${cx} ${cy - 5}L${cx + 5} ${cy}L${cx} ${cy + 5}L${cx - 5} ${cy}Z" fill="#ef6c00" stroke="#fff" stroke-width="1"/>` : v ? `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#1565c0" stroke="#fff" stroke-width="1"/>` : `<rect x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7" fill="#fff" stroke="#607d8b" stroke-width="1.5"/>`;
    return `<g data-id="${e.pr.id}" style="cursor:pointer">${mark}<circle cx="${cx}" cy="${cy}" r="9" fill="transparent"/></g>`;
  }).join('');
  const holder = h('div', { style: { border: '1px solid #ccc', background: '#fff', lineHeight: 0, width: W + 'px' } });
  holder.innerHTML = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg"><polygon points="${poly.map((v) => `${X(v.x)},${Y(v.y)}`).join(' ')}" fill="#c8a400" fill-opacity=".55" stroke="#8a6d00" stroke-width="1.5"/>${dots}</svg>`;
  const hint = h('div', { class: 'muted', style: { fontSize: '11px', minHeight: '28px', lineHeight: '1.3' } }, `Wybrany: ${curLabel}`);
  const find = (ev) => { const g = ev.target.closest && ev.target.closest('[data-id]'); return g && presets.find((x) => x.id === g.getAttribute('data-id')); };
  holder.addEventListener('pointerover', (ev) => { const pr = find(ev); if (pr) hint.textContent = pr.label; });
  holder.addEventListener('click', (ev) => { const pr = find(ev); if (pr) o.onPick({ x: pr.pt.x, y: pr.pt.y }); });
  const modeBtn = (id, text, tip) => h('button', { class: 'btn small' + (inTool === (id === 'tool') ? ' primary' : ''), title: tip, disabled: id === 'tool' && !o.toolPoly, onclick: () => o.onMode(id) }, text);
  return [
    h('div', { class: 'row', style: { gap: '4px', margin: '4px 0' } }, modeBtn('tool', 'Na narzędziu', 'Płytka tak, jak leży na narzędziu (obrót, kąt, odbicie)'), modeBtn('std', 'Standardowo', 'Płytka w pozycji standardowej (bez transformacji na narzędziu); rogi skrajne – już z transformacją')),
    holder, hint,
    h('div', { class: 'muted', style: { fontSize: '10px' } }, '■ środki i rogi obwiedni · ● punkty konturu · ◆ rogi skrajne (zawsze z transformacją na narzędziu) · ⊕ wybrany. Kliknij punkt. Wokół punktu bazowego płytka się obraca.'),
    h('div', { class: 'row', style: { gap: '4px', marginTop: '4px' } }, h('button', { class: 'btn small', title: o.defLabel, onclick: () => o.onPick(null) }, 'Domyślny'), h('button', { class: 'btn small', onclick: () => o.onBack() }, 'Wróć')),
  ];
}
/** Nazwa bieżącego punktu bazowego: z listy propozycji, „własny (x; y)” albo opis domyślnego. */
export function baseLabel(presets, cur, defLabel) {
  const p = cur && (presets || []).find((pr) => Math.abs(pr.pt.x - cur.x) < 1e-6 && Math.abs(pr.pt.y - cur.y) < 1e-6);
  return p ? p.label : cur ? `własny (${r3(cur.x)}; ${r3(cur.y)})` : defLabel;
}
