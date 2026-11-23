// Kolejka wysyłki do arkusza (Grafik, Plan) – pozycje kolejki.
import test from 'node:test';
import assert from 'node:assert/strict';
import { grafikQueueItems, planQueueItems } from '../src/renderer/js/syncStore.js';

test('kolejka Grafiku: ostatnia wartość komórki, osoby bez wiersza karty G pomijane', () => {
  const it = grafikQueueItems([{ pid: 'PO1', iso: '2026-11-20', code: 'a8' }, { pid: 'PO.2', iso: '2026-11-20', note: 'uwaga' }, { pid: 'X', iso: '2026-11-20', code: 'b8' }], { PO1: 5, 'PO.2': 6 }, 7);
  assert.deepEqual(it, { 'PO1~2026-11-20': { row: 5, iso: '2026-11-20', ts: 7, value: 'a8' }, 'PO%2E2~2026-11-20': { row: 6, iso: '2026-11-20', ts: 7, note: 'uwaga' } });
});
test('kolejka Planu: wiersz~kolumna', () => {
  assert.deepEqual(planQueueItems([{ row: 3, col: 2, value: '<span>x</span>' }], 9), { '3~2': { row: 3, col: 2, value: '<span>x</span>', ts: 9 } });
});

import { splitResults } from '../src/renderer/js/syncStore.js';
test('wynik wysyłki Grafiku: z kolejki znikają tylko zapisane, reszta ma powód', () => {
  const r = splitResults(['a', 'b', 'c', 'd'], ['ok', 'nodate', 'name', 'norow']);
  assert.deepEqual(r.ok, ['a']);
  assert.deepEqual(r.failed.map((x) => x.key), ['b', 'c', 'd']);
  assert.match(r.failed[1].why, /po nazwisku/);
  const old = splitResults(['a', 'b'], undefined);   // stary serwer bez wyników: nic nie uznajemy za zapisane
  assert.deepEqual(old.ok, []); assert.match(old.failed[0].why, /starą wersję/);
});
test('kolejka Grafiku: nazwisko do weryfikacji wiersza', () => {
  const it = grafikQueueItems([{ pid: 'P', iso: '2026-11-22', code: 'x' }], { P: 9 }, 1, { P: 'Wlazłowski Paweł' });
  assert.equal(it['P~2026-11-22'].name, 'Wlazłowski Paweł');
});

import { grafikRange, grafikRangeItems } from '../src/renderer/js/syncStore.js';
test('zakres Grafiku: tydzień wstecz i w przód (15 dni), także na przełomie miesięcy i roku', () => {
  const r = grafikRange(new Date(2026, 0, 3));
  assert.equal(r.days.length, 15); assert.equal(r.from, '2025-12-27'); assert.equal(r.to, '2026-01-10');
  assert.equal(grafikRange(new Date(2026, 10, 22)).from, '2026-11-15');
});
test('pozycje zakresu: każda osoba z wierszem × każdy dzień, puste = wyczyszczenie, separatory pomijane', () => {
  const people = [{ id: 'a', row: 5, name: 'Jan Kowalski' }, { id: 'sep6', row: 6, sep: true, name: '****' }, { id: 'nowy', name: 'Bez wiersza' }];
  const months = { '2026-11': { c: { a: { 22: 'x', '23': 'a8' } }, n: { a: { 22: 'uwaga' } } } };
  const it = grafikRangeItems(people, months, ['2026-11-22', '2026-11-24'], 1);
  assert.deepEqual(Object.keys(it), ['a~2026-11-22', 'a~2026-11-24']);
  assert.deepEqual(it['a~2026-11-22'], { row: 5, iso: '2026-11-22', name: 'Jan Kowalski', value: 'x', note: 'uwaga', ts: 1 });
  assert.equal(it['a~2026-11-24'].value, ''); assert.equal(it['a~2026-11-24'].note, '');
});
