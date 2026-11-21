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
