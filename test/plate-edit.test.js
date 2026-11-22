// Edytor płytki: logika konturu płytki (plateEdit.js), płytki centralne (ISCAR / AMEC) i zapis konturu płytki w backendzie (Kontury.gs, plSaveContour).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as P from '../src/renderer/js/logic/plateEdit.js';
import * as G from '../src/renderer/js/logic/toolGeometry.js';

test('kontur płytki: odczyt ścieżki, zapis, przekształcenia i walidacja', () => {
  const path = 'M 0 0 L 8 0 L 8 6 L 4 8 L 0 6 Z';
  const { pts, hasArcs } = P.parsePlate(path);
  assert.equal(hasArcs, false); assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 4, y: 8 }, { x: 0, y: 6 }]);
  assert.equal(P.plateToPath(pts), path); assert.equal(P.plateToPath(pts.slice(0, 2)), '');
  assert.equal(P.parsePlate('M 0 0 L 4 0 A 1 1 0 0 1 5 1 L 5 4 L 0 4 Z').hasArcs, true);
  const b = P.plateBounds(pts); assert.deepEqual([b.w, b.h, b.cx, b.cy], [8, 8, 4, 4]);
  // odbicia, obrót, skala
  assert.deepEqual(P.mirrorX([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]).map((p) => [p.x, p.y]), [[6, 4], [0, 4], [0, 0], [6, 0]]);   // odbicie względem osi pionowej środka
  const sq = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }];
  const r90 = P.rotate(sq, 90), rb = P.plateBounds(r90); assert.deepEqual([rb.w, rb.h], [2, 4]);
  const sc = P.scale(sq, 50), sb = P.plateBounds(sc); assert.deepEqual([sb.w, sb.h, sb.cx, sb.cy], [2, 1, 2, 1]);
  assert.deepEqual(P.toOrigin([{ x: 5, y: 7 }, { x: 9, y: 7 }, { x: 9, y: 10 }]).map((p) => [p.x, p.y]), [[0, 0], [4, 0], [4, 3]]);
  // punkty: wstawienie, usunięcie (min. 3), zmiana kolejności, siatka
  assert.deepEqual(P.insertAfter(sq, 0)[1], { x: 2, y: 0 }); assert.equal(P.insertAfter(sq, 3).length, 5); assert.deepEqual(P.insertAfter(sq, 3)[4], { x: 0, y: 1 });
  assert.equal(P.removeAt(sq, 1).length, 3); assert.equal(P.removeAt(P.removeAt(sq, 1), 0).length, 3);
  assert.deepEqual(P.moveIndex(sq, 0, 1).slice(0, 2), [sq[1], sq[0]]); assert.equal(P.moveIndex(sq, 0, -1), sq);
  assert.equal(P.snap(1.234, 0.05), 1.25); assert.equal(P.snap(1.234, 0.01), 1.23); assert.equal(P.snap(1.234, 0), 1.234);
  // samoprzecięcie i podgląd 3D
  assert.equal(P.selfIntersects(sq), false); assert.equal(P.selfIntersects([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }]), true);
  const pv = P.previewPoly(sq); assert.deepEqual(pv.map((p) => [p.x, p.y]), [[-20, 0], [20, 0], [20, -20], [-20, -20]]);
});

test('płytki centralne wierteł ISCAR / AMEC: jedna płytka na osi, czubek na czubku narzędzia; frezy – para przy obwodzie', () => {
  const plate = 'M 0 0 L 10 0 L 10 3 L 5 6 L 0 3 Z';   // 10 × 6 mm
  const mk = (company, group = 'wie', type = 'ply') => ({ productCode: 'W1', columnD: group, columnE: type, columnP: company, columnF: '10', columnJ: '50', columnG: '' });
  assert.equal(G.isCentralTool(mk('ISCAR')), true); assert.equal(G.isCentralTool(mk('Amec')), true);
  assert.equal(G.isCentralTool(mk('Komet')), false); assert.equal(G.isCentralTool(mk('ISCAR', 'fre', 'pal')), false);
  const catalog = (t) => ({ tools: [t], detailsMap: { W1: { columnAY: '0_0;50_0;50_500;0_500', insertContours: [{ code: 'ICP', contour: plate }] } } });
  const cen = G.toolIndex(catalog(mk('ISCAR')), null), per = G.toolIndex(catalog(mk('Komet')), null);
  const sc = cen.stackTool(cen.tool('W1')), sp = per.stackTool(per.tool('W1'));
  assert.equal(sc.central, true); assert.equal(sp.central, false);
  const lc = G.buildStack([sc], true, false).layers[0].inserts, lp = G.buildStack([sp], true, false).layers[0].inserts;
  assert.equal(lc.length, 1); assert.equal(lp.length, 2);
  const xs = lc[0].map((p) => p.x); assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-9, 'płytka wyśrodkowana na osi (x = 0)');
  assert.equal(Math.max(...xs) - Math.min(...xs), 100);   // 10 mm
  const m = G.buildMesh([sc.contour]), ic = G.insertsForMesh([sc], m.offsets), ip = G.insertsForMesh([sp], G.buildMesh([sp.contour]).offsets);
  assert.equal(ic.length, 1); assert.equal(ic[0].central, true); assert.equal(ip.length, 1); assert.equal(ip[0].central, false);   // frez: tylko prawa płytka pary
  // podmiana konturu płytki w pamięci (po edycji)
  assert.equal(cen.setInsertContour('icp', 'M 0 0 L 4 0 L 4 4 Z'), 1); assert.equal(cen.insertContour('ICP'), 'M 0 0 L 4 0 L 4 4 Z');
});

// Atrapa arkusza PL_kontur (kolumny A i G) do sprawdzenia pl_saveContour_ z Kontury.gs bez Google.
test('backend: plSaveContour zapisuje kontur płytki w kolumnie G wiersza z kodem w kolumnie A (MASTER / GOD)', () => {
  const rows = [['kod', '', '', '', '', '', 'kontur'], ['ICP 100', '', '', '', '', '', ''], ['Sec 12', '', '', '', '', '', 'M 0 0 L 1 1 Z']];
  const sheet = {
    getLastRow: () => rows.length,
    getRange: (r, c, nr = 1) => ({ getDisplayValues: () => Array.from({ length: nr }, (_, i) => [String(rows[r - 1 + i][c - 1] ?? '')]), getDisplayValue: () => String(rows[r - 1][c - 1] ?? ''), setValue: (v) => { rows[r - 1][c - 1] = v; } }),
  };
  let level = 'master';
  const ctx = { SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => (n === 'PL_kontur' ? sheet : null) }) }, api_requireGrafikLevel_: (c, need) => { if (level !== need && level !== 'god') throw new Error('Brak uprawnień'); }, STOCKSHEET: 'ND_CACHE', ND_CACHE_RANGE_CELL: 'H1', Error };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(new URL('../backend/Kontury.gs', import.meta.url), 'utf8'), ctx);
  const r = ctx.pl_saveContour_('icp   100', 'M 0 0 L 8 0 L 8 6 Z', {});
  assert.equal(r.row, 2); assert.equal(rows[1][6], 'M 0 0 L 8 0 L 8 6 Z'); assert.equal(rows[2][6], 'M 0 0 L 1 1 Z', 'inne wiersze bez zmian');
  assert.equal(ctx.pl_saveContour_('Sec 12', '', {}).row, 3); assert.equal(rows[2][6], '');   // pusty – usunięcie konturu
  assert.throws(() => ctx.pl_saveContour_('Brak', 'M 0 0 L 1 1 Z', {}), /Nie ma płytki/);
  assert.throws(() => ctx.pl_saveContour_('ICP 100', '<script>', {}), /ścieżką SVG/);
  assert.throws(() => ctx.pl_saveContour_('', 'M 0 0 L 1 1 Z', {}), /Brak kodu/);
  level = 'tourist'; assert.throws(() => ctx.pl_saveContour_('ICP 100', 'M 0 0 L 1 1 Z', {}), /Brak uprawnień/);
});

test('edytor płytki: łuki zostają łukami (zapis „A”, nie krótkie odcinki), odbicie / skala / wstawianie punktu zachowują łuk', () => {
  const path = 'M 0 0 L 4 0 A 1 1 0 0 1 5 1 L 5 4 L 0 4 Z';
  const { pts, hasArcs, lossy } = P.parsePlate(path);
  assert.equal(hasArcs, true); assert.equal(lossy, false);
  assert.deepEqual(pts[1], { x: 4, y: 0, arc: { r: 1, sweep: 1, large: 0 } });
  assert.equal(pts.length, 5, 'łuk nie rozbija się na punkty');
  assert.equal(P.plateToPath(pts), path, 'zapis zachowuje łuk');
  // łuk zamykający (do pierwszego punktu)
  const closed = P.parsePlate('M 0 0 L 4 0 L 4 4 A 4 4 0 0 1 0 0 Z');
  assert.equal(closed.pts.length, 3); assert.equal(P.plateToPath(closed.pts), 'M 0 0 L 4 0 L 4 4 A 4 4 0 0 1 0 0 Z');
  // obwiednia uwzględnia wybrzuszenie łuku, flatten daje punkty pośrednie
  const bulge = [{ x: 0, y: 0, arc: { r: 2, sweep: 1, large: 0 } }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
  assert.ok(P.plateBounds(bulge).minY < -1.9, 'łuk wystaje nad cięciwę (półokrąg R2)'); assert.ok(P.flatten(bulge).length > 4);
  // odbicie: łuk przechodzi do lustrzanego miejsca, zapis dalej ma A
  const mx = P.mirrorX(pts); assert.equal(P.plateToPath(mx), 'M 5 4 L 0 4 L 0 1 A 1 1 0 0 1 1 0 L 5 0 Z');
  assert.equal(P.plateToPath(P.scale(pts, 200)).includes('A 2 2 0 0 1'), true, 'skala zmienia też promień łuku');
  // wstawienie punktu na łuku: punkt leży na łuku, obie części są łukami tego samego promienia
  const ins = P.insertAfter(pts, 1); assert.equal(ins.length, 6); assert.deepEqual(ins[1].arc, { r: 1, sweep: 1, large: 0 }); assert.deepEqual(ins[2].arc, { r: 1, sweep: 1, large: 0 });
  assert.ok(Math.abs(Math.hypot(ins[2].x - 4, ins[2].y - 1) - 1) < 2e-3, 'punkt na okręgu o środku (4, 1)');
  // usunięcie punktu zamienia sąsiedni łuk w odcinek
  assert.equal(P.removeAt(pts, 2).some((p) => p.arc), false);
  // przeciągnięcie odcinka w łuk (strzałka → promień): cięciwa 4, strzałka 2 = półokrąg R2; blisko cięciwy – odcinek
  const a = { x: 0, y: 0 }, b = { x: 4, y: 0 };
  assert.deepEqual(P.arcThrough(a, b, { x: 2, y: -2 }), { r: 2, sweep: 1, large: 0 }); assert.equal(P.arcThrough(a, b, { x: 2, y: 0.001 }), null);
  assert.equal(P.arcThrough(a, b, { x: 2, y: 2 }).sweep, 0, 'wybrzuszenie w drugą stronę – przeciwny zwrot');
  // krzywa Q albo łuk eliptyczny – przybliżenie (lossy)
  assert.equal(P.parsePlate('M 0 0 L 4 0 Q 6 2 4 4 L 0 4 Z').lossy, true); assert.equal(P.parsePlate('M 0 0 L 4 0 A 2 1 0 0 1 5 1 L 0 4 Z').lossy, true);
  // pole i podgląd 3D z łuków
  assert.ok(Math.abs(Math.abs(P.area([{ x: 0, y: 0, arc: { r: 2, sweep: 1, large: 0 } }, { x: 4, y: 0 }, { x: 4, y: 0.0001 }])) - Math.PI * 2) < 0.2);
  assert.ok(P.previewPoly(pts).length > 5);
});

test('punkt bazowy płytki: propozycje, przekształcenia, położenie na narzędziu i obrót wokół niego', () => {
  const sq = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 0, y: 4 }];
  const pr = P.basePresets(sq), by = (id) => pr.find((q) => q.id === id).pt;
  assert.deepEqual(by('c'), { x: 4, y: 2 }); assert.deepEqual(by('tl'), { x: 0, y: 0 }); assert.deepEqual(by('br'), { x: 8, y: 4 }); assert.deepEqual(by('p2'), { x: 8, y: 4 }); assert.deepEqual(by('bc'), { x: 4, y: 4 });
  assert.deepEqual(P.mapBase('mirrorX', { x: 1, y: 1 }, sq), { x: 7, y: 1 }); assert.deepEqual(P.mapBase('origin', { x: 5, y: 7 }, [{ x: 4, y: 6 }, { x: 9, y: 9 }]), { x: 1, y: 1 });
  assert.deepEqual(P.mapBase('scale', { x: 0, y: 0 }, sq, 50), { x: 2, y: 1 }); assert.equal(P.mapBase('rotate', null, sq, 90), null);
  assert.deepEqual(P.normBase({ x: '3,5'.replace(',', '.'), y: 2 }), { x: 3.5, y: 2 }); assert.equal(P.normBase({ x: '', y: 1 }), null); assert.equal(P.normBase(null), null);
  // przekształcenie afiniczne i położenie punktu bazowego w narzędziu
  const raw = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }], poly = raw.map((p) => ({ x: 2 * 100 - p.x, y: 300 + p.y }));   // odbicie X + przesunięcie
  const f = G.affineFit(raw, poly); assert.deepEqual(f({ x: 10, y: 20 }), { x: 190, y: 320 });
  assert.deepEqual(G.basePlaced(raw, poly, { x: 1, y: 2 }), { x: 190, y: 320 }); assert.equal(G.basePlaced(raw, poly, null), null);
  const t = { productCode: 'B1', columnD: 'fre', columnE: 'wsp', columnP: 'Iscar', columnF: '10', columnJ: '50', columnG: '' };
  const idx = G.toolIndex({ tools: [t], detailsMap: { B1: { columnAY: '-50_-650;50_-650;50_500;-50_500', insertContours: [{ code: 'P', contour: 'M 0 0 L 8 0 L 8 4 L 0 4 Z' }] } } }, null);
  try {
    const at = (base, ang = 0) => { G.setPlateBaseProvider(() => base); const st = idx.stackTool(t); st.plates = st.plates.map((p) => ({ ...p, ang })); const m = G.buildStack([st], true, false).layers[0].plates[0]; return m; };
    const none = at(null), mid = at({ x: 4, y: 2 });
    assert.equal(none.bases[1], null); assert.ok(mid.bases[1]);
    const poly1 = mid.polys[1], cx = (Math.min(...poly1.map((q) => q.x)) + Math.max(...poly1.map((q) => q.x))) / 2;
    assert.ok(Math.abs(mid.bases[1].x - cx) < 1e-6, 'środek obwiedni płytki = punkt bazowy');
    // obrót korekty wokół punktu bazowego: punkt bazowy się nie rusza
    const rot = at({ x: 0, y: 0 }, 30), flat = at({ x: 0, y: 0 }, 0);
    assert.ok(Math.abs(rot.bases[1].x - flat.bases[1].x) < 1e-6 && Math.abs(rot.bases[1].y - flat.bases[1].y) < 1e-6, 'obrót wokół punktu bazowego');
    assert.notDeepEqual(rot.polys[1], flat.polys[1]);
  } finally { G.setPlateBaseProvider(null); }
});

test('punkty bazowe płytki pochylonej: cztery rogi prostokąta opisanego w układzie narzędzia (linie skrajne konturu)', () => {
  const plate = 'M 0 0 L 8 0 L 8 4 L 0 4 Z';   // prostokąt 8 × 4 mm
  const c0 = G.plateCorners(plate, { kind: 'edge', ang: 0 }), by = (c, id) => c.find((q) => q.id === id).pt;
  assert.equal(c0.length, 4);
  // bez pochylenia rogi opisane = narożniki płytki (płytka obwodowa prawa jest odbita w X)
  assert.deepEqual(c0.map((q) => [q.pt.x, q.pt.y]).sort(), [[0, 0], [0, 4], [8, 0], [8, 4]].sort());
  // po pochyleniu o 30° prostokąt opisany jest większy, a jego rogi leżą POZA płytką (w powietrzu): każdy róg jest poza wielokątem
  const c30 = G.plateCorners(plate, { kind: 'central', ang: 30 }), poly = [[0, 0], [8, 0], [8, 4], [0, 4]];
  const inside = (p) => p.x >= -1e-9 && p.x <= 8 + 1e-9 && p.y >= -1e-9 && p.y <= 4 + 1e-9;
  assert.equal(c30.length, 4); assert.ok(c30.every((q) => !inside(q.pt)), 'rogi skrajne pochylonej płytki leżą poza konturem'); void poly;
  // punkt wybrany jako bazowy leży po ułożeniu na linii skrajnej: położenie w narzędziu = róg prostokąta opisanego na płytce
  const t = { productCode: 'T1', columnD: 'wie', columnE: 'ply', columnP: 'AMEC', columnF: '10', columnJ: '50', columnG: '' };
  const idx = G.toolIndex({ tools: [t], detailsMap: { T1: { columnAY: '-50_-650;50_-650;50_500;-50_500', insertContours: [{ code: 'A', contour: plate }] } } }, null);
  try {
    G.setPlateSetupProvider(() => [{ code: 'A', mode: 'central', ang: 30 }]);
    const corner = by(c30, 'k_tl'); G.setPlateBaseProvider(() => corner);
    const m = G.buildStack([idx.stackTool(t)], true, false).layers[0].plates[0], poly2 = m.polys[0], b = m.bases[0];
    assert.ok(Math.abs(b.x - Math.min(...poly2.map((p) => p.x))) < 0.01 && Math.abs(b.y - Math.min(...poly2.map((p) => p.y))) < 0.01,   // z dokładnością zaokrąglenia do 0,001 mm
     'lewy górny róg skrajny = (min X, min Y) płytki na narzędziu');
    assert.equal(m.corners.length, 4);
  } finally { G.setPlateSetupProvider(null); G.setPlateBaseProvider(null); }
});

test('plunger (fre / plu): domyślny punkt bazowy płytek = róg skrajny prawy górny; wybór użytkownika ma pierwszeństwo', () => {
  const plate = 'M 0 0 L 8 0 L 8 4 L 0 4 Z';
  const mk = (E) => ({ productCode: 'P1', columnD: 'fre', columnE: E, columnP: 'X', columnF: '100', columnJ: '80', columnM: 'ABS063', columnG: '' });
  const ix = (t) => G.toolIndex({ tools: [t], detailsMap: { P1: { columnAY: '-400_0;400_0;400_770;-400_770', insertContours: [{ code: 'A', contour: plate }] } } }, null);
  try {
    const tp = mk('plu'), st = ix(tp).stackTool(tp), m = G.buildStack([st], true, false).layers[0].plates[0], poly = m.polys[1];
    assert.ok(st.plates[0].base, 'plunger bez wyboru dostaje domyślny punkt bazowy');
    // prawa płytka pary: punkt bazowy = prawy górny róg prostokąta opisanego (max X, min Y rysunku)
    assert.ok(Math.abs(m.bases[1].x - Math.max(...poly.map((q) => q.x))) < 0.01 && Math.abs(m.bases[1].y - Math.min(...poly.map((q) => q.y))) < 0.01);
    // inne frezy – bez domyślnego punktu
    const tj = mk('jez'); assert.equal(ix(tj).stackTool(tj).plates[0].base, null);
    // wybór zapisany wcześniej (inny punkt bazowy) nie jest zastępowany
    G.setPlateBaseProvider(() => ({ x: 4, y: 2 }));
    assert.deepEqual(ix(tp).stackTool(tp).plates[0].base, { x: 4, y: 2 });
  } finally { G.setPlateBaseProvider(null); }
  assert.equal(G.isPlunger(mk('plu')), true); assert.equal(G.isPlunger(mk('pal')), false);
});
