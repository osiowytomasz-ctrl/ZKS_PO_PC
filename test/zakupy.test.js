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
  for (const v of ['bought', 'nopz']) assert.deepEqual(Z.columns(v).map((c) => c.key), ['zakup', 'kod', 'ilosc', 'pz', 'opis']);
});
test('edycja: normalizacja daty, PZ i pustych wartości', () => {
  assert.deepEqual(Z.normalizeEdit('pz', ' X '), { ok: true, value: 'x' });
  assert.deepEqual(Z.normalizeEdit('pz', '0012/11/M0/01'), { ok: true, value: '0012/11/M0/01' });
  assert.deepEqual(Z.normalizeEdit('zakup', '2026-11-24'), { ok: true, value: '24.11.2026' });
  assert.deepEqual(Z.normalizeEdit('zakup', ''), { ok: true, value: '' });
  assert.equal(Z.normalizeEdit('zakup', 'jutro').ok, false);
  assert.equal(Z.normalizeEdit('zmw', 'x').ok, false);
  assert.ok(Z.editableView('bought') && Z.editableView('nopz') && !Z.editableView('ordered') && !Z.editableView('archive'));
});
test('po zmianie PZ pozycja przechodzi między widokami', () => {
  const r = row(6, { columnC: 'E5', columnE: 'x' });
  assert.ok(Z.isNoPz(r));
  Z.setValue(r, 'pz', '0001/11/M0/02');
  assert.ok(!Z.isNoPz(r) && !Z.lacksPz(r));
});
