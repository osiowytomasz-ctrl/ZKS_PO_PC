// Podgląd 3D narzędzi na karcie graficznej (WebGL, three.js – paczka lokalna src/renderer/vendor/three.js, bez internetu).
// Bryły obrotowe z profili konturów (połowa X ≥ 0), gładkie cieniowanie wokół osi, ostre krawędzie na załamaniach profilu,
// oświetlenie „warsztatowe” (odbicia metalu), obrót/przesuwanie/zoom myszą, rysowanie tylko po zmianie widoku.
import { h } from '../ui.js';
import * as G from '../logic/toolGeometry.js';

let THREE_P = null;
const three = () => (THREE_P ||= import('../../vendor/three.js'));
const SEG = 128;
/** Kolor części roboczej i płytek – jak płytki w module Części (widok główny). */
const WORK_COLOR = 0xc8a400;
/** Profil z punktami wstawionymi na poziomach [zs] (0,1 mm) – granice rejonów leżą na krawędziach siatki. */
function splitProfile(pr, zs) {
  const out = [pr[0]];
  for (let k = 0; k < pr.length - 1; k++) {
    const a = pr[k], b = pr[k + 1];
    const cut = zs.filter((z) => (z - a.y) * (z - b.y) < 0).sort((p, q) => (b.y > a.y ? p - q : q - p));
    for (const z of cut) { const t = (z - a.y) / (b.y - a.y); out.push({ x: a.x + t * (b.x - a.x), y: z }); }
    out.push(b);
  }
  return out;
}   // podział obwodu – gładka bryła przy niewielkim koszcie (GPU)

/** Geometria bryły obrotowej z profilu (punkty {x: promień, y: wysokość} w 0,1 mm → mm). Każdy odcinek profilu ma własne wierzchołki,
 *  więc normalne są gładkie wokół osi, a ostre na załamaniach (stożek → walec itp.). */
function latheGeometry(T, profile, z0, keep = null) {
  const pos = [], nrm = [], idx = [];
  let area = 0; for (let k = 0; k < profile.length; k++) { const a = profile[k], b = profile[(k + 1) % profile.length]; area += a.x * b.y - b.x * a.y; }
  const sg = area < 0 ? -1 : 1;   // kierunek obiegu profilu → normalne zawsze na zewnątrz
  const cs = [...Array(SEG + 1)].map((_, j) => [Math.cos((2 * Math.PI * j) / SEG), Math.sin((2 * Math.PI * j) / SEG)]);
  for (let k = 0; k < profile.length - 1; k++) {
    const a = profile[k], b = profile[k + 1];
    if (keep && !keep(a, b)) continue;
    const r1 = a.x / 10, y1 = (a.y + z0) / 10, r2 = b.x / 10, y2 = (b.y + z0) / 10;
    if (r1 === 0 && r2 === 0) continue;
    const dy = y2 - y1, dr = r2 - r1, len = Math.hypot(dy, dr) || 1;
    const nr = (sg * dy) / len, ny = (-sg * dr) / len;   // normalna profilu (na zewnątrz dla obrysu prowadzonego od dołu w górę)
    const base = pos.length / 3;
    for (const [r, y] of [[r1, y1], [r2, y2]]) for (const [c, s] of cs) { pos.push(r * c, y, r * s); nrm.push(nr * c, ny, nr * s); }
    for (let j = 0; j < SEG; j++) { const p0 = base + j, p1 = base + j + 1, q0 = base + SEG + 1 + j, q1 = q0 + 1; idx.push(p0, q0, p1, p1, q0, q1); }
  }
  if (!pos.length) return null;
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new T.BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
  return g;
}

/**
 * Linie konturów bryły obrotowej (bez siatki trójkątów): okręgi krawędzi na każdym załamaniu profilu (> 4°; drobne łuki – zaokrąglenia – bez okręgów)
 * oraz na poziomach granic rejonów [force] (0,1 mm). Wynik: pary punktów dla LineSegments albo null.
 */
function ringLines(T, profile, z0, keep, force = []) {
  const pos = [], n = profile.length, SEG_L = 96;
  const vis = (k) => (k > 0 && (!keep || keep(profile[k - 1], profile[k]))) || (k < n - 1 && (!keep || keep(profile[k], profile[k + 1])));
  const seen = new Set();
  for (let k = 0; k < n; k++) {
    const p = profile[k];
    if (!(p.x > 0.5) || !vis(k)) continue;
    let draw = k === 0 || k === n - 1 || force.some((z) => Math.abs(z - p.y) < 0.5);
    if (!draw) {
      const a = profile[k - 1], b = profile[k + 1], d1 = [p.x - a.x, p.y - a.y], d2 = [b.x - p.x, b.y - p.y], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
      if (l1 > 1e-6 && l2 > 1e-6) {
        const ang = (Math.acos(Math.max(-1, Math.min(1, (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2)))) * 180) / Math.PI;
        draw = ang > 4 && !(l1 < 12 && l2 < 12 && ang < 20);   // łuk z drobnych odcinków (< 1,2 mm) – bez okręgów
      }
    }
    const key = Math.round(p.x * 100) + ':' + Math.round(p.y * 100);
    if (!draw || seen.has(key)) continue;
    seen.add(key);
    const r = p.x / 10, y = (p.y + z0) / 10;
    for (let j = 0; j < SEG_L; j++) { const a1 = (2 * Math.PI * j) / SEG_L, a2 = (2 * Math.PI * (j + 1)) / SEG_L; pos.push(r * Math.cos(a1), y, r * Math.sin(a1), r * Math.cos(a2), y, r * Math.sin(a2)); }
  }
  if (!pos.length) return null;
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
  return g;
}
/** Profil jako linie w płaszczyźnie południka (x = promień, y = wysokość) – obrys bryły widziany z boku; obracany do płaszczyzn prostopadłych do kierunku patrzenia. */
function meridianLines(T, profile, z0, keep) {
  const pos = [];
  for (let k = 0; k < profile.length - 1; k++) {
    const a = profile[k], b = profile[k + 1];
    if ((keep && !keep(a, b)) || (a.x <= 0 && b.x <= 0)) continue;
    pos.push(a.x / 10, (a.y + z0) / 10, 0, b.x / 10, (b.y + z0) / 10, 0);
  }
  if (!pos.length) return null;
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
  return g;
}

/**
 * Płytka ostrza wiertła rurowego: wycinek pierścienia węglika (promień [rIn, rOut], wysokość [y1, y2], kąt [a0, a1] wokół osi Y sceny), mm.
 * Powierzchnie walcowe gładkie, płaszczyzny (góra, dół, boki) płaskie.
 */
function sectorGeometry(T, rIn, rOut, y1, y2, a0, a1, steps) {
  const pos = [], nrm = [], idx = [];
  const quad = (v, n) => { const b = pos.length / 3; for (let k = 0; k < 4; k++) { pos.push(...v[k]); nrm.push(...(n[k] || n[0])); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  const P = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)], N = (a, sg) => [sg * Math.cos(a), 0, sg * Math.sin(a)];
  for (let j = 0; j < steps; j++) {
    const u = a0 + ((a1 - a0) * j) / steps, w = a0 + ((a1 - a0) * (j + 1)) / steps;
    quad([P(rOut, u, y1), P(rOut, w, y1), P(rOut, w, y2), P(rOut, u, y2)], [N(u, 1), N(w, 1), N(w, 1), N(u, 1)]);           // zewnętrzna ściana
    quad([P(rIn, u, y1), P(rIn, u, y2), P(rIn, w, y2), P(rIn, w, y1)], [N(u, -1), N(u, -1), N(w, -1), N(w, -1)]);           // wewnętrzna ściana
    quad([P(rIn, u, y2), P(rOut, u, y2), P(rOut, w, y2), P(rIn, w, y2)], [[0, 1, 0]]);                                       // góra (czoło)
    quad([P(rIn, u, y1), P(rIn, w, y1), P(rOut, w, y1), P(rOut, u, y1)], [[0, -1, 0]]);                                      // dół
  }
  const cap = (a, sg) => quad(sg > 0 ? [P(rIn, a, y1), P(rOut, a, y1), P(rOut, a, y2), P(rIn, a, y2)] : [P(rIn, a, y1), P(rIn, a, y2), P(rOut, a, y2), P(rOut, a, y1)], [[-Math.sin(a) * sg, 0, Math.cos(a) * sg]]);
  cap(a0, -1); cap(a1, 1);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new T.BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
  return g;
}

/**
 * Płytka 3D: kontur płytki (0,1 mm, prawa płytka – x > 0) leży powierzchnią natarcia w płaszczyźnie osi narzędzia (z = 0),
 * grubość idzie do tyłu (−z), a ściany są pochylone o [draft]° (przyłożenie – tylny przekrój mniejszy, płytka nie trze tyłem).
 */
function insertGeometry(T, poly, draft, thickness = 0, central = false) {
  let P = (poly || []).map((p) => new T.Vector2(p.x / 10, p.y / 10));
  if (P.length > 2 && P[0].distanceTo(P[P.length - 1]) < 1e-6) P.pop();
  if (P.length < 3) return null;
  if (T.ShapeUtils.isClockWise(P)) P = P.reverse();   // przeciwnie do wskazówek zegara → normalne na zewnątrz
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const depth = thickness > 0 ? thickness : Math.min(6, Math.max(1, size * 0.3));
  const off = Math.min(size * 0.2, (central ? depth / 2 : depth) * Math.tan((Math.max(0, draft || 0) * Math.PI) / 180));
  // tylny przekrój: kontur odsunięty do środka o [off] (przecięcie przesuniętych krawędzi, ograniczone przy ostrych narożach)
  const n = P.length, inN = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return new T.Vector2(-dy / l, dx / l); };
  const B = P.map((p, i) => {
    const n1 = inN(P[(i - 1 + n) % n], p), n2 = inN(p, P[(i + 1) % n]);
    const m = n1.clone().add(n2), d = 1 + n1.dot(n2);
    const k = d > 0.25 ? off / d : off * 4;
    return p.clone().addScaledVector(m.lengthSq() > 1e-12 ? m : n1, d > 0.25 ? k : k / Math.max(m.length(), 1e-6));
  });
  const tris = T.ShapeUtils.triangulateShape(P, []);
  const pos = [];
  const v = (q, z) => pos.push(q.x, q.y, z);
  if (central) {
    // płytka centralna: płaszczyzna środkowa (pełny kontur) w osi narzędzia, ściany opadają na obie strony – przód i tył mniejsze o opad
    const h2 = depth / 2;
    for (const [a, b, c] of tris) { v(B[a], h2); v(B[b], h2); v(B[c], h2); }
    for (const [a, b, c] of tris) { v(B[a], -h2); v(B[c], -h2); v(B[b], -h2); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      v(P[i], 0); v(P[j], 0); v(B[i], h2);   v(P[j], 0); v(B[j], h2); v(B[i], h2);      // przód: ściana opadająca od płaszczyzny środkowej do przedniego przekroju
      v(P[i], 0); v(B[i], -h2); v(P[j], 0);  v(P[j], 0); v(B[i], -h2); v(B[j], -h2);    // tył – lustrzanie
    }
  } else {
    for (const [a, b, c] of tris) { v(P[a], 0); v(P[b], 0); v(P[c], 0); }               // przód (natarcie) – w płaszczyźnie osi
    for (const [a, b, c] of tris) { v(B[a], -depth); v(B[c], -depth); v(B[b], -depth); } // tył – mniejszy
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      v(P[i], 0); v(B[i], -depth); v(P[j], 0);
      v(P[j], 0); v(B[i], -depth); v(B[j], -depth);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

export function view3dGl(mesh, inserts, fallback, opts = {}) {
  const wrap = h('div', { style: { width: '100%', height: '100%', minHeight: '260px', background: 'linear-gradient(#fafafa,#e3e6ea)', position: 'relative', overflow: 'hidden' } });
  const info = h('div', { class: 'muted', style: { position: 'absolute', left: '8px', bottom: '6px', fontSize: '11px', pointerEvents: 'none' } }, 'Lewy: obrót · prawy: przesuwanie · kółko: przybliżenie');
  const bar = h('div', { class: 'row', style: { position: 'absolute', right: '6px', top: '6px', gap: '4px', zIndex: 2 } });
  wrap.append(info, bar);
  three().then((T) => init(T)).catch((e) => { console.warn('3D WebGL:', e); wrap.replaceWith(fallback()); });

  function init(T) {
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch { wrap.replaceWith(fallback()); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
    const cv = renderer.domElement; cv.style.display = 'block'; cv.style.width = '100%'; cv.style.height = '100%';
    wrap.prepend(cv);
    const scene = new T.Scene();
    const pmrem = new T.PMREMGenerator(renderer), envTex = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.add(new T.HemisphereLight(0xffffff, 0x8899aa, 0.6));
    const sun = new T.DirectionalLight(0xffffff, 1.4); sun.position.set(1, 2, 1.5); scene.add(sun);

    renderer.localClippingEnabled = true;   // gniazdo pod płytkę centralną: wycięcie w korpusie narzędzia
    let slot = null;
    const group = new T.Group(), geos = [], mats = [], meridians = [];
    const lineMat = new T.LineBasicMaterial({ color: 0x1b1f24, transparent: true, opacity: 0.9 }); mats.push(lineMat);
    const edges = (g, color, op) => { const eg = new T.EdgesGeometry(g, 25), em = new T.LineBasicMaterial({ color, transparent: true, opacity: op }); group.add(new T.LineSegments(eg, em)); geos.push(eg); mats.push(em); };
    // płytki skrawające: wielokąty z rysunku 2D wyciągnięte na grubość (w płaszczyźnie osi narzędzia)
    if (inserts && inserts.length) {
      const im = new T.MeshStandardMaterial({ color: WORK_COLOR, metalness: 0.45, roughness: 0.35, flatShading: true, side: T.DoubleSide }); mats.push(im);
      const lm = new T.LineBasicMaterial({ color: 0x3b0000, transparent: true, opacity: 0.6 }); mats.push(lm);
      for (const it0 of inserts) {
        const it = Array.isArray(it0) ? { poly: it0, z: 1, draft: 7, alone: true } : it0;
        const g = insertGeometry(T, it.poly, it.draft, it.thickness || 0, !!it.central);
        if (g && it.central && !slot) {   // pierwsza płytka centralna: w korpusie wycięte gniazdo (płyta grubości płytki, od jej dołu do czubka) – płytka widoczna w gnieździe
          const ys = it.poly.map((q) => q.y / 10), xs = it.poly.map((q) => q.x / 10), size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
          const depth = it.thickness > 0 ? it.thickness : Math.min(6, Math.max(1, size * 0.3)), ph = ((it.phi || 0) * Math.PI) / 180, nrm = new T.Vector3(Math.sin(ph), 0, Math.cos(ph)), half = (depth + 0.4) / 2;
          const uu = new T.Vector3(Math.cos(ph), 0, -Math.sin(ph)), x0 = Math.min(...xs) - 0.2, x1 = Math.max(...xs) + 0.2;   // oś płytki w jej płaszczyźnie – gniazdo nie dłuższe niż płytka
          slot = [{ normal: nrm.clone(), constant: -half }, { normal: nrm.clone().negate(), constant: -half }, { normal: new T.Vector3(0, -1, 0), constant: Math.min(...ys) },
            { normal: uu.clone().negate(), constant: x0 }, { normal: uu.clone(), constant: -x1 }];   // płaszczyzny jako obiekty { normal, constant } (paczka three.js nie eksportuje Plane)   // wycinane tylko tam, gdzie spełnione są wszystkie trzy
          lineMat.clippingPlanes = slot; lineMat.clipIntersection = true;
        }
        if (!g) continue;
        geos.push(g);
        const eg = new T.EdgesGeometry(g, 20); geos.push(eg);
        const z = it.alone ? 1 : Math.max(1, Math.min(60, Math.round(it.z || 2)));
        for (let k = 0; k < z; k++) {   // z płytek co 360°/z wokół osi narzędzia (oś Y sceny)
          const holder = new T.Group();
          holder.add(new T.Mesh(g, im), new T.LineSegments(eg, lm));
          holder.rotation.y = (((it.phi || 0) * Math.PI) / 180) + (k * 2 * Math.PI) / z;   // kąt na obwodzie φ + z kopii co 360° / z
          group.add(holder);
        }
      }
    }
    const clip = (mat) => { if (slot) { mat.clippingPlanes = slot; mat.clipIntersection = true; } return mat; };
    const workMat = clip(new T.MeshStandardMaterial({ color: WORK_COLOR, metalness: 0.55, roughness: 0.3, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })); mats.push(workMat);
    (mesh ? mesh.profiles : []).forEach((pr0, i) => {
      if (!pr0) return;
      // część robocza (rejon „ostrze” z PSWT BE / Konturów) – kolor płytek z modułu Części; reszta – kolor narzędzia
      const regs = ((mesh.regions && mesh.regions[i]) || []).filter((r) => r.role === 'ostrze');
      const ntR = mesh.nut && mesh.nut[i];
      const pr = regs.length ? splitProfile(pr0, regs.flatMap((r) => [r.z1 * 10, r.z2 * 10])) : ntR ? splitProfile(pr0, [ntR.z1]) : pr0;
      const tb = mesh.trepan && mesh.trepan[i];   // wiertło rurowe: korpus – bryła wydrążona do czubka, ostrze to osobne płytki wlutowane w ściankę
      const isWork = (a, b) => { const z = (a.y + b.y) / 20; return regs.some((r) => z >= r.z1 - 1e-6 && z <= r.z2 + 1e-6); };
      const col = new T.Color(G.TOOL_PALETTE[i % G.TOOL_PALETTE.length]).lerp(new T.Color(0xb8bec6), 0.45);
      const m = clip(new T.MeshStandardMaterial({ color: col, metalness: 0.75, roughness: 0.32, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })); mats.push(m);
      if (tb) {   // płytki wlutowane w ściankę: każda ma po obwodzie najwyżej [arc] mm (4), n płytek równo co 360°/n, czubek lekko ponad korpusem
        const y1 = tb.z1 + mesh.offsets[i] / 10, y2 = tb.z2 + mesh.offsets[i] / 10 + 0.04, pitch = (2 * Math.PI) / tb.n, half = tb.arc / (2 * Math.max(tb.rOut, 1));
        for (let k = 0; k < tb.n; k++) {
          const g = sectorGeometry(T, tb.rIn, tb.rOut, y1, y2, k * pitch - half, k * pitch + half, 3);
          group.add(new T.Mesh(g, workMat)); geos.push(g);
          edges(g, 0x3b0000, 0.6);
        }
      }
      const nt = mesh.nut && mesh.nut[i];   // nakrętka ER: część bryły od jej podstawy w ciemniejszym kolorze
      const nutMat = nt ? clip(new T.MeshStandardMaterial({ color: new T.Color(col).multiplyScalar(0.45), metalness: 0.7, roughness: 0.4, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })) : null; if (nutMat) mats.push(nutMat);
      const isNut = nt ? (a, b) => (a.y + b.y) / 20 >= nt.z1 / 10 - 1e-6 : null;
      for (const [keep, mat] of nt ? [[(a, b) => !isNut(a, b), m], [isNut, nutMat]] : tb ? [[null, m]] : regs.length ? [[(a, b) => !isWork(a, b), m], [isWork, workMat]] : [[null, m]]) {
        const g = latheGeometry(T, pr, mesh.offsets[i], keep); if (!g) continue;
        group.add(new T.Mesh(g, mat)); geos.push(g);
        // linie konturów (bez trójkątów): okręgi krawędzi + obrys z boku (południki) – ułatwiają odczyt narzędzia
        const force = [...regs.flatMap((r) => [r.z1 * 10, r.z2 * 10]), ...(nt ? [nt.z1] : [])];
        const rg = ringLines(T, pr, mesh.offsets[i], keep, force);
        if (rg) { group.add(new T.LineSegments(rg, lineMat)); geos.push(rg); }
        const mg = meridianLines(T, pr, mesh.offsets[i], keep);
        if (mg && !(opts.xf && opts.xf.ang)) { const l1 = new T.LineSegments(mg, lineMat), l2 = new T.LineSegments(mg, lineMat); group.add(l1, l2); meridians.push([l1, l2]); geos.push(mg); }
      }
    });
    if (opts.xf) {   // przesunięcie / obrót całego narzędzia z płytkami (moduł Kontury)
      group.rotation.z = (opts.xf.ang * Math.PI) / 180;
      group.position.set(opts.xf.dx, opts.xf.dz, 0);
    }
    scene.add(group);
    const box = new T.Box3().setFromObject(group), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    const R = Math.max(size.x, size.y, size.z, 1);
    const grid = new T.GridHelper(R * 2, 20, 0x9aa3ad, 0xd0d5db); grid.position.set(center.x, box.min.y - 0.01, center.z); scene.add(grid);

    const cam = new T.PerspectiveCamera(35, 1, R / 200, R * 50);
    const ctl = new T.OrbitControls(cam, cv);
    ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.target.copy(center);
    const views = {
      'Izometria': [1.3, 0.8, 1.8], 'Z boku': [0, 0, 1], 'Z góry': [0, 1, 0.0001], 'Od dołu': [0, -1, 0.0001],
    };
    const setView = (k) => { const d = new T.Vector3(...views[k]).normalize(); const dist = R / (2 * Math.tan((cam.fov * Math.PI) / 360) * Math.min(1, cam.aspect || 1)) * 1.35; /* w wąskim oknie liczy się szerokość widoku */ cam.position.copy(center).addScaledVector(d, dist); ctl.target.copy(center); ctl.update(); kick(); };
    let spin = false;
    for (const k of Object.keys(views)) bar.append(h('button', { class: 'btn small', onclick: () => setView(k) }, k));
    const spinBtn = h('button', { class: 'btn small', title: 'Obrót automatyczny', onclick: () => { spin = !spin; ctl.autoRotate = spin; spinBtn.classList.toggle('primary', spin); kick(); } }, '⟳');
    bar.append(spinBtn);

    // triada osi jak w SolidWorks (lewy dolny róg): X czerwona, Y zielona, Z niebieska (Z = oś narzędzia = „w górę” sceny)
    const tri = h('canvas', { width: 180, height: 180, style: { position: 'absolute', left: '4px', bottom: '20px', width: '90px', height: '90px', pointerEvents: 'none' } });
    wrap.append(tri);
    const AX = [[new T.Vector3(1, 0, 0), '#d50000', 'X'], [new T.Vector3(0, 0, -1), '#2e7d32', 'Y'], [new T.Vector3(0, 1, 0), '#1565c0', 'Z']];
    const drawTriad = () => {
      const g2 = tri.getContext('2d'); g2.setTransform(2, 0, 0, 2, 0, 0); g2.clearRect(0, 0, 90, 90);
      const q = cam.quaternion.clone().invert(), c = 45, L = 30;
      const v = AX.map(([d, col, l]) => { const p = d.clone().applyQuaternion(q); return { x: p.x, y: p.y, z: p.z, col, l }; }).sort((a, b) => a.z - b.z);
      for (const a of v) {
        const x2 = c + a.x * L, y2 = c - a.y * L;
        g2.strokeStyle = g2.fillStyle = a.col; g2.lineWidth = 2.5; g2.beginPath(); g2.moveTo(c, c); g2.lineTo(x2, y2); g2.stroke();
        g2.beginPath(); g2.arc(x2, y2, 3, 0, Math.PI * 2); g2.fill();
        g2.font = 'bold 12px sans-serif'; g2.fillText(a.l, c + a.x * (L + 9) - 4, c - a.y * (L + 9) + 4);
      }
      g2.fillStyle = '#333'; g2.beginPath(); g2.arc(c, c, 2.5, 0, Math.PI * 2); g2.fill();
    };

    // rysowanie tylko gdy coś się zmienia (oszczędza procesor/kartę)
    let raf = 0, alive = true;
    const frame = () => {
      raf = 0; if (!alive) return; const moving = ctl.update();
      if (meridians.length) {   // obrys z boku: południki prostopadłe do kierunku patrzenia (azymut kamery wokół osi narzędzia)
        const az = Math.atan2(cam.position.x - ctl.target.x, cam.position.z - ctl.target.z);
        for (const [a, b] of meridians) { a.rotation.y = -(az + Math.PI / 2); b.rotation.y = -(az - Math.PI / 2); }
      }
      renderer.render(scene, cam); drawTriad(); if (moving || spin) kick();
    };
    const kick = () => { if (!raf && alive) raf = requestAnimationFrame(frame); };
    ctl.addEventListener('change', kick);
    const resize = () => { const w = wrap.clientWidth, hh = wrap.clientHeight; if (!w || !hh) return; renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); kick(); };
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    resize(); setView('Izometria');

    // zwolnienie kontekstu WebGL po zamknięciu okna (przeglądarka ma limit kontekstów)
    const dispose = () => { alive = false; ro.disconnect(); mo.disconnect(); ctl.dispose(); geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); envTex.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss(); };
    const mo = new MutationObserver(() => { if (!wrap.isConnected) dispose(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  return wrap;
}
