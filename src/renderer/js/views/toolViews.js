// Wspólne elementy Narzędziowni na PC – wygląd jak w aplikacji na Androida (ui/common/ToolRows.kt, ui/tools/ToolViews.kt):
// wiersz narzędzia (kod na pasku zużycia z kolorem lokalizacji, opis i parametry, miniatura), rysunek zestawu 2D, podgląd 3D,
// tabela części, okno na cały ekran i lista rozwijana filtra.
import { h, clear, modal } from '../ui.js';
import { parseSheetColor } from '../logic/common.js';
import * as T from '../logic/tooltrack.js';
import * as G from '../logic/toolGeometry.js';
import { view3dGl } from './tool3d.js';

// ---------- kolory lokalizacji z kolorów stanowisk (Ustawienia programu) i wygląd ramki ----------
let STATIONS = null;
/** Stanowiska z config/main (stationList) – kolory lokalizacji narzędzi jak w Ustawieniach programu. */
export function setToolStations(list) { STATIONS = list || null; }
const LOC_ALIAS = [['schiess', 'si'], ['union', 'un'], ['correa', 'co'], ['narzędziownia', 'narz'], ['narzedziownia', 'narz'], ['ślusar', 'śl'], ['dodatk', 'do']];
const abbr = (name) => String(name || '').replace(/^\d+/, '').toLowerCase();
/** Kolor lokalizacji: stanowisko o pasującym skrócie (Union → 2Un, Correa → 3Co, Schiess → 1Si, Narzędziownia → Narz), inaczej dawne kolory. */
export function locColor(location) {
  const l = T.norm(location);
  if (!l) return null;
  if (STATIONS) {
    for (const [k, a] of LOC_ALIAS) if (l.includes(k)) { const st = STATIONS.find((x) => abbr(x.name) === a); if (st) return st.bg; }
    const st = STATIONS.find((x) => { const a = abbr(x.name); return a.length >= 2 && l.startsWith(a); });
    if (st) return st.bg;
  }
  return T.locationColor(location);
}
const LS_LOOK = 'zks.tools.look';
/** Wygląd narzędzi (ten komputer): ramka w kolorze lokalizacji, poświata (glow) i jej kolor („loc” = kolor lokalizacji). */
export function toolLook() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(LS_LOOK) || '{}') || {}; } catch { v = {}; }
  return { frame: v.frame !== false, glow: !!v.glow, glowColor: v.glowColor || 'loc', gen: !!v.gen };
}
export function setToolLook(patch) { try { localStorage.setItem(LS_LOOK, JSON.stringify({ ...toolLook(), ...patch })); } catch { /* bez pamięci */ } }
/** Styl ramki i poświaty elementu narzędzia wg lokalizacji. */
export function frameStyle(location) {
  const look = toolLook(), lc = locColor(location);
  const st = {};
  if (look.frame && lc) st.border = `3px solid ${lc}`;
  if (look.glow) { const g = look.glowColor === 'loc' ? lc || '#00c853' : look.glowColor; st.boxShadow = `0 0 10px 2px ${g}`; }
  return st;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const poly = (pts, sx = 1, ox = 0, oy = 0) => pts.map((p) => `${(ox + p.x * sx).toFixed(2)},${(oy + p.y * sx).toFixed(2)}`).join(' ');

/** Miniatura 60 × 70: szary obrys i żółte płytki (wiertło rurowe – żółte ostrze); brak konturu – „brak”. */
export function miniSvg(mini, { w = 60, hgt = 70, onclick } = {}) {
  const box = h('div', { class: 'tool-mini', style: { width: w + 'px', height: hgt + 'px', cursor: onclick ? 'pointer' : '' }, onclick: onclick ? (e) => { e.stopPropagation(); onclick(); } : null });
  if (!mini) { box.append(h('span', { class: 'muted', style: { fontSize: '10px' } }, 'brak')); return box; }
  const s = Math.min(w / G.MINI_W, hgt / G.MINI_H);
  box.innerHTML = `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" style="background:#fff"><polygon points="${poly(mini.outline, s)}" fill="#bfbfbf" stroke="none"/>`
    + `<path d="${G.outlinePath(mini.outline, (p) => [p.x * s, p.y * s], mini.axisX ?? NaN)}" fill="none" stroke="#000" stroke-width="0.5"/>`
    + (mini.hole ? mini.hole.map((q) => `<polyline points="${poly(q, s)}" fill="none" stroke="#000" stroke-width="0.4" stroke-dasharray="1.5 1.2"/>`).join('') : '')
    + (mini.draw ? mini.draw.plates.map((q) => `<polygon points="${poly(q, s)}" fill="#c8a400" stroke="#000" stroke-width="0.4"/>`).join('') + mini.draw.hidden.map((q) => `<polyline points="${poly(q, s)}" fill="none" stroke="#000" stroke-width="0.4" stroke-dasharray="1.5 1.2"/>`).join('') : '')
    + mini.inserts.map((p) => `<polygon points="${poly(p, s)}" fill="#c8a400" stroke="#000" stroke-width="0.5"/>`).join('') + '</svg>';
  return box;
}

/** Zestaw narzędzi 2D (SVG, dopasowany do pola): obrysy w kolorach narzędzi, płytki złote; [labels] – kody i poziomy „Y=…”. */
export function stackSvg(stack, { labels = false, pad = 24, width = 600, height = 600 } = {}) {
  const b = stack.bounds, bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh);
  const ox = width / 2 - ((b.minX + b.maxX) / 2) * s, oy = pad - b.minY * s;
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#fff">`;
  stack.layers.forEach((l, i) => {
    const c = G.TOOL_PALETTE[i % G.TOOL_PALETTE.length];
    if (l.draw) {   // wiertło rurowe: sylweta szara (ciągła), płytki żółte, wnęka (niewidoczna) przerywaną linią 1 px
      svg += `<polygon points="${poly(l.outline, s, ox, oy)}" fill="#bfbfbf" stroke="none"/>`
        + l.draw.plates.map((q) => `<polygon points="${poly(q, s, ox, oy)}" fill="#c8a400" stroke="none"/>`).join('')
        + `<path d="${G.outlinePath(l.outline, (p) => [ox + p.x * s, oy + p.y * s])}" fill="none" stroke="#333" stroke-width="1"/>`
        + l.draw.hidden.map((q) => `<polyline points="${poly(q, s, ox, oy)}" fill="none" stroke="#333" stroke-width="1" stroke-dasharray="5 4"/>`).join('');
    } else
    svg += `<polygon points="${poly(l.outline, s, ox, oy)}" fill="${c}" fill-opacity="0.2" stroke="none"/><path d="${G.outlinePath(l.outline, (p) => [ox + p.x * s, oy + p.y * s])}" fill="none" stroke="${c}" stroke-width="1"/>`;
    for (const ins of l.inserts) svg += `<polygon points="${poly(ins, s, ox, oy)}" fill="#c8a400" fill-opacity="0.85" stroke="#8a6d00" stroke-width="1.5"/>`;
    if (l.hole) svg += l.hole.map((q) => `<polyline points="${poly(q, s, ox, oy)}" fill="none" stroke="#333" stroke-width="1" stroke-dasharray="5 4"/>`).join('');   // otwór pod gwintownik – niewidoczny
    if (labels) {
      const top = Math.min(...l.outline.map((p) => p.y)), ry = oy + l.referenceY * s;
      svg += `<text x="4" y="${(oy + top * s + 12).toFixed(1)}" font-size="11">${esc(l.code)}</text>`;
      svg += `<circle cx="${ox.toFixed(1)}" cy="${ry.toFixed(1)}" r="3" fill="red"/><text x="${(ox + 8).toFixed(1)}" y="${(ry - 4).toFixed(1)}" font-size="11">Y=${l.referenceY.toFixed(1)}</text>`;
    }
  });
  const el = h('div', { style: { width: '100%', height: '100%' } }); el.innerHTML = svg + '</svg>';
  return el;
}

/** Podgląd 3D bryły obrotowej (canvas): przeciągnij myszką – obrót, kółko – przybliżenie. */
/** Podgląd 3D: WebGL (three.js, karta graficzna); gdy WebGL niedostępny – dawny rysunek na płótnie 2D. */
export function view3d(mesh, inserts = [], opts = {}) {
  if ((!mesh && !inserts.length) || !webglOk()) return view3dCanvas(mesh);
  return view3dGl(mesh, inserts, () => view3dCanvas(mesh), opts);
}
/** Podgląd 3D narzędzi (kody albo obiekty narzędzi) razem z płytkami skrawającymi (z= płytek na obwodzie, pochylenie ścian). */
export function toolView3d(index, tools) {
  if (!index) return view3d(null);
  const stts = tools.map((t) => index.stackTool(t));
  const draws = stts.map((s) => (s && s.trepan ? G.trepanDrawingFor(s.diameter, s.length, s.contour) : null));   // wiertła rurowe: wnęka i płytki
  const holes = stts.map((s) => (s && s.holeN ? G.holeDrawingFor(s.holeN, s.contour) : null));   // oprawki gwintujące: otwór pod chwyt gwintownika
  const mesh = G.buildMesh(stts.map((s) => (s ? s.contour : [])), 36, draws.map((d, i) => (d ? d.cavity : holes[i] ? holes[i].cavity : null)));
  if (mesh) {
    mesh.regions = stts.map((s) => (s && (index.details(s.code) || {}).regions) || null);   // część robocza (BE)
    mesh.trepan = stts.map((s, i) => (s && s.trepan ? G.trepanBlade(s.diameter, mesh.regions[i], savedInsertZ(index.tool(s.code) || s.code)) : null));   // płytki ostrza wiertła rurowego
  }
  const ins = mesh ? G.insertsForMesh(stts, mesh.offsets).map((q) => ({ poly: q.poly, ...insertSetup(index.tool(q.code) || q.code) })) : [];
  return view3d(mesh, ins);
}

// ---------- płytki w 3D: liczba zębów i pochylenie ścian (ustawia narzędziowiec w module Kontury; pamięć tego komputera) ----------
const INS_KEY = 'zks.tools.inserts';
const insStore = () => { try { return JSON.parse(localStorage.getItem(INS_KEY) || '{}') || {}; } catch { return {}; } };
const codeOf = (t) => String((t && t.productCode) || t || '').trim().toLowerCase();
/** Liczba zębów z nazwy / opisu narzędzia („Z4”, „z=3”), inaczej 2. */
function teethFromTool(t) {
  if (!t || typeof t !== 'object') return 2;
  const m = [t.columnO, t.name, t.columnL].map((v) => String(v ?? '')).join(' ').match(/(?:^|[^a-ząćęłńóśźż])z\s*=?\s*(\d{1,2})(?!\d)/i);
  const z = m ? Number(m[1]) : 0;
  return z >= 1 && z <= 60 ? z : 2;
}
/** Zapisana w Konturach liczba płytek narzędzia (0 – brak zapisu, wtedy liczba wg Ø – wiertło rurowe). */
export function savedInsertZ(t) { const z = Number((insStore()[codeOf(t)] || {}).z); return z >= 1 ? Math.min(60, Math.round(z)) : 0; }
/** { z, draft } płytek narzędzia: zapisane w Konturach albo domyślne (z z opisu narzędzia / 2, pochylenie 7°). */
export function insertSetup(t) {
  const o = insStore()[codeOf(t)] || {};
  return { z: Number(o.z) >= 1 ? Math.min(60, Math.round(Number(o.z))) : teethFromTool(t), draft: Number.isFinite(Number(o.draft)) && o.draft !== '' && o.draft != null ? Math.max(0, Math.min(30, Number(o.draft))) : 7 };
}
export function saveInsertSetup(t, patch) {
  const all = insStore(), k = codeOf(t);
  all[k] = { ...insertSetup(t), ...(all[k] || {}), ...patch };
  try { localStorage.setItem(INS_KEY, JSON.stringify(all)); } catch { /* bez pamięci */ }
}
let GL_OK = null;
function webglOk() { if (GL_OK == null) { try { GL_OK = !!document.createElement('canvas').getContext('webgl2'); } catch { GL_OK = false; } } return GL_OK; }

export function view3dCanvas(mesh) {
  const wrap = h('div', { style: { width: '100%', height: '100%', minHeight: '260px', background: '#f5f5f5', position: 'relative' } });
  if (!mesh) { wrap.append(h('div', { style: { padding: '20px', fontWeight: 600 } }, 'Brak konturu 3D (kolumna T arkusza ND_CACHE)')); return wrap; }
  const cv = h('canvas', { style: { width: '100%', height: '100%', display: 'block', cursor: 'grab' } });
  wrap.append(cv, h('div', { class: 'muted', style: { position: 'absolute', left: '8px', bottom: '6px', fontSize: '11px' } }, 'Przeciągnij: obrót · kółko myszy: przybliżenie'));
  let cam = G.initialCamera(mesh.size);
  const base = G.TOOL_PALETTE.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
  const draw = () => {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
    const p = G.project(mesh, cam, r.width, r.height);
    for (const f of p.order) {
      const q = mesh.quads.slice(f * 4, f * 4 + 4), c = base[mesh.faceTool[f] % base.length], sh = p.shade[f];
      ctx.beginPath(); ctx.moveTo(p.sx[q[0]], p.sy[q[0]]); for (let k = 1; k < 4; k++) ctx.lineTo(p.sx[q[k]], p.sy[q[k]]); ctx.closePath();
      ctx.fillStyle = `rgb(${c.map((v) => Math.round(v * sh)).join(',')})`; ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.5; ctx.stroke();
    }
  };
  let drag = null;
  cv.addEventListener('mousedown', (e) => { drag = [e.clientX, e.clientY]; cv.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { drag = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('mousemove', (e) => { if (!drag) return; cam = G.rotateCamera(cam, -(e.clientX - drag[0]) * 0.01, (e.clientY - drag[1]) * 0.01); drag = [e.clientX, e.clientY]; requestAnimationFrame(draw); });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); cam = G.zoomCamera(cam, e.deltaY < 0 ? 1.1 : 1 / 1.1, mesh.size); requestAnimationFrame(draw); }, { passive: false });
  new ResizeObserver(() => draw()).observe(wrap);
  return wrap;
}

/** Tabela części zamiennych: kod narzędzia, płytka/część (tło – kolor stanu), stan, zapas, dostępne. */
export function partsTable(rows) {
  const tb = h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', { class: 'left', style: { fontWeight: 700 } }, String(r.toolCode).toUpperCase()),
    h('td', { class: 'left', style: { fontWeight: 700, background: parseSheetColor(r.color, '#ffffff') } }, String(r.partCode).toUpperCase()), h('td', {}, r.status), h('td', {}, r.stock), h('td', {}, r.available))));
  return h('div', {}, h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, h('tr', {}, ...['Kod', 'Płytka/część', 'Stan', 'Zapas', 'Dostępne'].map((x) => h('th', {}, x)))), tb),
    rows.length ? null : h('p', { class: 'muted' }, 'Brak części dla wybranych narzędzi.'));
}

/** Okno prawie na cały ekran z tytułem i „Zamknij”. [content] – element (rośnie na całą wysokość). */
export function fullScreen(title, content) {
  const m = modal(null, h('div', { class: 'fs-dialog' },
    h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0, flex: 1 } }, title), h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij')),
    h('div', { class: 'fs-body' }, content)), { wide: true });
  m.root.classList.add('fs');
  return m;
}

/** Komórka kodu: tło – pasek zużycia (do 80% szerokości), z prawej pasek koloru lokalizacji, czerwona ramka – brak części. */
export function wearCodeCell(wear, location, warning, ...children) {
  const p = T.wearPercent(wear), band = T.wearBand(p);
  const c = band === 'low' ? '#00c853' : band === 'medium' ? '#ffd600' : '#d50000', fill = Math.min(80, (p / 100) * 80);
  const lc = locColor(location);
  return h('div', { class: 'wear-cell', style: { background: `linear-gradient(90deg, ${c} 0%, ${c} ${fill}%, #fff ${fill}%, #fff 100%)`, outline: warning ? '3px solid #d50000' : '', outlineOffset: '-3px' } },
    h('div', { class: 'wear-text' }, ...children), lc ? h('div', { class: 'wear-loc', style: { background: lc } }) : null);
}

/** Standardowe parametry: Φ, L, r/α, Ms, Mk. */
export const toolParams = (t) => [['Φ', t.columnF], ['L', t.columnJ], ['r/α', T.rAlphaText(t)], ['Ms', t.columnM], ['Mk', t.columnN]];
/** Karta: opis (2 linie) i parametry z etykietami w jednym zawijanym wierszu. */
export function toolCard(description, params) {
  const shown = params.filter(([, v]) => String(v ?? '').trim());
  return h('div', { class: 'tool-card' }, h('div', { class: 'tool-desc' }, description),
    shown.length ? h('div', { class: 'tool-params' }, ...shown.flatMap(([l, v], i) => [i ? '   ' : '', h('span', { class: 'muted' }, l + ' '), h('b', {}, String(v))])) : null);
}
/** Wiersz narzędzia jak na Androidzie: kod (92 px), opis i parametry, opcjonalnie miniatura; ramka i poświata wg lokalizacji. */
export function toolRow(t, { warning = false, onclick, oncontextmenu, mini = null, description = null } = {}) {
  return h('div', { class: 'tool-row' + (onclick ? ' click' : ''), onclick, oncontextmenu, style: frameStyle(t.location) },
    wearCodeCell(t.wear, t.location, warning, h('b', {}, t.productCode)),
    toolCard(description ?? T.description(t), toolParams(t)), mini ? h('div', { class: 'tool-mini-col' }, mini) : null);
}

/** Lista rozwijana filtra jak przycisk Androida: aktywny filtr wypełniony; pusta wartość = „(wszystkie)”. */
export function filterDropdown(label, value, options, onSelect, { allLabel = '(wszystkie)' } = {}) {
  const sel = h('select', { class: 'filter-dd' + (String(value ?? '').trim() ? ' on' : ''), title: label, onchange: () => onSelect(sel.value) },
    h('option', { value: '' }, String(value ?? '').trim() && allLabel !== null ? allLabel : label),
    ...options.map((o) => h('option', { value: o, selected: String(value ?? '').toLowerCase() === String(o).toLowerCase() }, o)));
  if (allLabel === null) sel.firstChild.disabled = true;
  return sel;
}

/** Linia komunikatu (czerwony – błąd, szary – informacja, zielony – potwierdzenie). */
export function statusLine() {
  const el = h('div', { class: 'status-line' });
  el.set = (text, kind = 'ok') => { el.textContent = text || ''; el.style.color = kind === 'error' ? '#c62828' : kind === 'neutral' ? '#666' : '#1b5e20'; el.style.display = text ? '' : 'none'; };
  el.set('');
  return el;
}
export { clear };

/** Kafelek narzędzia (widok kafelków): kod na pasku zużycia, lokalizacja, duża miniatura, opis i parametry; ramka i poświata wg lokalizacji. */
export function toolTile(t, { warning = false, onclick, oncontextmenu, mini = null, description = null, footer = null } = {}) {
  const lc = locColor(t.location);
  return h('div', { class: 'tool-tile' + (onclick ? ' click' : ''), onclick, oncontextmenu, style: frameStyle(t.location) },
    h('div', { class: 'tile-head' }, wearCodeCell(t.wear, t.location, warning, h('b', {}, t.productCode)),
      h('span', { class: 'tile-loc', style: { background: lc || '#eee', color: lc ? contrast(lc) : '#333' } }, t.location || '—')),
    h('div', { class: 'tile-body' }, mini ? h('div', { class: 'tile-mini' }, mini) : null, toolCard(description ?? T.description(t), toolParams(t))), footer);
}
/** Czarny albo biały tekst na tle [bg]. */
export function contrast(bg) {
  const c = parseSheetColor(bg, '#ffffff'), r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#000' : '#fff';
}
/** Dorysowywanie długiej listy porcjami przy przewijaniu (wszystkie elementy, bez przycisku „pokaż kolejne”). */
export function lazyFill(container, items, make, step = 120) {
  let n = 0;
  const sentinel = h('div', { style: { height: '1px', gridColumn: '1 / -1' } });
  const more = () => { const end = Math.min(items.length, n + step); const frag = document.createDocumentFragment(); for (; n < end; n++) frag.append(make(items[n])); container.insertBefore(frag, sentinel); if (n >= items.length) { io.disconnect(); sentinel.remove(); } };
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { root: container, rootMargin: '600px' });
  container.append(sentinel);
  more();
  if (n < items.length) io.observe(sentinel);
  const stop = () => io.disconnect();
  /** Dodanie elementu na koniec listy (dorysowany od razu, gdy lista jest już cała na ekranie). */
  stop.add = (item) => { items.push(item); if (!sentinel.isConnected && n === items.length - 1) { container.append(make(item)); n++; } };
  return stop;
}
