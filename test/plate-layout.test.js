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
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 120) < 1e-9, 'środek płytki 12 mm od osi (ΔX)'); assert.ok(Math.abs(Math.max(...zz) - 244) < 1e-9, 'wierzchołek 3 mm niżej niż J (ΔZ = −3)');
    const ins = G.insertsForMesh([s2], G.buildMesh([s2.contour]).offsets); assert.deepEqual(ins.map((q) => [q.central, q.irregular, q.phi]), [[false, true, 30]]);
    // miniatura z własnym układem = ten sam układ co podgląd (y miniatury = offset + y stosu · skala)
    const mini = G.buildMini(t, idx.details('WK2'), (c) => idx.insertContour(c)), mo = mini.outline, b = G.bounds(s2.contour);
    const iTop = zs.indexOf(zTop), iBot = zs.indexOf(zBot), k = (mo[iBot].y - mo[iTop].y) / (zTop - zBot), zMini = (y) => zTop - (y - mo[iTop].y) / k;
    assert.equal(mini.inserts.length, 1); assert.ok(Math.abs(zMini(Math.min(...mini.inserts[0].map((q) => q.y))) - 244) < 1e-6, 'wierzchołek płytki w miniaturze też Z = 244');
    assert.ok(b.maxY > 0);
  } finally { G.setPlateSetupProvider(null); }
});
