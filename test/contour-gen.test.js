// Generator konturu z danych (zamiast formuły PSWT!AW) – przykładowe, zmyślone narzędzia; mocowanie jak w zakładce „kontury”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/renderer/js/logic/contourGen.js';
import { parseContour } from '../src/renderer/js/logic/toolGeometry.js';
import { halfFromContour } from '../src/renderer/js/logic/contourEditor.js';

const mounts = {
  ABS040: { left: '0_-200;100_-200;100_0;-200_0', right: '200_0;-100_0;-100_-200;0_-200' },
  WEL016: { left: '0_-240;-80_-240;-80_0', right: '80_0;80_-240;0_-240' },
  ER_032: { left: '', right: '' },
};

test('liczby z przecinkiem, FRAGMENT.TEKSTU, ostatni i najniższy punkt mocowania', () => {
  assert.equal(C.nv('62,5'), 62.5); assert.equal(C.nv(''), 0); assert.equal(C.nv('abc'), 0);
  assert.equal(C.lastY('0_-200;100_-200;100_0;-200_0'), 0); assert.equal(C.minY('0_-240;-80_-240;-80_0'), -240);
  assert.deepEqual(parseContour('65,8_450;-102,_3'), [{ x: 65.8, y: 450 }, { x: -102, y: 3 }]);
});

test('trepanacja (tre) – korpus i pełny kontur z mocowaniem', () => {
  const p = { D: 'tre', E: 'TCT', F: '35', J: '90', K: '110', M: 'ABS040' };
  assert.equal(C.bodyContour(p), ';-155_0;-155_-200;-175_-200;-175_900;175_900;175_-200;155_-200;155_0;');
  assert.equal(C.fullContour(p, mounts), '0_-200;100_-200;100_0;-200_0;-155_0;-155_-200;-175_-200;-175_900;175_900;175_-200;155_-200;155_0;200_0;-100_0;-100_-200;0_-200');
});

test('wiertło HSS: zwykłe (czubek 120°) i w tulejce ER_032 / Weldon', () => {
  const p = { D: 'wie', E: 'HSS', F: '10', J: '100', K: '50', M: 'ABS040' };
  const b = C.bodyContour(p, mounts.ABS040.left);
  assert.ok(b.startsWith(';50_0;50_500;-50_500;-50_971;0_1000;'), b); // round(tan30·10·10/2) = 29
  const er = C.bodyContour({ ...p, M: 'WEL016', F: '2', J: '50', K: '25' }, mounts.WEL016.left);
  assert.equal(er, '0_-187.5;-10_-187.5;-10_62.5;10_62.5;10_312.5;0_318.5;-10_312.5;-10_62.5;10_62.5;10_-187.5;0_-187.5');
});

test('frez palcowy w Weldonie: 0,98·F, czoło J−1, przesunięcie o głębokość mocowania', () => {
  const p = { D: 'fre', E: 'pal', F: '16', I: '16', J: '85', K: '31', M: 'WEL016' };
  assert.equal(C.bodyContour(p, mounts.WEL016.left), ';0_0;-80_0;-80_300;-78.4_300;-78.4_600;78.4_600;78.4_300;80_300;80_0;0_0;');
  const half = halfFromContour(parseContour(C.fullContour(p, mounts)));
  assert.deepEqual(half.map((r) => [r.z, r.r]), [['-24', '8'], ['30', '8'], ['30', '7.84'], ['60', '7.84']]);
});

test('brak reguły i brak mocowania → null; wariant F0815 z apostrofem', () => {
  assert.equal(C.bodyContour({ D: 'tok', E: 'nóż' }), '');
  assert.equal(C.fullContour({ D: 'tok', E: 'nóż', M: 'XX' }, mounts), null);
  assert.equal(C.mounting({ "ABS040'": { left: 'a', right: 'b' } }, 'ABS040', 'oprawka F0815').left, 'a');
});

test('mocowania ABS / WEL wyliczane, gdy brak ich w zakładce „kontury”', () => {
  const lib = { WEL010: { left: '0_-200;-50_-200;-50_0', right: '50_0;50_-200;0_-200' }, WEL020: { left: '0_-300;-100_-300;-100_0', right: '100_0;100_-300;0_-300' } };
  assert.deepEqual(C.synthMount(lib, 'ABS040'), { left: '0_-200;100_-200;100_0;-200_0', right: '200_0;-100_0;-100_-200;0_-200', synthetic: true });
  assert.equal(C.synthMount(lib, 'WEL016').left, '0_-260;-80_-260;-80_0'); // 200 + (300-200)·(16-10)/(20-10)
  assert.equal(C.mounting(lib, 'WEL010').left, lib.WEL010.left); // z zakładki ma pierwszeństwo
  assert.equal(C.mirrorLeft('0_-260;-80_-260;-80_0'), '80_0;80_-260;0_-260');
  // wiertło w Weldonie (wariant ER) rysuje własny chwyt – wyliczonego mocowania nie dokładamy
  const drill = { D: 'wie', E: 'WĘG', F: '12', J: '102', K: '55', M: 'WEL012' };
  assert.ok(C.fullContour(drill, lib).startsWith('0_-412.5;'));
});

test('frez fazowy (dopisana reguła): walec Ø I, stożek pod kątem G do Ø F', () => {
  const b = C.bodyContour({ D: 'fre', E: 'faz', F: '63', G: '45', I: '79', J: '40', K: '40', M: 'FRE022' }, '0_0;0_0;0_0;0_0');
  assert.equal(b, ';0_0;-395_0;-395_320;-315_400;315_400;395_320;395_0;0_0;');
});
