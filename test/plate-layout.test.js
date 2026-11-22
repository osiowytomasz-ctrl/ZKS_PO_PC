// Układ płytek na narzędziu: rodzaj (centralna / obwodowa), wiele płytek, położenie (logic/plateLayout.js) i jego wpływ na rysunek zestawu / 3D (toolGeometry).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/renderer/js/logic/plateLayout.js';
import * as G from '../src/renderer/js/logic/toolGeometry.js';
import * as E from '../src/renderer/js/logic/contourEditor.js';

test('układ płytek: domyślnie z katalogu (pierwsza płytka narzędzia centralnego – centralna), własny układ, zmiany', () => {
  const auto = L.resolvePlates(null, ['ICP', 'SEC'], true);
  assert.deepEqual(auto.map((p) => [p.code, p.central, p.custom]), [['ICP', true, false], ['SEC', false, false]]);
  assert.deepEqual(L.resolvePlates(null, ['A'], false).map((p) => p.central), [false]);   // narzędzie zwykłe – obwodowa
  // własny układ: rodzaj wymuszony, położenie, kąt na obwodzie
  const custom = [{ code: 'ICP', mode: 'edge', dx: 1.5, dz: -2, ang: 10, phi: 90, z: 3 }, { code: 'SEC', mode: 'central' }];
  const r = L.resolvePlates(custom, ['ICP'], true);
  assert.deepEqual(r.map((p) => [p.code, p.central, p.dx, p.dz, p.ang, p.phi, p.z, p.custom]), [['ICP', false, 1.5, -2, 10, 90, 3, true], ['SEC', true, 0, 0, 0, 0, 0, true]]);
  // zmiana jednej płytki tworzy własny układ z płytek katalogu; dodanie, usunięcie; pusty układ = automatyczny
  const p1 = L.patchPlate(null, ['ICP', 'SEC'], 1, { dx: 2 });
  assert.deepEqual(p1.map((p) => [p.code, p.dx]), [['ICP', 0], ['SEC', 2]]);
  const p2 = L.addPlate(p1, ['ICP', 'SEC'], 'NEW', { mode: 'edge' }); assert.equal(p2.length, 3); assert.equal(p2[2].mode, 'edge');
  assert.deepEqual(L.removePlate(p2, [], 0).map((p) => p.code), ['SEC', 'NEW']); assert.equal(L.removePlate(null, ['ICP'], 0), null);
  // normalizacja: liczby z tekstu, śmieci → wartości domyślne, płytki bez kodu pomijane
  assert.deepEqual(L.normPlate({ code: ' X ', mode: 'zly', dx: 'abc', ang: '15', z: '70' }), { code: 'X', mode: 'auto', dx: 0, dz: 0, ang: 15, phi: 0, z: 60 });
  assert.equal(L.normPlates([{ code: '' }]), null); assert.equal(L.normPlates('x'), null);
});

test('rysunek zestawu i 3D wg układu płytek: położenie, rodzaj, wiele płytek, czubek płytki centralnej na czubku narzędzia', () => {
  const plateA = 'M 0 0 L 10 0 L 10 3 L 5 6 L 0 3 Z', plateB = 'M 0 0 L 4 0 L 4 2 L 0 2 Z';
  const t = { productCode: 'W1', columnD: 'wie', columnE: 'ply', columnP: 'AMEC', columnF: '10', columnJ: '50', columnG: '' };
  // kontur z mocowaniem poniżej zera (jak wiertło z Weldonem): płytka ma być przy czubku, nie przesunięta o długość mocowania
  const contour = '-50_-650;50_-650;50_500;-50_500';
  const idx = G.toolIndex({ tools: [t], detailsMap: { W1: { columnAY: contour, insertContours: [{ code: 'A', contour: plateA }, { code: 'B', contour: plateB }] } } }, null);
  try {
    G.setPlateSetupProvider(() => null);   // układ automatyczny: pierwsza płytka centralna, druga obwodowa
    const s0 = G.buildStack([idx.stackTool(t)], true, false).layers[0];
    assert.deepEqual(s0.plates.map((p) => [p.code, p.central, p.polys.length]), [['A', true, 1], ['B', false, 2]]);
    const a = s0.plates[0].polys[0], ys = a.map((p) => p.y), xs = a.map((p) => p.x);
    assert.equal(Math.min(...ys), 0, 'czubek płytki (górna krawędź) na czubku narzędzia – bez przesunięcia o mocowanie'); assert.equal(Math.max(...ys), 60);
    assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-9, 'środek płytki na osi');
    // własny układ: obwodowa z korektą, centralna z obrotem i φ, wiele płytek
    G.setPlateSetupProvider(() => [{ code: 'A', mode: 'edge', dx: 1, dz: 2, ang: 0, phi: 45, z: 4 }, { code: 'B', mode: 'central', dx: 0.5, dz: -1 }, { code: 'A', mode: 'central', phi: 90 }]);
    const s1 = G.buildStack([idx.stackTool(t)], true, false).layers[0];
    assert.deepEqual(s1.plates.map((p) => [p.code, p.central, p.polys.length, p.phi, p.z]), [['A', false, 2, 45, 4], ['B', true, 1, 0, 0], ['A', true, 1, 90, 0]]);
    const base = G.buildStack([idx.stackTool(t, { layout: false })], true, false).layers[0];   // bez własnego układu
    const noAdj = G.buildStack([idx.stackTool(t, { adj: false })], true, false).layers[0];
    const right1 = s1.plates[0].polys[1], right0 = noAdj.plates[0].polys[1];
    assert.ok(Math.abs(right1[0].x - right0[0].x - 10) < 1e-9 && Math.abs(right1[0].y - right0[0].y + 20) < 1e-9, 'ΔX 1 mm w prawo, ΔZ 2 mm w górę (y w dół)');
    assert.ok(Math.abs(s1.plates[0].polys[0][0].x - noAdj.plates[0].polys[0][0].x + 10) < 1e-9, 'lewa płytka – odbicie korekty ΔX');
    assert.equal(base.plates.length, 2);
    const m = G.buildMesh([idx.stackTool(t).contour]), ins = G.insertsForMesh([idx.stackTool(t)], m.offsets);
    assert.deepEqual(ins.map((q) => [q.plate, q.central, q.phi, q.z]), [['A', false, 45, 4], ['B', true, 0, 0], ['A', true, 90, 0]]);
    const yB = ins[1].poly.map((p) => p.y); assert.ok(Math.abs(Math.max(...yB) - 490) < 1e-9, 'w 3D płytka centralna przy czubku narzędzia (y = 500 w 0,1 mm), obniżona o ΔZ = −1 mm');
  } finally { G.setPlateSetupProvider(null); }
});

test('wiertło płytkowe z płytką centralną: długość J = odległość wierzchołka płytki od Z = 0; miniatura, podgląd 2D i 3D zgodne (kontur krótszy od J)', () => {
  // dane jak wiertło AMEC z Weldonem: kontur od Z = −65 do 471,5 (generator), J = 476,3 – korpus krótszy o 10% średnicy, płytka sięga do J
  const params = { D: 'wie', E: 'ply', F: '48', I: '65', J: '476,3', K: '422', M: 'WEL040', N: '' };
  const full = E.expandHalf(E.generatedHalf(params, {})), str = full.map((q) => q.x + '_' + q.y).join(';'), zs = full.map((q) => q.y / 10);
  assert.equal(Math.min(...zs), -65); assert.equal(Math.max(...zs), 471.5);   // korpus krótszy od J o 10% średnicy (4,8 mm)
  const t = { productCode: 'WA1', columnD: 'wie', columnE: 'ply', columnP: 'AMEC', columnF: '48', columnJ: '476.3', columnG: '', columnM: 'WEL040' };
  for (const path of ['M 0 0 L 6 0 L 12 1.5 L 18 0 L 24 0 L 24 4 L 12 9 L 0 4 Z', 'M 0 3 L 6 3 L 12 4.5 L 18 3 L 24 3 L 24 7 L 12 12 L 0 7 Z']) {   // ścieżka od y = 0 i przesunięta
    const idx = G.toolIndex({ tools: [t], detailsMap: { WA1: { columnAY: str, insertContours: [{ code: 'ICP', contour: path }] } } }, null), stt = idx.stackTool(t), b = G.bounds(stt.contour);
    const stack = G.buildStack([stt], true, false).layers[0], pp = stack.plates[0].polys[0];
    const apex2d = (b.maxY - Math.min(...pp.map((q) => q.y))) / 10, bottom2d = (b.maxY - Math.max(...pp.map((q) => q.y))) / 10;
    const ins = G.insertsForMesh([stt], G.buildMesh([stt.contour]).offsets), z3 = ins[0].poly.map((q) => q.y / 10);
    // miniatura: skala i początek z konturu (outline ma te same punkty co kontur)
    const mini = G.buildMini(t, idx.details('WA1')), iTop = zs.indexOf(471.5), iBot = zs.indexOf(-65);
    const k = (mini.outline[iBot].y - mini.outline[iTop].y) / (471.5 + 65), zMini = (y) => 471.5 - (y - mini.outline[iTop].y) / k;
    const my = mini.inserts[0].map((q) => q.y), apexMini = zMini(Math.min(...my)), bottomMini = zMini(Math.max(...my));
    for (const [name, v] of [['2D', apex2d], ['3D', Math.max(...z3)], ['miniatura', apexMini]]) assert.ok(Math.abs(v - 476.3) < 1e-6, `wierzchołek płytki (${name}) = J: ${v}`);
    for (const [name, v] of [['2D', bottom2d], ['3D', Math.min(...z3)], ['miniatura', bottomMini]]) assert.ok(Math.abs(v - 467.3) < 1e-6, `dół płytki (${name}) = J − wysokość płytki: ${v}`);
  }
});

test('wiertło płytkowe Komet (płytki nie są centralne): wierzchołek płytki na Z = J (korpus 10 mm krótszy), tryb „nieregularnie”, miniatura zgodna z podglądem', () => {
  const params = { D: 'wie', E: 'ply', F: '64', I: '', J: '247', K: '192', M: 'ABS080', N: '' };
  const full = E.expandHalf(E.generatedHalf(params, {})), str = full.map((q) => q.x + '_' + q.y).join(';'), zs = full.map((q) => q.y / 10);
  const zTop = Math.max(...zs), zBot = Math.min(...zs);
  assert.ok(zBot < 0 && zTop < 247, 'kontur z mocowaniem poniżej Z = 0, korpus krótszy od J: ' + zBot + ' … ' + zTop);
  const plate = 'M 0 0 L 8 0 L 8 6 L 4 11 L 0 6 Z';
  const t = { productCode: 'WK2', columnD: 'wie', columnE: 'ply', columnP: 'Komet', columnF: '64', columnJ: '247', columnG: '', columnM: 'ABS080' };
  const idx = G.toolIndex({ tools: [t], detailsMap: { WK2: { columnAY: str, insertContours: [{ code: 'V14', contour: plate }] } } }, null);
  const zOf = (stt, poly) => { const b = G.bounds(stt.contour); return poly.map((q) => (b.maxY - q.y) / 10); };
  try {
    // automatycznie: Komet to nie płytka centralna – para przy krawędzi, ale wierzchołek płytki na Z = J (nie przesunięty o długość mocowania)
    G.setPlateSetupProvider(() => null);
    const stt = idx.stackTool(t), lay = G.buildStack([stt], true, false).layers[0];
    assert.equal(stt.central, false); assert.equal(stt.drill, true);
    assert.deepEqual(lay.plates.map((p) => [p.kind, p.polys.length, p.single]), [['edge', 2, false]]);
    assert.ok(Math.abs(Math.max(...lay.plates[0].polys[1].flatMap((p) => zOf(stt, [p]))) - 247) < 1e-9, 'wierzchołek płytki obwodowej na Z = J');
    // nieregularnie: jedna płytka w dowolnym miejscu (start na osi, wierzchołek Z = J), przesunięta o ΔX / ΔZ; 3D – pojedyncza płytka z kątem na obwodzie
    // miniatura Komet (układ automatyczny) = ten sam układ co podgląd: para przy krawędzi, wierzchołki płytek na Z = J (dawniej płytka na osi)
    const mini0 = G.buildMini(t, idx.details('WK2'), (c) => idx.insertContour(c)), mo0 = mini0.outline, iT0 = zs.indexOf(zTop), iB0 = zs.indexOf(zBot);
    const k0 = (mo0[iB0].y - mo0[iT0].y) / (zTop - zBot), zM0 = (y) => zTop - (y - mo0[iT0].y) / k0;
    assert.equal(mini0.inserts.length, 2); assert.ok(Math.abs(zM0(Math.min(...mini0.inserts[1].map((q) => q.y))) - 247) < 1e-6);
    assert.ok(mini0.inserts[0].every((q) => q.x < mo0[iT0].x) && mini0.inserts[1].every((q) => q.x > mo0[iT0].x), 'płytki po obu stronach osi, nie na osi');
    G.setPlateSetupProvider(() => [{ code: 'V14', mode: 'irregular', dx: 12, dz: -3, ang: 0, phi: 30 }]);
    const s2 = idx.stackTool(t), l2 = G.buildStack([s2], true, false).layers[0], pm = l2.plates[0];
    assert.deepEqual([pm.kind, pm.single, pm.polys.length, pm.irregular, pm.central, pm.phi], ['irregular', true, 1, true, false, 30]);
    const xs = pm.polys[0].map((p) => p.x), zz = zOf(s2, pm.polys[0]);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 120 * Math.cos(Math.PI / 6)) < 1e-6, 'środek płytki 12 mm od osi (ΔX) w rzucie z boku – skrócony przez cos φ (φ = 30°)'); assert.ok(Math.abs(Math.max(...zz) - 244) < 1e-9, 'wierzchołek 3 mm niżej niż J (ΔZ = −3)');
    const ins = G.insertsForMesh([s2], G.buildMesh([s2.contour]).offsets); assert.deepEqual(ins.map((q) => [q.central, q.irregular, q.phi]), [[false, true, 30]]);
    // miniatura z własnym układem = ten sam układ co podgląd (y miniatury = offset + y stosu · skala)
    const mini = G.buildMini(t, idx.details('WK2'), (c) => idx.insertContour(c)), mo = mini.outline, b = G.bounds(s2.contour);
    const iTop = zs.indexOf(zTop), iBot = zs.indexOf(zBot), k = (mo[iBot].y - mo[iTop].y) / (zTop - zBot), zMini = (y) => zTop - (y - mo[iTop].y) / k;
    assert.equal(mini.inserts.length, 1); assert.ok(Math.abs(zMini(Math.min(...mini.inserts[0].map((q) => q.y))) - 244) < 1e-6, 'wierzchołek płytki w miniaturze też Z = 244');
    assert.ok(b.maxY > 0);
  } finally { G.setPlateSetupProvider(null); }
});

test('narzędzie pokazuje tylko płytki do niego przypisane – własny układ z cudzą płytką jest ignorowany', () => {
  const t = { productCode: 'W2', columnD: 'wie', columnE: 'ply', columnP: 'AMEC', columnF: '10', columnJ: '50', columnG: '' };
  const idx = G.toolIndex({ tools: [t], detailsMap: { W2: { columnAY: '-50_-650;50_-650;50_500;-50_500', partsCutting: ['A'], insertContours: [{ code: 'A', contour: 'M 0 0 L 10 0 L 10 3 Z' }] } } }, null);
  try {
    G.setPlateSetupProvider(() => [{ code: 'OBCA', mode: 'edge' }, { code: 'A', mode: 'edge' }]);
    assert.deepEqual(idx.stackTool(t).plates.map((p) => p.code), ['A'], 'cudza płytka usunięta z układu');
    G.setPlateSetupProvider(() => [{ code: 'OBCA', mode: 'edge' }]);
    assert.deepEqual(idx.stackTool(t).plates.map((p) => p.code), ['A'], 'układ tylko z cudzą płytką → płytki katalogu narzędzia');
  } finally { G.setPlateSetupProvider(null); }
});

test('płytka obrócona wokół osi narzędzia (φ = 180°): w rzucie z boku lustrzane odbicie względem osi, 3D dostaje położenie przed obrotem', () => {
  const plateA = 'M 0 0 L 10 0 L 10 3 L 5 6 L 0 3 Z';
  const t = { productCode: 'K1', columnD: 'wie', columnE: 'ply', columnP: 'Komet', columnF: '10', columnJ: '50', columnG: '' };
  const idx = G.toolIndex({ tools: [t], detailsMap: { K1: { columnAY: '-50_-650;50_-650;50_500;-50_500', insertContours: [{ code: 'A', contour: plateA }] } } }, null);
  try {
    G.setPlateSetupProvider(() => [{ code: 'A', mode: 'irregular', dx: 2, phi: 0 }, { code: 'A', mode: 'irregular', dx: 2, phi: 180 }]);
    const lay = G.buildStack([idx.stackTool(t)], true, false).layers[0];
    const [p0, p1] = lay.plates;
    assert.deepEqual(p1.polys[0].map((q) => Math.round(q.x * 1e6) / 1e6 || 0), p0.polys[0].map((q) => Math.round(-q.x * 1e6) / 1e6 || 0), 'φ = 180° odbija płytkę względem osi');
    assert.deepEqual(p1.polys[0].map((q) => q.y), p0.polys[0].map((q) => q.y), 'wysokość bez zmian');
    assert.deepEqual(p1.src[0], p0.src[0], 'położenie przed obrotem to samo – obrót robi widok 3D');
    const m = G.buildMesh([idx.stackTool(t).contour]), ins = G.insertsForMesh([idx.stackTool(t)], m.offsets);
    assert.deepEqual(ins.map((q) => q.phi), [0, 180]);
    assert.deepEqual(ins[1].poly, ins[0].poly);
  } finally { G.setPlateSetupProvider(null); }
});

test('podgląd zapisu (tylko pierwsza płytka) nie gubi drugiej płytki wiertła płytkowego ani własnego układu', () => {
  const plate = 'M 0 0 L 10 0 L 10 3 L 5 6 L 0 3 Z';
  const mk = (company, group = 'wie', type = 'ply') => ({ productCode: 'W1', columnD: group, columnE: type, columnP: company, columnF: '10', columnJ: '50', columnG: '' });
  const det = { columnAY: '-50_-650;50_-650;50_500;-50_500', insertContours: [{ code: 'A', contour: plate }, { code: 'B', contour: plate }] };
  const cnt = (t) => { const idx = G.toolIndex({ tools: [t], detailsMap: { W1: det } }, null); return G.buildStack([idx.stackTool(t)], false, true).layers[0].plates.length; };
  assert.equal(cnt(mk('Komet')), 2, 'wiertło Komet – obie płytki');
  assert.equal(cnt(mk('ISCAR')), 2, 'drugą płytką wiertła płytkowego ISCAR jest obwodowa – wiertło płytkowe pokazuje wszystkie');
  assert.equal(cnt(mk('Iscar', 'fre', 'wsp')), 1, 'frez: tylko pierwsza płytka (reszta to zamienniki)');
  try {
    G.setPlateSetupProvider(() => [{ code: 'A', mode: 'edge' }, { code: 'B', mode: 'edge' }]);
    assert.equal(cnt(mk('Iscar', 'fre', 'wsp')), 2, 'własny układ – wszystkie płytki układu');
  } finally { G.setPlateSetupProvider(null); }
});

test('pierwsza zmiana układu płytek (np. punkt bazowy, φ) nie kasuje pochylenia z tabeli ani rzędów plunger / jeż', () => {
  const plate = 'M 0 0 L 6 0 L 6 8 L 0 8 Z';
  const t = { productCode: 'P1', columnD: 'fre', columnE: 'plu', columnP: 'X', columnF: '100', columnJ: '80', columnM: 'ABS063', columnG: '10' };
  const ov = (() => { const o = new Map(); o.params = new Map([['p1', { D: 'fre', E: 'plu', G: '10', K: '50' }]]); o.regions = new Map(); o.generated = new Set(); o.blade = new Map(); return o; })();
  const idx = G.toolIndex({ tools: [t], detailsMap: { P1: { columnAY: '-400_0;400_0;400_770;-400_770', insertContours: [{ code: 'A', contour: plate }, { code: 'B', contour: plate }] } } }, ov);
  const stt = idx.stackTool(t), specs = L.specsFromPlates(stt.plates);
  assert.deepEqual(specs.map((p) => [p.code, p.mode, p.ang, p.dz]), [['A', 'edge', 10, 0], ['B', 'edge', 10, -42]]);
  const next = L.patchPlate(L.normPlates(specs), ['A', 'B'], 0, { phi: 30 });
  assert.deepEqual(next.map((p) => [p.ang, p.dz, p.phi]), [[10, 0, 30], [10, -42, 0]], 'kąt z tabeli i rzędy zostają po zmianie jednego pola');
  // układ zapisany jako własny rysuje się tak samo (bez zmiany pochylenia)
  try { G.setPlateSetupProvider(() => next); assert.deepEqual(idx.stackTool(t).plates.map((p) => p.ang), [10, 10]); } finally { G.setPlateSetupProvider(null); }
});

test('kąt skrawania G: 90° – bez obrotu płytek; plu / jez – pochylenie G; pozostałe frezy – obrót o 90° − G; zapisany kąt w układzie płytek narzędzia', () => {
  const plate = 'M 0 0 L 6 0 L 6 8 L 0 8 Z';
  assert.deepEqual([G.plateTilt({ columnE: 'plu' }, 10), G.plateTilt({ columnE: 'jez' }, 10), G.plateTilt({ columnE: 'faz' }, 45), G.plateTilt({ columnE: 'faz' }, 60), G.plateTilt({ columnE: 'tar' }, 90), G.plateTilt({ columnE: 'faz' }, 0), G.plateTilt({ columnE: 'faz' }, 120)], [10, 10, 45, 30, 0, 0, 0]);
  const mk = (E, g) => ({ productCode: 'T1', columnD: 'fre', columnE: E, columnP: 'X', columnF: '50', columnJ: '60', columnM: 'ABS063', columnG: String(g) });
  const idx = (t) => G.toolIndex({ tools: [t], detailsMap: { T1: { columnAY: '-250_0;250_0;250_590;-250_590', insertContours: [{ code: 'A', contour: plate }] } } }, null);
  const t90 = mk('tar', 90), t60 = mk('tar', 60);
  assert.equal(idx(t90).stackTool(t90).plates[0].ang, 0, 'kąt 90° – płytka w normalnym położeniu'); assert.equal(idx(t60).stackTool(t60).plates[0].ang, 30, 'kąt skrawania 60° → obrót płytki o 30°');
  // zapisany własny układ (kąt w właściwościach płytki) ma pierwszeństwo
  try { G.setPlateSetupProvider(() => [{ code: 'A', mode: 'edge', ang: 5 }]); assert.equal(idx(t60).stackTool(t60).plates[0].ang, 5); } finally { G.setPlateSetupProvider(null); }
});

test('krawędź skrawająca płytki: koniec dalszy od osi na Ø narzędzia; fazownik – krawędzie płytek na jednej linii pod kątem', () => {
  const plate = 'M 0 0 L 10 0 L 10 4 L 0 4 Z';   // 10 × 4 mm; krawędź skrawająca: górna (0,0) → (10,0)
  const edge = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  const cut = { productCode: 'T1', columnD: 'fre', columnE: 'pal', columnP: 'X', columnF: '50', columnJ: '60', columnM: 'ABS063', columnG: '' };
  const ix = (t, extra = {}) => G.toolIndex({ tools: [t], detailsMap: { T1: { columnAY: '-250_0;250_0;250_590;-250_590', insertContours: [{ code: 'A', contour: plate }] } } }, extra.ov || null);
  try {
    G.setPlateEdgeProvider(() => edge);
    const m = G.buildStack([ix(cut).stackTool(cut)], true, false).layers[0].plates[0], right = m.polys[1];
    // punkt skrawający (dalszy od osi koniec krawędzi) na promieniu Ø/2 = 250 i na wysokości czoła (J = 60 mm → y = maxY − 600 = −10)
    const cp = right.filter((q) => Math.abs(q.y - Math.min(...right.map((r) => r.y))) < 1e-6).sort((a, b) => b.x - a.x)[0];
    assert.ok(Math.abs(cp.x - 250) < 1e-6, 'punkt skrawający na Ø/2'); assert.ok(Math.abs(cp.y - -10) < 1e-6, 'na wysokości czoła');
    // fazownik: Ø mniejsza 40, większa 80, kąt G = 45 → linia fazy; trzy płytki (katalog) z krawędziami na tej linii
    const faz = { ...cut, columnE: 'faz', columnF: '40', columnG: '45' }, ov = new Map(); ov.params = new Map([['t1', { D: 'fre', E: 'faz', F: '40', G: '45', I: '80', K: '30' }]]); ov.regions = new Map(); ov.generated = new Set(); ov.blade = new Map();
    const stF = ix(faz, { ov }).stackTool(faz);
    assert.equal(stF.plates.length, 1, 'jedna płytka w katalogu – jeden rząd'); assert.ok(stF.plates[0].align && stF.plates[0].anchor);
    const mf = G.buildStack([stF], true, false).layers[0].plates[0], rp = mf.polys[1];
    const top = rp.filter((q) => Math.abs(q.y - Math.min(...rp.map((r) => r.y))) < 1e-3);
    void top;
    // krawędź skrawająca (górna po obrocie) leży wzdłuż linii fazy: kąt nachylenia 45° od poziomu
    const e = rp.slice().sort((a, b) => a.y - b.y).slice(0, 2), ang = Math.abs(Math.atan2(e[1].y - e[0].y, e[1].x - e[0].x) * 180 / Math.PI);
    assert.ok(Math.abs(ang - 45) < 1 || Math.abs(ang - 135) < 1, 'krawędź skrawająca pod kątem fazy');
    // bez zaznaczonej krawędzi fazownik zachowuje dotychczasowy układ
    G.setPlateEdgeProvider(null);
    assert.ok(!ix(faz, { ov }).stackTool(faz).plates[0].align);
  } finally { G.setPlateEdgeProvider(null); }
});
