// Generator konturu z danych (zamiast formuły PSWT!AW) – przykładowe, zmyślone narzędzia; mocowanie jak w zakładce „kontury”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/renderer/js/logic/contourGen.js';
import { parseContour } from '../src/renderer/js/logic/toolGeometry.js';
import { halfFromContour, generatedHalf, contourOverrides, bladeLength, withEdgeLines, withNut, filletFirstStep } from '../src/renderer/js/logic/contourEditor.js';
import { profileOf, trepanBlade, holeDrawingFor, nutDrawingFor, colletDrawingFor } from '../src/renderer/js/logic/toolGeometry.js';

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
  assert.equal(C.fullContour(p, {}), '0_-490;-95_-490;-95_0;95_0;-95_0;-235_0;-235_200;-247.5_200;247.5_200;-247.5_200;-247.5_630;-250_630;-210_630;-210_700;-210_630;-250_630;-250_700;250_700;250_630;210_630;210_700;210_630;250_630;247.5_630;247.5_200;235_200;235_0;95_0;95_-490;0_-490');
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
  assert.equal(C.formulaMount('ER_008').left, '0_-135;-17.07_-135;-32.25_-27;32.5_-27;32.5_-15;-32.25_-15;-17.25_0');   // dno płaskie ze stożka 8° (karta: puste)
  assert.equal(C.formulaMount('ER_016').left, '0_-275;-55.77_-275;-85_-67;69_-67;69_-40;-85_-40;-45_0');
  assert.equal(C.formulaMount('MK_001').left, '0_-585;26_-585;26_-415;-47_-415;-60_35');
  assert.equal(C.formulaMount('D06,0□04,0_024').left, '0_-240;20_-240;20_-200;-30_-200;-30_0');
  assert.equal(C.formulaMount('FZS_031').left, '0_-350;155_-350;155_0;-250_0;-250_309;125_309;125_340');
  // stożek SK50 z pliku DXF (dla wszystkich ISO / SK) + grzybek montażowy DIN50 na końcu stożka
  const sk = C.formulaMount('ISO050');
  assert.equal(sk.left, C.formulaMount('ISO040').left);
  assert.equal(sk.left, '0_-1356;126_-1356;140_-1332;140_-1266;105_-1256.6;105_-1145;178_-1044;178_-1016;201.0316_-1016;349.25_0;349.25_15;487.5_15;487.5_78.553;456.25_96.595;456.25_125.405;487.5_143.447;487.5_191;0_191');
  assert.equal(C.minY(sk.left), -1356); assert.equal(C.lastY(sk.left), 191);   // grzybek: L1 = 34 mm pod stożkiem 101,6 mm; kołnierz do 19,1 mm
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
  assert.deepEqual(h.map((q) => [q.x, q.y]), [[0, 0], [95, 0], [0, 0], [0, 200], [247.5, 200], [0, 200], [0, 700], [250, 700], [250, 630], [210, 630], [210, 700], [210, 630], [250, 630], [247.5, 630], [247.5, 200], [235, 200], [235, 0], [95, 0], [95, -490], [0, -490]]);
  assert.ok(h.every((q) => q.x >= 0));
  const q = { D: 'tre', E: 'TCT', F: '35', J: '90', K: '60', M: 'ABS040' };
  assert.ok(generatedHalf(q, {}).length > 3);
  assert.deepEqual(generatedHalf({ D: 'tok', E: 'nóż', M: 'XX' }, {}), []);
});

test('frez fazowy (dopisana reguła): walec Ø I, stożek pod kątem G do Ø F', () => {
  const b = C.bodyContour({ D: 'fre', E: 'faz', F: '63', G: '45', I: '79', J: '40', K: '40', M: 'FRE022' }, '0_0;0_0;0_0;0_0');
  assert.equal(b, ';0_-190;-395_-190;-395_130;-315_210;315_210;395_130;395_-190;0_-190;', 'mocowanie FRE022: kontur cofnięty o L2 = 19 mm');
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

test('linie krawędzi średnic w generatorze – wszędzie (poza wiertłem rurowym, które ma własne), bez powtórzeń', () => {
  const o = { D: 'opr', E: 'stż', F: '32', I: '60', J: '90', K: '60', M: 'ISO050', N: 'WEL032' };
  const h = generatedHalf(o, {});
  // uskok kołnierza SK50 (r 487,5 → 456,25 na Z 96,6) ma linię od obrysu do osi i z powrotem
  const i = h.findIndex((q, k) => q.y === 96.595 && q.x === 456.25 && h[k + 1] && h[k + 1].x === 0);
  assert.ok(i >= 0, 'brak linii przez rowek');
  assert.equal(h.filter((q) => q.x === 0 && q.y === 96.595).length, 1);
  // drugi raz nic nie dopisuje (np. przy akceptacji)
  assert.deepEqual(withEdgeLines(h), h);
});

test('oprawka gwintująca (N „D12,0□09,0_042”): otwór Ø12 × 42 mm od czubka tylko jako linia przerywana i wnęka 3D, nie w konturze', () => {
  assert.deepEqual(C.tapHole('D12,0□09,0_042'), { r: 60, depth: 420 }); assert.equal(C.tapHole('FRE016'), null); assert.equal(C.tapHole(''), null);
  const o = { D: 'opr', E: 'red', F: '31', I: '50', J: '70', K: '34', M: 'FZS_031', N: 'D12,0□09,0_042' };
  const full = C.fullContour(o, {});
  assert.equal(full, C.mounting({}, 'FZS_031').left + ';' + C.mounting({}, 'FZS_031').right, 'w konturze tylko mocowanie FZS_031');
  const pts = parseContour(full), h = holeDrawingFor(o.N, pts);
  assert.deepEqual(h.hidden[0].map((q) => [q.x, q.y]), [[-60, 340], [-60, -80], [60, -80], [60, 340]]);   // czubek 340 (góra konturu) − 42 mm
  assert.deepEqual(h.cavity, { ri: 60, yb: -80, rb: 0, y7: Infinity });
  const cup = profileOf(pts, h.cavity);
  assert.ok(cup.some((q) => q.x === 60 && q.y === 340) && cup.some((q) => q.x === 60 && q.y === -80) && cup.some((q) => q.x === 0 && q.y === -80));
  assert.equal(holeDrawingFor('FRE016', pts), null);
});

test('gniazdo żeńskie oprawki z męskiego zakończenia N (ABS, Weldon, Capto, MHD, KAR, MK): linia przerywana i wnęka 3D', () => {
  assert.deepEqual(C.socketProfile('ABS040'), [[0, -200], [100, -200], [100, 0]]);
  assert.deepEqual(C.socketProfile('WEL016'), [[0, -480], [80, -480], [80, 0]]);   // chwyt Ø16, l = 48 mm
  assert.deepEqual(C.socketProfile('CAP080'), [[0, -800], [250, -800], [350, 0]]);   // bez kołnierza przy czole
  assert.deepEqual(C.socketProfile('KAR019'), [[0, -220], [95, -220], [95, 0]]);
  assert.deepEqual(C.socketProfile('MK_003'), [[0, -940], [40, -940], [40, -690], [100, -690], [119, 0]]);
  assert.equal(C.socketProfile('MHD063').at(-1)[0], 315);
  for (const k of ['ISO050', 'FZS_031', 'FRE016', '']) assert.equal(C.socketProfile(k), null);
  const pts = parseContour(C.fullContour({ D: 'opr', E: 'red', F: '31', I: '50', J: '70', K: '34', M: 'FZS_031', N: 'WEL016' }, {}));   // czubek konturu = 340
  const h = holeDrawingFor('WEL016', pts);
  assert.deepEqual(h.hidden[0].map((q) => [q.x, q.y]), [[-80, 340], [-80, -140], [0, -140], [80, -140], [80, 340]]);
  const cup = profileOf(pts, h.cavity);
  assert.ok(cup.some((q) => q.x === 80 && q.y === 340) && cup.some((q) => q.x === 0 && q.y === -140));
});

test('gniazdo: T__ / SP (termo), poziome linie przerywane na załamaniach profilu (MHD, MK)', () => {
  assert.deepEqual(C.socketProfile('T__006'), [[0, -68], [30.6, -68], [34, 0]]);   // wzór męskiego zakończenia T__ (dno na osi)
  assert.deepEqual(C.socketProfile('SP_15'), [[0, -128], [57.6, -128], [64, 0]]);
  const top = (code) => { const pts = parseContour(C.fullContour({ D: 'opr', E: 'red', F: '40', I: '90', J: '150', K: '110', M: 'ISO050', N: code }, {})); return holeDrawingFor(code, pts); };
  const mhd = top('MHD063'), t = Math.max(...parseContour(C.fullContour({ D: 'opr', E: 'red', F: '40', I: '90', J: '150', K: '110', M: 'ISO050', N: 'MHD063' }, {})).map((q) => q.y));
  // MHD: linia przez walec na poziomie przejścia stożek → walec (−157,5 od otworu), na całej szerokości walca
  assert.deepEqual(mhd.hidden[1].map((q) => [q.x, q.y]), [[-157.5, t - 157.5], [157.5, t - 157.5]]); assert.equal(mhd.hidden.length, 2);
  // MK: linia w środku na poziomie dolnej krawędzi stożka (nad kołkiem ø8): połowa szerokości kołka
  const mk = top('MK_003'), t2 = Math.max(...parseContour(C.fullContour({ D: 'opr', E: 'red', F: '40', I: '90', J: '150', K: '110', M: 'ISO050', N: 'MK_003' }, {})).map((q) => q.y));
  assert.deepEqual(mk.hidden[1].map((q) => [q.x, q.y]), [[-40, t2 - 690], [40, t2 - 690]]); assert.equal(mk.hidden.length, 2);
  // proste gniazda (ABS, Weldon, Capto, T__) nie mają dodatkowych linii poziomych
  for (const k of ['ABS040', 'WEL016', 'CAP080', 'T__010']) assert.equal(top(k).hidden.length, 1, k);
});

test('tulejka ER: gniazdo w oprawce (wzór męskiego zakończenia ER) i nakrętka ER z plików STEP / IGES', () => {
  // gniazdo ER_032: stożek tulejki 8° z wcięciem pod nakrętkę i fazą przy czole
  assert.deepEqual(C.socketProfile('ER_032'), [[0, -400], [125, -400], [165, -91], [146, -91], [146, -55], [165, -55], [110, 0]]);
  assert.deepEqual(C.socketProfile('ER_008').at(-1), [17.25, 0]); assert.equal(C.socketProfile('ER_099'), null);
  // nakrętki: Ø i długość z plików (ER-20 Ø34 × 22, ER-25 Ø41,7 × 20, ER-32 Ø50 × 22,6, ER-40 Ø63 × 23,9); 6 wcięć co 60°
  const ns = Object.fromEntries([20, 25, 32, 40, 16, 50].map((n) => [n, C.nutFor('ER_0' + n)]));
  assert.deepEqual([20, 25, 32, 40].map((n) => [ns[n].R, ns[n].L]), [[17, 22], [20.85, 20], [25, 22.606], [31.5, 23.9]]);
  assert.ok(ns[16].R === 13.75 && ns[16].L < ns[20].L && ns[50].L > ns[40].L, 'rozmiary bez pliku – skalowanie');   // ER16 mniejsza, ER50 większa niż wzory
  assert.equal(ns[25].slot.n, 6); assert.equal(ns[25].slot.to, 15.764); assert.equal(C.nutFor('ABS040'), null);
  // oprawka z nakrętką: górne L mm zastąpione kształtem nakrętki (faza, walec, stożek czoła), linie krawędzi dopisane
  const o = { D: 'opr', E: 'stż', F: '42', I: '50', J: '70', K: '50', M: 'ISO050', N: 'ER_025' };
  const h = generatedHalf(o, {});
  assert.ok(h.some((q) => q.x === 205.5 && q.y === 500) && h.some((q) => q.x === 208.5 && q.y === 657.64) && h.some((q) => q.x === 135 && q.y === 700));
  assert.ok(h.every((q) => q.x >= 0));
  assert.deepEqual(withNut(h, 'ABS040'), h);   // nie ER – bez zmian
  // rysunek 2D: ciemny pas nakrętki i trzy wcięcia zwrócone do patrzącego (środkowe i dwa boczne)
  const pts = parseContour(C.fullContour(o, {})), nd = nutDrawingFor('ER_025', pts);
  assert.equal(nd.z2 - nd.z1, 200); assert.equal(nd.slots.length, 3);
  assert.ok(nd.slots[0][0].x < 0 && nd.slots[0].at(-1).x > 0 && Math.abs(nd.slots[0][0].x + nd.slots[0].at(-1).x) < 1e-6);   // środkowe: symetryczne, dno zaokrąglone
  assert.equal(nutDrawingFor('FRE016', pts), null);
});

test('podcięcie pod nakrętką ER wg oprawki CAT50 + ER32 (STEP): szyjka i stożek do korpusu, proporcjonalnie do nakrętki', () => {
  const o = { D: 'opr', E: 'stż', F: '48', I: '60', J: '100', K: '80', M: 'ISO050', N: 'ER_032' };   // korpus R 24 jak w pliku
  const h = generatedHalf(o, {}), cut = 1000 - 22.606 * 10;
  const at = (x, y) => h.some((q) => Math.abs(q.x - x) < 0.05 && Math.abs(q.y - y) < 0.05);
  assert.ok(at(199.39, cut - 20) && at(199.39, cut), 'szyjka Ø39,9 długości 2 mm pod nakrętką');
  assert.ok(at(240, cut - 20 - 51.26), 'stożek 5,13 mm do korpusu Ø48 (kąt 38,4° jak w pliku)');
  // ER40: korpus R 31,5 – ten sam kąt stożka, szyjka 0,7976·R, szyjka 0,08·R
  const g = generatedHalf({ ...o, F: '63', I: '63', N: 'ER_040' }, {}), cut2 = 1000 - 23.9 * 10;
  assert.ok(g.some((q) => Math.abs(q.x - 251.2314) < 0.01 && Math.abs(q.y - cut2) < 0.01) && g.some((q) => Math.abs(q.x - 251.2314) < 0.01 && Math.abs(q.y - (cut2 - 25.2)) < 0.01));
  // korpus węższy od szyjki – bez podcięcia (nakrętka od razu na korpusie)
  const n = generatedHalf({ ...o, F: '30', I: '30' }, {});
  assert.ok(!n.some((q) => Math.abs(q.x - 199.39) < 0.05));
});

test('zaokrąglenie R1 przy kołnierzu oprawki z nakrętką ER (wklęsły róg płaszczyzna kołnierza – korpus)', () => {
  const h = generatedHalf({ D: 'opr', E: 'stż', F: '63', I: '63', J: '150', K: '130', M: 'ISO050', N: 'ER_040' }, {});
  const i = h.findIndex((q, k) => q.y === 191 && q.x === 325 && h[k + 1] && h[k + 1].x > 315 && h[k + 1].x < 325);   // początek łuku na płaszczyźnie kołnierza (R = 31,5 + 1 mm)
  assert.ok(i > 0 && h[i + 8].x === 315 && h[i + 8].y === 201, 'koniec łuku na korpusie 1 mm nad kołnierzem');
  const mid = h[i + 5]; assert.ok(Math.abs(Math.hypot(mid.x - 325, mid.y - 201) - 10) < 1e-2, 'punkty łuku na okręgu R1');
  // sam róg: płaszczyzna do osi, potem pionowo w górę → łuk; krótsze boki niż R lub brak rogu – bez zmian
  const P = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 40 }, { x: 0, y: 40 }];
  assert.equal(filletFirstStep(P, 10).length, P.length + 8); assert.deepEqual(filletFirstStep(P, 40), P);
  assert.deepEqual(generatedHalf({ D: 'opr', E: 'stż', F: '63', I: '63', J: '150', K: '130', M: 'ISO050', N: '' }, {}).filter((q) => q.y > 191 && q.y < 201 && q.x > 315 && q.x < 325), []);   // bez nakrętki – bez łuku
});

test('tulejki ER: szczeliny wzdłużne, otwór przelotowy od czoła do końca, ER-50 jak ER-40', () => {
  const sl = C.colletSlits('ER_032');
  assert.ok(sl.length >= 7 && sl.length <= 9, 'ok. połowa z 16 szczelin zwrócona do patrzącego');
  assert.ok(sl.every((l) => l.length === 11 && l[0][1] !== l[10][1]));
  // przemiennie od czoła (do z = 0) i od tyłu (do dna), ok. 85% długości; leżą na stożku (promień rośnie ku czołu)
  assert.equal(sl[0][10][1] === 0 || sl[0][0][1] === -400, true);
  assert.ok(Math.abs(sl.find((l) => l[10][1] === 0)[10][1] - 0) < 1e-9 && sl.find((l) => l[0][1] === -400));
  assert.equal(C.colletSlits('ABS040'), null);
  const m = C.nutFor('ER_050'), k = C.nutFor('ER_040');
  assert.equal(m.R, 39); assert.ok(Math.abs(m.L / k.L - 39 / 31.5) < 1e-9, 'ER-50: nakrętka ER-40 przeskalowana'); assert.equal(m.slot.n, 6);
  assert.deepEqual(C.colletSlits('ER_050').length, C.colletSlits('ER_040').length);
  // otwór przelotowy tulejki (M = ER_nnn, N = „D06,0□04,0_024”): dwie linie od czoła do końca konturu, bez dna; 3D: ścianka otworu na całej długości
  const pts = parseContour(C.fullContour({ D: 'opr', E: 'tul', M: 'ER_025', N: 'D10,0□08,0_010' }, {}));
  const top = Math.max(...pts.map((q) => q.y)), bot = Math.min(...pts.map((q) => q.y));
  const h = holeDrawingFor('D10,0□08,0_010', pts, 'ER_025');
  assert.deepEqual(h.hidden.map((l) => l.map((q) => [q.x, q.y])), [[[-50, top], [-50, bot]], [[50, top], [50, bot]]]);
  assert.equal(h.cavity.through, true);
  const cup = profileOf(pts, h.cavity); assert.ok(cup[0].x === 50 && cup[0].y === bot && cup.at(-1).x === 50 && cup.at(-1).y === bot);
  // głębokość z N obowiązuje tylko poza tulejkami (oprawka gwintująca): otwór nie wychodzi poza kontur
  assert.equal(holeDrawingFor('D10,0□08,0_010', pts, 'ISO050').hidden.length, 1);
});

test('trzpienie i frezy z mocowaniem FRExxx: wysokość trzpienia L2 z tabeli, kontur frezu cofnięty o L2, gniazdo żeńskie i kanał pod kamień', async () => {
  const GEN = await import('../src/renderer/js/logic/contourGen.js');
  const G2 = await import('../src/renderer/js/logic/toolGeometry.js');
  assert.deepEqual([16, 22, 27, 32, 40, 50, 60].map((d) => GEN.freL2('FRE0' + d)), [17, 19, 21, 24, 27, 30, 40]);
  assert.equal(GEN.freL2('FRE070'), 0); assert.equal(GEN.freL2('ABS063'), 0); assert.equal(GEN.freD('FRE032'), 32);
  // oprawka z trzpieniem FRE032: wysokość trzpienia 24 mm (zamiast K)
  const holder = { D: 'opr', E: 'stż', F: '50', I: '60', J: '100', K: '24', L: '32', H: '3', M: 'ISO050', N: 'FRE032' };   // oprawka: wysokość trzpienia z K
  const ys = GEN.fullContour(holder, {}).split(';').map((q) => Number(q.split('_')[1])), top = Math.max(...ys.filter((y) => y < 2000));
  assert.ok(ys.includes(1000 + 240), 'wierzchołek trzpienia na J + L2 (100 + 24 mm)'); void top;
  // frez z mocowaniem FRE032: najniższy punkt konturu na Z = −L2, inne mocowanie – bez cofnięcia
  const mill = { D: 'fre', E: 'tar', F: '80', I: '60', J: '50', K: '20', L: '16', M: 'FRE032' };
  const lo = (p) => Math.min(...GEN.fullContour(p, {}).split(';').filter(Boolean).map((q) => Number(q.split('_')[1])));
  assert.equal(lo(mill), -240); assert.equal(lo({ ...mill, M: 'XXX001' }), 0);
  // płytki: długość robocza J − L2 tylko dla frezów z mocowaniem FRExxx; gniazdo i kanał
  const t = { productCode: 'FR1', columnD: 'fre', columnE: 'tar', columnP: 'Iscar', columnF: '80', columnJ: '50', columnM: 'FRE032', columnG: '' };
  assert.equal(G2.plateLength(t), 26); assert.equal(G2.plateLength({ ...t, columnM: 'ABS063' }), 50); assert.equal(G2.plateLength({ ...t, columnD: 'opr' }), 50);
  const contour = GEN.fullContour(mill, {}).split(';').filter(Boolean).map((q) => { const [x, y] = q.split('_').map(Number); return { x, y }; });
  const fit = G2.fitDrawingFor('FRE032', contour);
  assert.deepEqual(fit.hidden[0].map((p) => [p.x, p.y]), [[-160, -240], [-160, 0], [160, 0], [160, -240]], 'otwór ød32, głębokość L2 = 24 od dolnej płaszczyzny');
  const key = fit.hidden[1]; assert.equal(key[0].y, key[1].y); assert.equal(key[0].y, 0, 'linia kanału pod kamień na wysokości L2 nad dolną płaszczyzną (Z = 0 po cofnięciu o L2)'); assert.ok(key[1].x > 160, 'kanał pod kamień na całej szerokości frezu');
  assert.deepEqual(fit.cavity, { bottom: true, ri: 160, yTop: 0 });
  assert.equal(G2.fitDrawingFor('ABS063', contour), null);
  // 3D: wnęka otwarta od dołu – bryła ma otwór przy dolnej płaszczyźnie
  const prof = G2.profileOf(contour, fit.cavity); assert.deepEqual([prof[0].x, prof[0].y], [160, -240]); assert.ok(prof.some((p) => p.x === 0 && p.y === 0 - 0), 'dno otworu na osi');
});

test('frezy FRExxx: wymiary trzpienia poznane z oprawek PSWT (L – średnica, K – wysokość), bez mocowania z arkusza', async () => {
  const GEN = await import('../src/renderer/js/logic/contourGen.js');
  const { contourOverrides } = await import('../src/renderer/js/logic/contourEditor.js');
  try {
    contourOverrides({ h1: { D: 'opr', E: 'stż', N: 'FRE022', L: '22', K: '19' }, h2: { D: 'opr', E: 'stż', N: 'FRE027', L: '27', K: '23' } }, {}, { gen: false });
    assert.equal(GEN.freL2('FRE022'), 19); assert.equal(GEN.freL2('FRE027'), 23, 'wysokość z oprawki (K) ma pierwszeństwo przed tabelą'); assert.equal(GEN.freD('FRE027'), 27); assert.equal(GEN.freL2('FRE032'), 24, 'brak oprawki – tabela');
    // frez z mocowaniem FRE027: kontur cofnięty o 23 mm; mocowanie z arkusza pominięte
    const mill = { D: 'fre', E: 'tar', F: '80', I: '60', J: '50', K: '20', L: '16', M: 'FRE027' };
    const ys = GEN.fullContour(mill, { FRE027: { left: '0_-270;-200_-270;-200_0', right: '' } }).split(';').filter(Boolean).map((q) => Number(q.split('_')[1]));
    assert.equal(Math.min(...ys), -230);
    // fre / glo bez reguły korpusu: nie rysuje się samego mocowania z arkusza (zostaje kolumna T)
    assert.equal(GEN.fullContour({ D: 'fre', E: 'glo', F: '50', J: '48', K: '48', M: 'FRE022' }, { FRE022: { left: '0_-270;-200_-270;-200_0', right: '' } }), null);
  } finally { contourOverrides({}, {}, { gen: false }); }
});
