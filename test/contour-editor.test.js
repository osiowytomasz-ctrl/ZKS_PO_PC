// Edytor konturów: połowa → cały kontur SVG (mm), odczyt z T i V, zaokrąglenia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/renderer/js/logic/contourEditor.js';
import { parseContour, bounds } from '../src/renderer/js/logic/toolGeometry.js';

test('połowa z kolumny T i pełny kontur SVG', () => {
  const t = parseContour('-80_0;80_0;80_450;100_450;100_600;-100_600;-100_450;-80_450');
  const half = E.halfFromContour(t);
  assert.deepEqual(half.map((r) => [r.z, r.r]), [['0', '8'], ['45', '8'], ['45', '10'], ['60', '10']]);
  const svg = E.toSvg(half);
  assert.equal(svg, 'M 8 0 L 8 45 L 10 45 L 10 60 L -10 60 L -10 45 L -8 45 L -8 0 Z');
  // ten sam kontur co w kolumnie T (w 0,1 mm), tylko inna kolejność obiegu
  const back = E.svgToContour(svg);
  assert.deepEqual(bounds(back), bounds(t));
  assert.deepEqual(E.halfFromSvg(svg).map((r) => [r.z, r.r]), [['0', '8'], ['45', '8'], ['45', '10'], ['60', '10']]);
  assert.deepEqual(E.anyContour('-1_2;3_4'), [{ x: -1, y: 2 }, { x: 3, y: 4 }]);
  assert.equal(E.anyContour(svg).length, 8);
});

test('punkty na osi bez powtórzeń, ujemne Z, wymiary, sprawdzenie', () => {
  const rows = [{ z: '-5', r: '0' }, { z: '-5', r: '6' }, { z: '30', r: '6' }, { z: '40', r: '0' }];
  assert.equal(E.toSvg(rows), 'M 0 -5 L 6 -5 L 6 30 L 0 40 L -6 30 L -6 -5 Z');
  assert.ok(E.svgToContour(E.toSvg(rows)).some((p) => p.y === -50));
  assert.deepEqual(E.dims(rows), { diameter: 12, length: 45 });
  assert.deepEqual(E.validate([{ z: '1', r: '2' }]), ['Wpisz co najmniej 2 punkty (Z i R).']);
  assert.ok(E.validate([{ z: 'a', r: '1' }, { z: '1', r: '-1' }]).length >= 2);
  assert.deepEqual(E.validate(rows), []);
});

test('zaokrąglenie: łuk styczny, promień przycięty do połowy krótszego odcinka', () => {
  const svg = E.toSvg([{ z: '0', r: '10' }, { z: '50', r: '10', rad: '2' }]);
  // narożnik (10, 50): z dołu w górę, potem w lewo na drugą stronę – łuk od (10, 48) do (8, 50), skręt w lewo → sweep 1
  assert.ok(svg.startsWith('M 10 0 L 10 48 A 2 2 0 0 1 8 50'), svg);
  const pts = E.svgToContour(svg); assert.ok(pts.length > 6);
  const big = E.toSvg([{ z: '0', r: '10' }, { z: '4', r: '10', rad: '50' }]);
  assert.ok(big.includes('L 10 2 A 2 2 0 0 1'), big);
});

test('pełny kontur bez zmian – linie rzutu bocznego (X+ → X-) zostają', () => {
  const er = [{ x: -95, y: 0 }, { x: 95, y: 0 }, { x: 80, y: 340 }, { x: -80, y: 340 }, { x: 80, y: 340 }, { x: 95, y: 360 }, { x: -95, y: 360 }];
  const svg = E.contourToSvg(er);
  assert.equal(svg, 'M -9.5 0 L 9.5 0 L 8 34 L -8 34 L 8 34 L 9.5 36 L -9.5 36 Z');
  assert.deepEqual(E.svgToContour(svg), er);
});

test('prawa połowa: halfSvg od osi do osi, expandHalf – odbicie, pełny kontur bez zmian', () => {
  const rows = [{ z: '0', r: '8', rad: '' }, { z: '45', r: '8', rad: '' }, { z: '45', r: '10', rad: '' }, { z: '60', r: '10', rad: '' }];
  const half = E.halfSvg(rows);
  assert.equal(half, 'M 0 0 L 8 0 L 8 45 L 10 45 L 10 60 L 0 60 Z');
  const pts = E.svgToContour(half);
  assert.ok(E.isHalf(pts));
  const full = E.expandHalf(pts);
  assert.equal(full.length, 10);
  assert.deepEqual(full.slice(6).map((p) => [p.x, p.y]), [[-100, 600], [-100, 450], [-80, 450], [-80, 0]]);
  const sym = [{ x: -80, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 600 }, { x: -80, y: 600 }];
  assert.deepEqual(E.expandHalf(sym), sym);
  assert.ok(E.halfSvg([{ z: '0', r: '8', rad: '' }, { z: '45', r: '8', rad: '2' }, { z: '45', r: '20', rad: '' }]).includes(' A 2 2 '));
});

test('zatwierdzone kontury z PSWT (BH + BC) → kontur x_y dla toolIndex', () => {
  const m = E.confirmedOverrides({ 'fx-1': { BH: 'OK 1.1.2026', BC: 'M 0 0 L 8 0 L 8 60 L 0 60 Z' }, 'fx-2': { BH: '', BC: 'M 0 0 L 8 0 L 8 60 L 0 60 Z' } });
  assert.deepEqual([...m.keys()], ['fx-1']);
  assert.equal(m.get('fx-1'), '0_0;80_0;80_600;0_600;-80_600;-80_0');
});

test('prawa połowa z liniami krawędzi (nakrętka ER) i odbicie', () => {
  const er = parseContour('-95_0;95_0;95_200;-95_200;-95_210;95_210;95_340;60_380;-60_380;-95_340;-95_210');
  assert.equal(E.halfPathSvg(er), 'M 0 0 L 9.5 0 L 9.5 20 L 0 20 L 0 21 L 9.5 21 L 9.5 34 L 6 38 L 0 38 Z');
  const full = E.expandHalf(E.svgToContour(E.halfPathSvg(er)));
  // linie krawędzi na Z = 20 i 21 mm są po obu stronach osi
  for (const y of [200, 210]) assert.ok(full.some((p) => p.x === -95 && p.y === y) && full.some((p) => p.x === 95 && p.y === y));
});

test('linie krawędzi części obrotowej dopisywane do połowy konturu (uskok, stożek, łuk zostaje)', () => {
  assert.equal(E.addEdgeLines('M 0 0 L 15 0 L 15 20 L 20 20 L 20 30 L 30 30 L 30 70 L 0 70 Z'),
    'M 0 0 L 15 0 L 15 20 L 0 20 L 15 20 L 20 20 L 20 30 L 0 30 L 20 30 L 30 30 L 30 70 L 0 70 Z');
  assert.equal(E.addEdgeLines('M 0 0 L 10 0 L 10 40 L 14 44 L 14 60 L 0 60 Z'), 'M 0 0 L 10 0 L 10 40 L 0 40 L 10 40 L 14 44 L 0 44 L 14 44 L 14 60 L 0 60 Z');
  assert.ok(E.addEdgeLines('M 0 0 L 6 0 L 6 30 A 3 3 0 0 0 9 33 L 12 33 L 12 70 L 0 70 Z').includes(' A 3 3 0 0 0 9 33 L 0 33 L 9 33 '));
  const er = 'M 0 0 L 9.5 0 L 9.5 20 L 0 20 L 0 21 L 9.5 21 L 9.5 34 L 6 38 L 0 38 Z';
  assert.equal(E.addEdgeLines(E.addEdgeLines(er)), E.addEdgeLines(er));   // bez powtórzeń
  assert.equal(E.addEdgeLines('M 0 0 L 8 0 L 8 60 L 0 60 Z'), 'M 0 0 L 8 0 L 8 60 L 0 60 Z');   // walec – bez linii
});

test('narzędzia monolityczne: podział istniejącego konturu wg długości roboczej (K)', () => {
  assert.ok(E.isMonolithic({ D: 'wie', E: 'HSS' }) && E.isMonolithic({ D: 'fre', E: 'WĘG' }) && E.isMonolithic({ D: 'tre', E: 'TCT' }));
  assert.ok(!E.isMonolithic({ D: 'fre', E: 'pal' }) && !E.isMonolithic({ D: 'opr', E: 'red' }));
  const plain = 'M 0 -21 L 3 -21 L 3 54 L 0 54 Z';
  const s = E.workSplit(plain, E.workLength({ K: '25' }));
  assert.deepEqual(s, { z: 29, regions: [{ role: 'oprawka', z1: -21, z2: 29 }, { role: 'ostrze', z1: 29, z2: 54 }] });
  assert.equal(E.addLineAt(plain, 29), 'M 0 -21 L 3 -21 L 3 29 L 0 29 L 3 29 L 3 54 L 0 54 Z');
  assert.equal(E.addLineAt(E.addLineAt(plain, 29), 29), E.addLineAt(plain, 29));
  assert.equal(E.workSplit(plain, 100), null);
  assert.deepEqual(E.parseRegionsText('ostrze 29–54; oprawka -21–29'), [{ role: 'ostrze', z1: 29, z2: 54 }, { role: 'oprawka', z1: -21, z2: 29 }]);
});
