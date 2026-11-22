// Wybór punktu bazowego płytki na jej rysunku – wspólny dla okna danych płytki w Konturach (ToolBuilder) i edytora płytki.
// Dwa tryby wyświetlania i wyboru: „Na narzędziu” (płytka z transformacją: obrót, kąt, odbicie) i „Standardowo” (pozycja z konturu płytki, bez transformacji);
// rogi skrajne płytki są zawsze liczone z transformacją na narzędziu.
import { h } from '../ui.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const isVertex = (id) => /^p\d/.test(id), isCorner = (id) => String(id).startsWith('k_');

/**
 * o: { mode: 'tool' | 'std', onMode(mode), presets: [{ id, label, pt }] (punkty we współrzędnych konturu płytki, mm),
 *      stdPts: kontur płytki bez transformacji (mm), toolPoly: kontur płytki na narzędziu (mm) albo null, toolPoint(pt) → { x, y } (mm) albo null – punkt po transformacji,
 *      cur: { x, y } | null – bieżący punkt bazowy, defLabel – opis punktu domyślnego, onPick(pt | null) – wybór (null – domyślny; okno zostaje otwarte), onDone() – zatwierdź i zamknij,
 *      onCancel() – cofnij zmiany do pierwotnego wyboru i zamknij }.
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
  holder.addEventListener('click', (ev) => { const pr = find(ev); if (pr) o.onPick({ x: pr.pt.x, y: pr.pt.y }); });   // okno zostaje otwarte – można wybierać wielokrotnie
  const modeBtn = (id, text, tip) => h('button', { class: 'btn small' + (inTool === (id === 'tool') ? ' primary' : ''), title: tip, disabled: id === 'tool' && !o.toolPoly, onclick: () => o.onMode(id) }, text);
  return [
    h('div', { class: 'row', style: { gap: '4px', margin: '4px 0' } }, modeBtn('tool', 'Na narzędziu', 'Płytka tak, jak leży na narzędziu (obrót, kąt, odbicie)'), modeBtn('std', 'Standardowo', 'Płytka w pozycji standardowej (bez transformacji na narzędziu); rogi skrajne – już z transformacją')),
    holder, hint,
    h('div', { class: 'muted', style: { fontSize: '10px' } }, '■ środki i rogi obwiedni · ● punkty konturu · ◆ rogi skrajne (zawsze z transformacją na narzędziu) · ⊕ wybrany. Klikaj punkty do skutku – wybór zmienia się na bieżąco; „Zatwierdź” zamyka okno, Esc cofa wszystko. Wokół punktu bazowego płytka się obraca.'),
    h('div', { class: 'row', style: { gap: '4px', marginTop: '4px', flexWrap: 'wrap' } }, h('button', { class: 'btn small primary', title: 'Zatwierdź wybrany punkt i zamknij okno', onclick: () => o.onDone() }, 'Zatwierdź'),
      h('button', { class: 'btn small', title: o.defLabel, onclick: () => o.onPick(null) }, 'Domyślny'), h('button', { class: 'btn small', title: 'Cofnij wszystkie zmiany i wróć do pierwotnego wyboru (Esc)', onclick: () => o.onCancel() }, 'Cofnij (Esc)')),
  ];
}
/** Nazwa bieżącego punktu bazowego: z listy propozycji, „własny (x; y)” albo opis domyślnego. */
export function baseLabel(presets, cur, defLabel) {
  const p = cur && (presets || []).find((pr) => Math.abs(pr.pt.x - cur.x) < 1e-6 && Math.abs(pr.pt.y - cur.y) < 1e-6);
  return p ? p.label : cur ? `własny (${r3(cur.x)}; ${r3(cur.y)})` : defLabel;
}

/**
 * Wybór punktu obrotu GRUPY płytek (rzędy jeża / frezu płytkowego): w jednym oknie wszystkie płytki z wszystkimi swoimi punktami oraz cztery skrajne punkty grupy (prostokąt).
 * o: { mode: 'cur' | 'main', onMode(mode), polys: [[{x,y}]] – kontury płytek (mm), dots: [{ id, label, x, y, kind: 'vertex' | 'box' }] – punkty płytek (mm),
 *      rect: [{x,y} ×4] – prostokąt skrajny grupy, corners: [{ id, label, x, y }] – jego cztery skrajne punkty, cur: { x, y } | null – bieżący punkt obrotu (stałe miejsce Q),
 *      curLabel, onPick(dot), onDefault(), onDone(), onCancel() }.
 * Tryb skrajnych punktów: „aktualny układ” – prostokąt nieobrócony wokół płytek w bieżącym ułożeniu (dowolny kąt skrawania); „układ główny” – prostokąt wokół układu przy kącie 90°
 * (teoretyczne położenie początkowe), obrócony o kąt skrawania razem z grupą.
 */
export function groupPicker(o) {
  const marks = o.marks || (o.cur ? [o.cur] : []), mc = o.markColor || '#e00000';
  const all = [...o.polys.flat(), ...o.dots, ...o.corners, ...o.rect, ...marks];
  const xs = all.map((v) => v.x), ys = all.map((v) => v.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), W = 340, Hh = 360;
  const sc = Math.min((W - 28) / Math.max(x1 - x0, 1e-6), (Hh - 28) / Math.max(y1 - y0, 1e-6));
  const X = (v) => r3(14 + (v - x0) * sc + (W - 28 - (x1 - x0) * sc) / 2), Y = (v) => r3(14 + (v - y0) * sc + (Hh - 28 - (y1 - y0) * sc) / 2);
  const pg = (poly) => poly.map((v) => `${X(v.x)},${Y(v.y)}`).join(' ');
  const dot = (e, kind) => {
    const cx = X(e.x), cy = Y(e.y);
    const mark = kind === 'corner' ? `<path d="M${cx} ${cy - 6}L${cx + 6} ${cy}L${cx} ${cy + 6}L${cx - 6} ${cy}Z" fill="#7b1fa2" stroke="#fff" stroke-width="1"/>` : kind === 'vertex' ? `<circle cx="${cx}" cy="${cy}" r="3" fill="#1565c0" stroke="#fff" stroke-width="1"/>`
      : `<rect x="${cx - 3}" y="${cy - 3}" width="6" height="6" fill="#fff" stroke="#607d8b" stroke-width="1.3"/>`;
    return `<g data-id="${e.id}" style="cursor:pointer">${mark}<circle cx="${cx}" cy="${cy}" r="8" fill="transparent"/></g>`;
  };
  const sel = marks.map((m) => `<g pointer-events="none"><circle cx="${X(m.x)}" cy="${Y(m.y)}" r="8" fill="none" stroke="${mc}" stroke-width="2.2"/><path d="M${X(m.x) - 12} ${Y(m.y)}H${X(m.x) + 12}M${X(m.x)} ${Y(m.y) - 12}V${Y(m.y) + 12}" stroke="${mc}" stroke-width="1.8"/></g>`).join('');
  const holder = h('div', { style: { border: '1px solid #ccc', background: '#fff', lineHeight: 0, width: W + 'px' } });
  holder.innerHTML = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg">${o.polys.map((p) => `<polygon points="${pg(p)}" fill="#c8a400" fill-opacity=".5" stroke="#8a6d00" stroke-width="1.3"/>`).join('')}`
    + `${o.rect.length ? `<polygon points="${pg(o.rect)}" fill="none" stroke="#7b1fa2" stroke-width="1.2" stroke-dasharray="5 3"/>` : ''}${o.dots.map((e) => dot(e, e.kind)).join('')}${o.corners.map((e) => dot(e, 'corner')).join('')}${sel}</svg>`;
  const hint = h('div', { class: 'muted', style: { fontSize: '11px', minHeight: '28px', lineHeight: '1.3' } }, `${o.hintPrefix || 'Punkt obrotu grupy'}: ${o.curLabel}`);
  const find = (ev) => { const g = ev.target.closest && ev.target.closest('[data-id]'); const id = g && g.getAttribute('data-id'); return id && [...o.dots, ...o.corners].find((e) => e.id === id); };
  holder.addEventListener('pointerover', (ev) => { const e = find(ev); if (e) hint.textContent = e.label; });
  holder.addEventListener('click', (ev) => { const e = find(ev); if (e) o.onPick(e); });
  const modeBtn = (id, text, tip) => h('button', { class: 'btn small' + (o.mode === id ? ' primary' : ''), title: tip, onclick: () => o.onMode(id) }, text);
  return [
    ...(o.mode === undefined ? [] : [h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Skrajne punkty grupy (◆):')]),
    o.mode === undefined ? null : h('div', { class: 'row', style: { gap: '4px', margin: '3px 0' } }, modeBtn('cur', 'Aktualny układ', 'Prostokąt nieobrócony wokół płytek w bieżącym ułożeniu (płytki obrócone w grupie i lokalnie), dowolny kąt skrawania'),
      modeBtn('main', 'Układ główny', 'Prostokąt wokół układu przy kącie 90° (teoretyczne położenie początkowe), obrócony o kąt skrawania')),
    holder, hint,
    h('div', { class: 'muted', style: { fontSize: '10px' } }, o.legend || '■ środki i rogi obwiedni płytek · ● punkty konturów · ◆ skrajne punkty grupy (prostokąt) · czerwony ⊕ – punkt obrotu grupy. Klikaj punkty do skutku; „Zatwierdź” zamyka okno, Esc cofa wszystko.'),
    h('div', { class: 'row', style: { gap: '4px', marginTop: '4px', flexWrap: 'wrap' } }, h('button', { class: 'btn small primary', onclick: () => o.onDone() }, 'Zatwierdź'),
      h('button', { class: 'btn small', title: o.defTitle || 'Bez własnego punktu: grupa obraca się wokół punktu odniesienia pierwszej płytki', onclick: () => o.onDefault() }, 'Domyślny'), h('button', { class: 'btn small', title: 'Cofnij wszystkie zmiany i wróć do pierwotnego wyboru (Esc)', onclick: () => o.onCancel() }, 'Cofnij (Esc)')),
  ].filter(Boolean);
}
/**
 * Esc przy otwartym wyborze punktu cofa zmiany (nie zamyka okna nadrzędnego): nasłuch na oknie w fazie przechwytywania, więc wyprzedza obsługę Esc okien Kontur i edytora.
 * [el] – element okna (nasłuch sam się usuwa po jego odłączeniu), [isOpen]() – czy wybór jest otwarty, [onEsc]() – cofnięcie.
 */
export function escGuard(el, isOpen, onEsc) {
  const fn = (e) => {
    if (!el.isConnected) { window.removeEventListener('keydown', fn, true); return; }
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); onEsc(); }
  };
  window.addEventListener('keydown', fn, true);
}
