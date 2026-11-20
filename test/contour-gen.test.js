// Generator konturu z danych (zamiast formuły PSWT!AW) – przykładowe, zmyślone narzędzia; mocowanie jak w zakładce „kontury”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/renderer/js/logic/contourGen.js';
import { parseContour } from '../src/renderer/js/logic/toolGeometry.js';
import { halfFromContour, generatedHalf, hasCavity, contourOverrides, addEdgeLines, bladeLength } from '../src/renderer/js/logic/contourEditor.js';
import { profileOf, trepanBlade } from '../src/renderer/js/logic/toolGeometry.js';

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

test('wiertło rurowe (tre) – kielich: ostrze 7×4 mm, korpus Ø−0,5, ścianka 3,5, wnęka do 3 mm nad końcem L, chwyt Weldon', () => {
  const p = { D: 'tre', E: 'TCT', F: '35', J: '90', K: '60', M: 'WEL032' };   // R 17,5; korpus 17,25; wnęka 13,75; węglik 13,5…17,5; koniec L na 30
  assert.equal(C.bodyContour(p, '0_-600;-160_-600;-160_0'),
    ';-160_300;-172.5_300;-172.5_830;-175_830;-175_900;-135_900;-135_830;-137.5_830;-137.5_330;137.5_330;137.5_830;135_830;135_900;175_900;175_830;172.5_830;172.5_300;160_300;');
  assert.equal(C.fullContour(p, {}), '0_-600;-160_-600;-160_0;-160_300;-172.5_300;-172.5_830;-175_830;-175_900;-135_900;-135_830;-137.5_830;-137.5_330;137.5_330;137.5_830;135_830;135_900;175_900;175_830;172.5_830;172.5_300;160_300;160_0;160_-600;0_-600');
  // chwyt Weldon 19 – węższy; bez długości ponad L (J ≤ K) korpus zaczyna się od zera
  assert.ok(C.fullContour({ ...p, M: 'WEL019', J: '50', K: '60' }, {}).includes(';-172.5_0;-172.5_430;-175_430;-175_500;'));
});

test('wiertło rurowe: liczba płytek ostrza liniowo od 4 (Ø12) do 12 (Ø130)', () => {
  assert.deepEqual([12, 35, 60, 100, 130, 200, 8].map(C.trepanPlates), [4, 6, 7, 10, 12, 12, 4]);
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
  assert.deepEqual(half.map((r) => [r.z, r.r]), [['-48', '8'], ['6', '8'], ['6', '7.84'], ['36', '7.84']]);   // chwyt Ø16 ma l = 48 mm
});

test('brak reguły i brak mocowania → null; wariant F0815 z apostrofem', () => {
  assert.equal(C.bodyContour({ D: 'tok', E: 'nóż' }), '');
  assert.equal(C.fullContour({ D: 'tok', E: 'nóż', M: 'XX' }, mounts), null);
  assert.equal(C.mounting({ "ABS040'": { left: 'a', right: 'b' } }, 'ABS040', 'oprawka F0815').left, 'a');
});

test('mocowania wg wzorów karty „kontury” (Z jak w karcie); kody spoza wzorów – z danych zakładki', () => {
  const lib = { WEL010: { left: 'x', right: 'y' }, ARB050: { left: '0_-500;-250_-500;-250_0', right: '250_0;250_-500;0_-500' } };
  assert.deepEqual(C.synthMount(lib, 'ABS040'), { left: '0_-200;100_-200;100_0;-200_0', right: '200_0;-100_0;-100_-200;0_-200', synthetic: true });
  assert.equal(C.mounting(lib, 'WEL016').left, '0_-480;-80_-480;-80_0');   // długość chwytu Weldon Ø16: 48 mm
  assert.equal(C.mounting(lib, 'WEL010').left, '0_-400;-50_-400;-50_0');   // wzór (l = 40 mm) przed danymi zakładki
  assert.equal(C.mounting(lib, 'ARB050').left, lib.ARB050.left);           // bez wzoru – dane zakładki
  assert.equal(C.mounting(lib, 'XYZ'), null);
  const w12 = C.formulaMount('WEL012'); assert.equal(w12.left, '0_-450;-60_-450;-60_0'); assert.equal(w12.synthetic, false);   // l = 45 mm z tabeli
  const w19 = C.formulaMount('WEL019'); assert.equal(w19.left, '0_-490;-95_-490;-95_0'); assert.equal(w19.synthetic, true);   // spoza tabeli: 48 + (50−48)/2 = 49
  assert.equal(C.mirrorLeft('0_-260;-80_-260;-80_0'), '80_0;80_-260;0_-260');
  assert.equal(C.formulaMount('ER_008').left, '0_-135;-32.25_-27;32.5_-27;32.5_-15;-32.25_-15;-17.25_0');
  assert.equal(C.formulaMount('MK_001').left, '0_-585;26_-585;26_-415;-47_-415;-60_35');
  assert.equal(C.formulaMount('D06,0□04,0_024').left, '0_-240;20_-240;20_-200;-30_-200;-30_0');
  assert.equal(C.formulaMount('FZS_031').left, '0_-350;155_-350;155_0;-250_0;-250_309;125_309;125_340');
  assert.equal(C.formulaMount('ISO040').left, '0_-827;130_-827;270_0;270_32;415_32;415_191;0_191');
  assert.equal(C.formulaMount('MHD063').left, '0_-472.5;-157.5_-472.5;-157.5_-157.5;157.5_-157.5;315_0;-315_0');
  assert.equal(C.formulaMount('T__006').left, '30.6_-68;-30.6_-68;-34_0;34_0');
  assert.equal(C.formulaMount("KS_005'").left, '0_-630;300_-630;300_0;-475_0;-475_560;237.5_560;237.5_620');
  assert.equal(C.mounting({}, 'KS_005', 'F0815').left, C.formulaMount("KS_005'").left);
  assert.equal(C.formulaMount('FRE016'), null); assert.equal(C.formulaMount('D00,0□00,0_000'), null);
  // wiertło w Weldonie (wariant ER) rysuje własny chwyt – mocowania nie dokładamy (także dla rozmiarów z tabeli)
  for (const M of ['WEL012', 'WEL016']) assert.ok(C.fullContour({ D: 'wie', E: 'WĘG', F: '12', J: '102', K: '55', M }, lib).startsWith('0_-412.5;'));
});

test('Weldon: długość chwytu l wg tabeli wymiarów', () => {
  const l = { 6: 36, 8: 36, 10: 40, 12: 45, 14: 45, 16: 48, 18: 48, 20: 50, 25: 56, 32: 60 };
  for (const [d, len] of Object.entries(l)) {
    const m = C.formulaMount('WEL' + String(d).padStart(3, '0'));
    assert.equal(C.minY(m.left), -len * 10, 'Ø' + d); assert.equal(m.synthetic, false);
  }
});

test('generator – sama prawa połowa (od osi do osi, x ≥ 0)', () => {
  const p = { D: 'tre', E: 'TCT', F: '35', J: '90', K: '60', M: 'WEL032' };
  const h = generatedHalf(p, {});
  assert.deepEqual(h.map((q) => [q.x, q.y]), [[0, 330], [137.5, 330], [137.5, 830], [135, 830], [135, 900], [175, 900], [175, 830], [172.5, 830], [172.5, 300], [160, 300], [160, 0], [160, -600], [0, -600]]);
  assert.ok(h.every((q) => q.x >= 0));
  assert.equal(hasCavity(parseContour(C.fullContour(p, {}))), true);
  assert.equal(hasCavity(parseContour(C.fullContour({ D: 'wie', E: 'HSS', F: '10', J: '100', K: '50', M: 'ABS040' }, {}))), false);
  assert.deepEqual(generatedHalf({ D: 'tok', E: 'nóż', M: 'XX' }, {}), []);
});

test('frez fazowy (dopisana reguła): walec Ø I, stożek pod kątem G do Ø F', () => {
  const b = C.bodyContour({ D: 'fre', E: 'faz', F: '63', G: '45', I: '79', J: '40', K: '40', M: 'FRE022' }, '0_0;0_0;0_0;0_0');
  assert.equal(b, ';0_0;-395_0;-395_320;-315_400;315_400;395_320;395_0;0_0;');
});

test('wiertło rurowe: rejon ostrza = węglik 7 mm od czubka (nie K), bez linii przez wnękę, profil 3D wydrążony, płytki wg Ø', () => {
  const o = { D: 'tre', E: 'TCT', F: '35', J: '90', K: '60', M: 'WEL032' };
  assert.equal(bladeLength(o), 7); assert.equal(bladeLength({ D: 'fre', E: 'hss', K: '40' }), 40);
  const m = contourOverrides({ tre35: o }, {}, { gen: true });
  assert.deepEqual(m.regions.get('tre35'), [{ role: 'oprawka', z1: -60, z2: 83 }, { role: 'ostrze', z1: 83, z2: 90 }]);
  // linie krawędzi (uskoki) nie są dopisywane przez wnękę kielicha
  const svg = 'M 0 33 L 13.75 33 L 13.75 83 L 13.5 83 L 13.5 90 L 17.5 90 L 17.5 83 L 17.25 83 L 17.25 30 L 16 30 L 16 -60 L 0 -60 Z';
  assert.equal(addEdgeLines(svg), svg);
  // 3D: profil z wnęką (ścianki wewnętrzne), a nie sam obrys zewnętrzny
  const full = parseContour(C.fullContour(o, {}));
  const cup = profileOf(full, true), solid = profileOf(full, false);
  assert.ok(cup.some((q) => q.y === 330 && q.x === 137.5)); assert.ok(!solid.some((q) => q.y === 330 && q.x === 137.5));
  assert.deepEqual(trepanBlade(35, m.regions.get('tre35')), { n: 6, rIn: 13.5, rOut: 17.5, z1: 83, z2: 90 });
  assert.equal(trepanBlade(35, m.regions.get('tre35'), 8).n, 8); assert.equal(trepanBlade(35, []), null);
});
