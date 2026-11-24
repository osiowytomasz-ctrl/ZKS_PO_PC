// Zakupy: widoki Zamówione / Zakupione / Odebrane bez PZ, kolumny i edycja komórek (dane wymyślone).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Z from '../src/renderer/js/logic/zakupy.js';

const row = (n, o) => ({ rowNumber: n, columnB: '', columnC: '', columnD: '', columnE: '', columnH: '', columnI: '', columnK: '', ...o });
const rows = [
  row(2, { columnC: 'A1', columnI: '5', columnH: '2026-11-01' }),                       // zamówione
  row(3, { columnC: 'B2', columnE: 'x', columnB: '2026-11-10', columnD: '3' }),           // odebrane bez PZ
  row(4, { columnC: 'C3', columnE: 'X', columnB: '2026-11-11' }),                         // odebrane bez PZ (wielka litera)
  row(5, { columnC: 'D4', columnE: '0012/11/M0/01', columnB: '2026-11-12', columnD: '2' }), // zakupione
];

test('widoki: Zamówione bez „x” i PZ, Zakupione bez „x”, Odebrane bez PZ tylko z „x”/„X”', () => {
  assert.deepEqual(Z.source(rows, [], 'ordered').map((r) => r.rowNumber), [2]);
  assert.deepEqual(Z.source(rows, [], 'bought').map((r) => r.rowNumber), [5]);
  assert.deepEqual(Z.source(rows, [], 'nopz').map((r) => r.rowNumber), [3, 4]);
  assert.deepEqual(Object.values(Z.VIEWS), ['Zamówione', 'Zakupione', 'Odebrane bez PZ', 'Archiwum']);
});
test('kolumny: Zamówione bez kodu, Zakupione i Odebrane bez PZ z kodem', () => {
  assert.deepEqual(Z.columns('ordered').map((c) => c.key), ['zamowiono', 'iloscZamowiona', 'zmw', 'opis']);
  assert.deepEqual(Z.columns('bought').map((c) => c.key), ['zakup', 'kod', 'ilosc', 'pz', 'opis']);
  assert.deepEqual(Z.columns('nopz').map((c) => c.key), ['zakup', 'kod', 'ilosc', 'pz', 'zmw', 'opis']);   // Odebrane bez PZ pokazują też ZMW
});
test('edycja: normalizacja daty, PZ i pustych wartości', () => {
  assert.deepEqual(Z.normalizeEdit('pz', ' X '), { ok: true, value: 'x' });
  assert.deepEqual(Z.normalizeEdit('pz', '0012/11/M0/01'), { ok: true, value: '0012/11/M0/01' });
  assert.deepEqual(Z.normalizeEdit('zakup', '2026-11-24'), { ok: true, value: '24.11.2026' });
  assert.deepEqual(Z.normalizeEdit('zakup', ''), { ok: true, value: '' });
  assert.equal(Z.normalizeEdit('zakup', 'jutro').ok, false);
  assert.deepEqual(Z.normalizeEdit('zmw', ' 12/11/26 '), { ok: true, value: '12/11/26' });
  assert.equal(Z.normalizeEdit('iloscZamowiona', '1').ok, false);
  assert.ok(Z.editableView('bought') && Z.editableView('nopz') && !Z.editableView('ordered') && !Z.editableView('archive'));
});
test('po zmianie PZ pozycja przechodzi między widokami', () => {
  const r = row(6, { columnC: 'E5', columnE: 'x' });
  assert.ok(Z.isNoPz(r));
  Z.setValue(r, 'pz', '0001/11/M0/02');
  assert.ok(!Z.isNoPz(r) && !Z.lacksPz(r));
});

test('sortowanie PZ: najpierw rok (DD), potem miesiąc (BB), na końcu numer (AAAA); ZMW: CC, BB, AAAA', () => {
  const pz = ['0012/11/M0/26', '0003/01/M0/27', '0100/02/M0/26', '0001/11/M0/26', 'x', ''];
  const sortedPz = Z.shown(pz.map((v, i) => row(i + 10, { columnE: v || 'zz', columnC: 'K' })).map((r, i) => ({ ...r, columnE: pz[i] })), [], 'bought', {}, [{ key: 'pz', ascending: true }]);
  // PZ puste nie trafia do Zakupione; „x” – do innego widoku; sprawdzamy kolejność samych numerów
  assert.deepEqual(sortedPz.map((r) => r.columnE), ['0100/02/M0/26', '0001/11/M0/26', '0012/11/M0/26', '0003/01/M0/27']);
  assert.ok(Z.compareSegmented('0100/02/M0/26', '0001/11/M0/26') < 0);       // luty 26 przed listopadem 26
  assert.ok(Z.compareSegmented('0001/11/M0/26', '0012/11/M0/26') < 0);       // ten sam miesiąc i rok – po numerze
  assert.ok(Z.compareSegmented('0012/11/M0/26', '0003/01/M0/27') < 0);       // rok ważniejszy niż numer
  const zmw = ['0005/11/26', '0100/03/26', '0002/01/27', '0001/11/26'];
  const sortedZmw = Z.shown(zmw.map((v, i) => row(i + 20, { columnG: v, columnI: '1' })), [], 'ordered', {}, [{ key: 'zmw', ascending: true }]);
  assert.deepEqual(sortedZmw.map((r) => r.columnG), ['0100/03/26', '0001/11/26', '0005/11/26', '0002/01/27']);
  const desc = Z.shown(zmw.map((v, i) => row(i + 20, { columnG: v, columnI: '1' })), [], 'ordered', {}, [{ key: 'zmw', ascending: false }]);
  assert.deepEqual(desc.map((r) => r.columnG), ['0002/01/27', '0005/11/26', '0001/11/26', '0100/03/26']);
  // lista wartości w oknie filtra ma tę samą kolejność
  const opts = Z.options(zmw.map((v, i) => row(i + 20, { columnG: v, columnI: '1' })), 'ordered', {}, Z.columns('ordered').find((c) => c.key === 'zmw'));
  assert.deepEqual(opts.map((o) => o.value), ['0100/03/26', '0001/11/26', '0005/11/26', '0002/01/27']);
});
