// Podgląd 3D narzędzi na karcie graficznej (WebGL, three.js – paczka lokalna src/renderer/vendor/three.js, bez internetu).
// Bryły obrotowe z profili konturów (połowa X ≥ 0), gładkie cieniowanie wokół osi, ostre krawędzie na załamaniach profilu,
// oświetlenie „warsztatowe” (odbicia metalu), obrót/przesuwanie/zoom myszą, rysowanie tylko po zmianie widoku.
import { h } from '../ui.js';
import * as G from '../logic/toolGeometry.js';

let THREE_P = null;
const three = () => (THREE_P ||= import('../../vendor/three.js'));
const SEG = 128;   // podział obwodu – gładka bryła przy niewielkim koszcie (GPU)

/** Geometria bryły obrotowej z profilu (punkty {x: promień, y: wysokość} w 0,1 mm → mm). Każdy odcinek profilu ma własne wierzchołki,
 *  więc normalne są gładkie wokół osi, a ostre na załamaniach (stożek → walec itp.). */
function latheGeometry(T, profile, z0) {
  const pos = [], nrm = [], idx = [];
  let area = 0; for (let k = 0; k < profile.length; k++) { const a = profile[k], b = profile[(k + 1) % profile.length]; area += a.x * b.y - b.x * a.y; }
  const sg = area < 0 ? -1 : 1;   // kierunek obiegu profilu → normalne zawsze na zewnątrz
  const cs = [...Array(SEG + 1)].map((_, j) => [Math.cos((2 * Math.PI * j) / SEG), Math.sin((2 * Math.PI * j) / SEG)]);
  for (let k = 0; k < profile.length - 1; k++) {
    const a = profile[k], b = profile[k + 1];
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

export function view3dGl(mesh, inserts, fallback) {
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

    const group = new T.Group(), geos = [], mats = [];
    const edges = (g, color, op) => { const eg = new T.EdgesGeometry(g, 25), em = new T.LineBasicMaterial({ color, transparent: true, opacity: op }); group.add(new T.LineSegments(eg, em)); geos.push(eg); mats.push(em); };
    // płytki skrawające: wielokąty z rysunku 2D wyciągnięte na grubość (w płaszczyźnie osi narzędzia)
    if (inserts && inserts.length) {
      const im = new T.MeshStandardMaterial({ color: 0xc62828, metalness: 0.45, roughness: 0.35 }); mats.push(im);
      for (const poly of inserts) {
        if (!poly || poly.length < 3) continue;
        const xs = poly.map((p) => p.x / 10), ys = poly.map((p) => p.y / 10);
        const sz = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        const depth = Math.min(6, Math.max(1, sz * 0.3));
        const sh = new T.Shape(poly.map((p) => new T.Vector2(p.x / 10, p.y / 10)));
        const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 1 });
        g.translate(0, 0, -depth / 2);
        group.add(new T.Mesh(g, im)); geos.push(g);
        edges(g, 0x3b0000, 0.6);
      }
    }
    (mesh ? mesh.profiles : []).forEach((pr, i) => {
      if (!pr) return;
      const g = latheGeometry(T, pr, mesh.offsets[i]); if (!g) return;
      const col = new T.Color(G.TOOL_PALETTE[i % G.TOOL_PALETTE.length]).lerp(new T.Color(0xb8bec6), 0.45);
      const m = new T.MeshStandardMaterial({ color: col, metalness: 0.75, roughness: 0.32, side: T.DoubleSide });
      group.add(new T.Mesh(g, m)); geos.push(g); mats.push(m);
      edges(g, 0x2a2f36, 0.35);
    });
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
    const setView = (k) => { const d = new T.Vector3(...views[k]).normalize(); const dist = R / (2 * Math.tan((cam.fov * Math.PI) / 360)) * 1.35; cam.position.copy(center).addScaledVector(d, dist); ctl.target.copy(center); ctl.update(); kick(); };
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
    const frame = () => { raf = 0; if (!alive) return; const moving = ctl.update(); renderer.render(scene, cam); drawTriad(); if (moving || spin) kick(); };
    const kick = () => { if (!raf && alive) raf = requestAnimationFrame(frame); };
    ctl.addEventListener('change', kick);
    const resize = () => { const w = wrap.clientWidth, hh = wrap.clientHeight; if (!w || !hh) return; renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); kick(); };
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    setView('Izometria'); resize();

    // zwolnienie kontekstu WebGL po zamknięciu okna (przeglądarka ma limit kontekstów)
    const dispose = () => { alive = false; ro.disconnect(); mo.disconnect(); ctl.dispose(); geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); envTex.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss(); };
    const mo = new MutationObserver(() => { if (!wrap.isConnected) dispose(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  return wrap;
}
