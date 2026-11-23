// Mistrz PO: formuły arkusza liczone w programie (dane wymyślone – bez danych z pliku produkcyjnego).
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOps, computeDocs, computeDetailReg, computeDetailList, computeZkom, computeAll, rowsFromGrid, xlsxValue, looseKey, sheetByKey, sheetColumns, cellText, detailQr, stamp, MENU, SHEETS, groupOfTab } from '../src/renderer/js/logic/mistrz.js';

const row = (n, v) => ({ row: n, v });
const op = (n, A, B, C, D, E, I) => row(n, { A, B, C, D, E, I });

test('Rejestr operacji: status g, liczba zakończonych, postęp i status z dokumentacji', () => {
  const ops = [op(3, '2026-01-02', '07:00', 'K1/26/1', '1', 10, 'Start'), op(4, '2026-01-02', '15:00', 'K1/26/1', '1', 10, 'Koniec'),
    op(5, '2026-01-03', '07:00', 'K1/26/1', '1', 20, 'Start'), op(6, '2026-01-03', '09:00', 'K1/26/1', '1', '20', 'W toku'), op(7, '2026-01-03', '10:00', 'X', '9', 10, 'Usunięta')];
  const docs = computeDocs([row(3, { C: 'K1/26/1', D: '1', I: 4 })], ops, []);
  const r = computeOps(ops, docs);
  assert.deepEqual(r.map((x) => x.K), ['Koniec', 'Koniec', 'W toku', 'W toku', '']);
  assert.deepEqual(r.map((x) => x.L), [0, 1, 0, 0, 0]);
  assert.equal(r[0].M, 0.25); assert.equal(r[0].P, '1 / 4'); assert.equal(r[0].O, 'K1/26/11');
  assert.equal(r[4].M, 'Brak dokumentu');
  assert.deepEqual(computeOps(ops, [], true).map((x) => x.K), ['', 1, '', '', '']);
});

test('Rejestr dokumentacji: status z archiwum, start, koniec i czas', () => {
  const ops = [op(3, '2026-01-02', '07:00', 'A', '1', 10, 'Start'), op(4, '2026-01-02', '15:00', 'A', '1', 10, 'Koniec'), op(5, '2026-01-03', '09:30', 'A', '1', 20, 'Koniec')];
  const arch = [op(3, '2025-05-01', '06:00', 'B', '2', 10, 'Start'), op(4, '2025-05-01', '08:00', 'B', '2', 10, 'Koniec')];
  const [a, b, c] = computeDocs([row(3, { C: 'A', D: '1', I: 2 }), row(4, { C: 'B', D: '2', I: 1 }), row(5, { C: 'C', D: '3', I: 5 })], ops, arch);
  assert.equal(a.K, '2 / 2'); assert.equal(a.M, 1); assert.equal(a.L, 'A1');
  assert.equal(a.N, stamp('2026-01-02', '07:00')); assert.equal(a.P, stamp('2026-01-03', '09:30')); assert.equal(a.O, 26.5);
  assert.equal(b.K, 'Ar :1 / 1'); assert.equal(b.O, 2);
  assert.equal(c.K, '0 / 5'); assert.equal(c.M, 0); assert.equal(c.N, '');
  assert.equal(cellText('docs', 'N', a.N), '02.01.2026 07:00'); assert.equal(cellText('docs', 'M', a.M), '100%'); assert.equal(cellText('docs', 'O', a.O), '26,5');
});

test('Detale: do zrobienia, zrobione, postęp i kod QR; numery zamienione przez arkusz na daty i liczby', () => {
  const list = [row(3, { A: 1, B: '26/1', C: 'Kołnierz', D: 'R-1', E: '2.1.4', F: 1, G: 4 }), row(4, { A: 2, B: '26/1', C: 'Tuleja', D: '0000123', E: '2,3', F: 1, G: 2 })];
  const reg = [row(3, { C: '26/1', D: 'R-1', E: '2002-01-04', F: 1, G: 1 }), row(4, { C: '26/1', D: 'R-1', E: '2.1.4', F: '1', G: 2 }), row(5, { C: '26/1', D: 123, E: 2.3, F: 1, G: 2 })];
  const r = computeDetailReg(reg, list);
  assert.deepEqual(r.map((x) => [x.J, x.K, x.I]), [[4, 3, 0.75], [4, 3, 0.75], [2, 2, 1]]);
  const l = computeDetailList(list, reg);
  assert.deepEqual(l.map((x) => x.L), [0.75, 1]); assert.equal(l[0].J, 'R-12.1.4'); assert.equal(l[0].K, 4);
  assert.equal(detailQr(list[0].v), '*26/1*$R-1$⍵2.1.4⍵^1^@4@'); assert.equal(detailQr({ B: 'x' }), '');
  assert.equal(looseKey('06-01'), looseKey('2026-06-01')); assert.notEqual(looseKey('06-02'), looseKey('2026-06-01'));
});

test('Z.kom: wpisany status albo „wstrzymany” z kolumny I; import pomija wynik formuły', () => {
  assert.deepEqual(computeZkom([row(2, { A: 'zak.', I: 'Realizowane' }), row(3, { I: 'Wstrzymane do odwołania' }), row(4, { I: 'Realizowane' })]).map((x) => x.A), ['zak.', 'wstrzymany', '']);
  const g = [['Status', 'Komis'], ['wstrzymany', '18/1', '', '', '', '', '', '', 'wstrzymane'], ['zak.', '19/2'], []];
  assert.deepEqual(rowsFromGrid(sheetByKey('zkom'), g), [{ row: 2, v: { B: '18/1', I: 'wstrzymane' } }, { row: 3, v: { A: 'zak.', B: '19/2' } }]);
});

test('Import: tylko kolumny wpisywane, daty i godziny z Excela, kolumny jak w pliku', () => {
  const sh = sheetByKey('ops');
  const g = [['tytuł'], ['Data'], ['2026-01-02', '07:00', 'K', '1', 10, 'Kl', 'R', 'op@x', 'Start', '', 'Koniec', 5, 'x', 'y', 'z', 'q']];
  assert.deepEqual(rowsFromGrid(sh, g), [{ row: 3, v: { A: '2026-01-02', B: '07:00', C: 'K', D: '1', E: 10, F: 'Kl', G: 'R', H: 'op@x', I: 'Start' } }]);
  assert.equal(xlsxValue({ v: 46024, date: true }), '2026-01-02'); assert.equal(xlsxValue({ v: 0.5, date: true }), '12:00');
  assert.equal(xlsxValue({ v: 46024.25, date: true }), '2026-01-02 06:00'); assert.equal(xlsxValue({ v: 'abc' }), 'abc');
  assert.deepEqual(sheetColumns(sheetByKey('dreg')).map((c) => c.key), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
  assert.equal(Object.keys(computeAll({})).length, 8);
});

test('Kolory jak formatowanie warunkowe arkusza', async () => {
  const { cellColor } = await import('../src/renderer/js/logic/mistrz.js');
  assert.deepEqual(cellColor('ops', { K: 'Koniec' }, 'A'), ['#6aa84f', '']); assert.equal(cellColor('ops', { K: 'Koniec' }, 'M'), null);
  assert.deepEqual(cellColor('ops', { D: '1', E: 10 }, 'E', { D: '1', E: 40 }), ['#ff00ff', '']);
  assert.deepEqual(cellColor('docs', { C: 'A', K: '1 / 4', M: 0.25 }, 'B'), ['#ff9900', '']); assert.deepEqual(cellColor('docs', { C: 'A', K: 'Ar :4 / 4', M: 1 }, 'B'), ['#666666', '#ffffff']);
  assert.deepEqual(cellColor('dreg', { J: 4, K: 4 }, 'A'), ['#93c47d', '#000000']); assert.deepEqual(cellColor('dlist', { B: 'x', L: 0.5 }, 'C'), ['#ff0000', '#ffffff']);
});

test('menu Mistrza: grupy i zakładki podrzędne, każda zakładka arkusza dostępna', () => {
  assert.deepEqual(MENU.map((g) => g.label), ['Dane Pracowników', 'Rejestr KTK', 'Rejestr Detali', 'Archiwa']);
  const keys = MENU.flatMap((g) => (g.tabs || []).map(([k]) => k));
  assert.deepEqual([...keys].sort(), SHEETS.map((s) => s.key).sort());
  assert.equal(groupOfTab('dlist'), 'detali'); assert.equal(groupOfTab('docsArch'), 'archiwa'); assert.equal(groupOfTab('nieznana'), 'ktk');
  assert.equal(MENU[0].module, 'kompetencje');
});
