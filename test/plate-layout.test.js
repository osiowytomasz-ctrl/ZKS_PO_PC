// Układ płytek na narzędziu: rodzaj (centralna / obwodowa), wiele płytek, położenie (logic/plateLayout.js) i jego wpływ na rysunek zestawu / 3D (toolGeometry).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/renderer/js/logic/plateLayout.js';
import * as G from '../src/renderer/js/logic/toolGeometry.js';

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
