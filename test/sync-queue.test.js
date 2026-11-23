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
  assert.match(r.failed[1].why, /inna osoba/);
  assert.deepEqual(splitResults(['a', 'b'], undefined).ok, ['a', 'b']);   // starszy serwer
});
test('kolejka Grafiku: nazwisko do weryfikacji wiersza', () => {
  const it = grafikQueueItems([{ pid: 'P', iso: '2026-11-22', code: 'x' }], { P: 9 }, 1, { P: 'Wlazłowski Paweł' });
  assert.equal(it['P~2026-11-22'].name, 'Wlazłowski Paweł');
});
