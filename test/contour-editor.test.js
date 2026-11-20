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
