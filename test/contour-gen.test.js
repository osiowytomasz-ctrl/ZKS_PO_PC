// Generator konturu z danych (zamiast formuły PSWT!AW) – przykładowe, zmyślone narzędzia; mocowanie jak w zakładce „kontury”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/renderer/js/logic/contourGen.js';
import { parseContour } from '../src/renderer/js/logic/toolGeometry.js';
import { halfFromContour, generatedHalf, contourOverrides, bladeLength } from '../src/renderer/js/logic/contourEditor.js';
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

test('wiertło rurowe (tre) – sylweta z boku: ostrze 7×4, korpus Ø−0,5, szyjka Ø−3 pod L, linie płytki i chwytu', () => {
  const p = { D: 'tre', E: 'TCT', F: '50', J: '70', K: '50', M: 'WEL019' };   // R 25; korpus 24,75; szyjka 23,5 od 0 do 20; ostrze 63…70
  assert.equal(C.fullContour(p, {}), '0_-490;-95_-490;-95_0;95_0;-95_0;-235_0;-235_200;-247.5_200;-247.5_630;-250_630;-210_630;-210_700;-210_630;-250_630;-250_700;250_700;250_630;210_630;210_700;210_630;250_630;247.5_630;247.5_200;235_200;235_0;95_0;95_-490;0_-490');
  // bez szyjki (J ≤ K) korpus od zera; bez Weldona – bez linii oddzielającej chwyt
  const q = C.fullContour({ ...p, J: '50', K: '60', M: 'ABS040' }, {});
  assert.ok(q.includes(';-247.5_0;-247.5_430;-250_430;') && !q.includes(';-235_'));
  // wnęka nie jest w konturze – tylko w rysunku (przerywana): ścianki i dno 3 mm nad dołem, płytki w ściankach
  const d = C.trepanDrawing(50, 70);
  assert.deepEqual(d.hidden[0].map((q) => [q.x, q.y]), [[-212.5, 700], [-212.5, 30], [212.5, 30], [212.5, 700]]);
  assert.deepEqual(d.plates[1].map((q) => [q.x, q.y]), [[210, 630], [250, 630], [250, 700], [210, 700]]);
  assert.deepEqual(d.cavity, { ri: 212.5, yb: 30, rb: 247.5, y7: 630 });
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
  const p = { D: 'tre', E: 'TCT', F: '50', J: '70', K: '50', M: 'WEL019' };
  const h = generatedHalf(p, {});
  assert.deepEqual(h.map((q) => [q.x, q.y]), [[0, 0], [95, 0], [0, 0], [0, 700], [250, 700], [250, 630], [210, 630], [210, 700], [210, 630], [250, 630], [247.5, 630], [247.5, 200], [235, 200], [235, 0], [95, 0], [95, -490], [0, -490]]);
  assert.ok(h.every((q) => q.x >= 0));
  const q = { D: 'tre', E: 'TCT', F: '35', J: '90', K: '60', M: 'ABS040' };
  assert.ok(generatedHalf(q, {}).length > 3);
  assert.deepEqual(generatedHalf({ D: 'tok', E: 'nóż', M: 'XX' }, {}), []);
});

test('frez fazowy (dopisana reguła): walec Ø I, stożek pod kątem G do Ø F', () => {
  const b = C.bodyContour({ D: 'fre', E: 'faz', F: '63', G: '45', I: '79', J: '40', K: '40', M: 'FRE022' }, '0_0;0_0;0_0;0_0');
  assert.equal(b, ';0_0;-395_0;-395_320;-315_400;315_400;395_320;395_0;0_0;');
});

test('wiertło rurowe: rejon ostrza = węglik 7 mm od czubka (nie K), brak linii przez całą szerokość, wnęka w 3D, płytki ≤ 4 mm po obwodzie', () => {
  const o = { D: 'tre', E: 'TCT', F: '50', J: '70', K: '50', M: 'WEL019' };
  assert.equal(bladeLength(o), 7); assert.equal(bladeLength({ D: 'fre', E: 'hss', K: '40' }), 40);
  const m = contourOverrides({ tre50: o }, {}, { gen: true });
  assert.deepEqual(m.regions.get('tre50'), [{ role: 'oprawka', z1: -49, z2: 63 }, { role: 'ostrze', z1: 63, z2: 70 }]);
  // 3D: wnęka otwarta od czubka (ścianka wewnętrzna i dno), korpus bez wystawania płytki; bez wnęki – pełna bryła
  const full = parseContour(C.fullContour(o, {})), cav = C.trepanDrawing(50, 70).cavity;
  const cup = profileOf(full, cav), solid = profileOf(full, null);
  assert.ok(cup.some((q) => q.x === 212.5 && q.y === 700)); assert.ok(cup.some((q) => q.x === 212.5 && q.y === 30)); assert.ok(cup.some((q) => q.x === 0 && q.y === 30));
  assert.ok(cup.filter((q) => q.y >= 630).every((q) => q.x <= 247.5)); assert.ok(solid.some((q) => q.x === 250 && q.y === 700));
  const b = trepanBlade(50, m.regions.get('tre50'));
  assert.deepEqual(b, { n: 7, rIn: 21, rOut: 25, z1: 63, z2: 70, arc: 4 });
  assert.equal(trepanBlade(50, m.regions.get('tre50'), 8).n, 8); assert.equal(trepanBlade(50, []), null);
  assert.ok(trepanBlade(12, [{ role: 'ostrze', z1: 0, z2: 7 }]).arc <= 4);
});
