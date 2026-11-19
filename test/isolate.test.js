// Odizolowane od arkusza: Pomiary (karta w Firebase) i Harmonogram (Grafik z bazy) – części bez Firebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KARTA_FIELDS, kartaStamp, listItem } from '../src/renderer/js/pomiaryStore.js';
import { firebaseDayPeople } from '../src/renderer/js/logic/harmDay.js';
import { cellStyle, placeStation, grafNormDays } from '../src/renderer/js/logic/grafikFb.js';

test('karta pomiaru: pola jak w arkuszu, data zapisu, pozycja listy', () => {
  assert.equal(KARTA_FIELDS.length, 33); assert.equal(KARTA_FIELDS[0], 'komis'); assert.equal(KARTA_FIELDS[32], 'signSprawdzilData');
  assert.equal(kartaStamp(new Date(2026, 10, 19, 7, 5, 9)), '19.11.2026 07:05:09');
  assert.deepEqual(listItem('k1', { lp: 3, data: 'd', komis: 'K', klient: 'Kl', nrId: '7', nazwaWyrobu: 'W', nrRys: 'R', colJ: 'Jan' }),
    { rowIndex: 'k1', lp: 3, data: 'd', komis: 'K', klient: 'Kl', nrId: '7', nazwaWyrobu: 'W', nrRys: 'R', autorRaportu: 'Jan' });
});

test('Harmonogram: graf_norm i operatorzy dnia z Grafiku w bazie', () => {
  const people = [{ id: 'A', name: 'Nowak Jan', place: '1Si1' }, { id: 's', sep: true, name: '***' }, { id: 'B', name: 'Kowal Adam', place: '1Si2' }, { id: 'C', name: 'Bez Miejsca', place: '' }];
  const codes = { A: { '2026-11-19': 'a8' }, B: { '2026-11-19': 'UT' }, C: { '2026-11-19': 'b8' } };
  assert.deepEqual(grafNormDays(people, codes, ['2026-11-19'])['2026-11-19'], { '1Si1': 'a8', '1Si2': 'UT' });
  const ops = firebaseDayPeople(people, codes, '2026-11-19', [], cellStyle, placeStation);
  assert.deepEqual(ops.map((p) => [p.name, p.text]), [['Nowak Jan', 'a8'], ['Kowal Adam', 'UT'], ['Bez Miejsca', 'b8']]);
  assert.equal(ops[1].bg, '#92d050');
});
