import test from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, describeCode, daySlots, grafikPeople, assignPeople, dayTasks } from '../src/renderer/js/logic/harmDay.js';

const D = (d, h = 0) => Date.UTC(2026, 10, d, h);

test('dzień kliknięcia i doba produkcyjna 6:00–6:00', () => {
  const d = dayOf(D(12, 14) + 25 * 60000);
  assert.equal(d.iso, '2026-11-12'); assert.equal(d.label, '12.11.2026'); assert.equal(d.weekday, 'czwartek');
  assert.equal(d.start, D(12, 6)); assert.equal(d.end, D(13, 6));
});

test('kody grafiku: zmiany i nieobecności', () => {
  assert.deepEqual(describeCode('a5b3'), { text: 'a5b3', hours: 8, work: true, shifts: 'I zm. 5 h, II zm. 3 h' });
  assert.equal(describeCode('L4').shifts, 'zwolnienie lekarskie'); assert.equal(describeCode('ut').shifts, 'urlop'); assert.equal(describeCode('L4').work, false);
});

test('obsada maszyn z graf_norm', () => {
  const days = { '2026-11-12': { '1Si1': 'a8', '1Si2': 'b8', '1Si3': 'L4', '5Śl1': 'a8', '5Śl2': 'a8', X9: 'a8' } };
  const st = [{ name: '1Si', bg: '#0070c0', color: '#ffffff' }, { name: '2Un', bg: '#00b0f0', color: '#000' }, { name: '5Śl', bg: '#92d050', color: '#000' }];
  const s = daySlots(days, '2026-11-12', st);
  assert.deepEqual(s.map((x) => x.station), ['1Si', '5Śl', 'Inne']);
  assert.deepEqual(s[0].slots.map((x) => x.slot), ['1Si1', '1Si2', '1Si3']); assert.equal(s[0].hours, 16); assert.equal(s[1].hours, 16);
  assert.equal(daySlots(days, '2026-11-13', st).length, 0);
});

test('pracownicy z Grafiku i przypisanie do maszyn', () => {
  const gr = { rows: [{ name: 'Pracownik', value: 'Dysp.' }, { name: 'Kowalski Jan', value: 'tok', nameBg: '#fff' }, { name: '****', value: '' }, { name: 'Nowak Adam', value: '' }, { name: 'Lis Ewa', value: '' }, { name: 'Wolny Tomasz' }],
    extraValues: [['12.11.2026'], ['1Si1 a8'], [''], ['5Śl'], ['UT'], ['']], extraBackgrounds: [[''], ['#ffff00'], [''], ['#00ff00'], ['#cccccc'], ['']], extraFontColors: [[''], ['#000000'], [''], [''], [''], ['']] };
  const p = grafikPeople(gr);
  assert.deepEqual(p.map((x) => [x.name, x.text, x.bg]), [['Kowalski Jan', '1Si1 a8', '#ffff00'], ['Nowak Ada', '5Śl', '#00ff00'], ['Lis Ewa', 'UT', '#cccccc']]);
  const a = assignPeople(p, ['1Si1', '1Si2', '1Si11'], ['1Si', '5Śl']);
  assert.deepEqual(a.bySlot.get('1Si1').map((x) => x.name), ['Kowalski Jan']); assert.equal(a.bySlot.has('1Si11'), false);
  assert.deepEqual(a.byStation.get('5Śl').map((x) => x.name), ['Nowak Ada']); assert.deepEqual(a.rest.map((x) => x.name), ['Lis Ewa']);
});

test('zadania w dobie: tylko operacje-liście, które wtedy trwają', () => {
  const rows = [
    { id: '100', subCount: 2, komis: 'K1' }, { id: '100a', komis: 'K1', stanowisko: '1Si', hours: '8' }, { id: '100b', komis: 'K1', stanowisko: '2Un', hours: '4' },
    { id: '200', komis: 'K2', stanowisko: '1Si', hours: '2' }, { id: 'K:K1', komisRow: true },
  ];
  const result = new Map([['100', { start: D(12, 6), end: D(14, 10) }], ['100a', { start: D(12, 6), end: D(12, 14) }], ['100b', { start: D(14, 6), end: D(14, 10) }], ['200', { start: D(13, 4), end: D(13, 6) }]]);
  const t = dayTasks(rows, result, D(12, 6), D(13, 6));
  assert.deepEqual(t.tasks.map((x) => x.row.id), ['100a', '200']);
  assert.deepEqual([...t.byStation.keys()], ['1Si']);
  assert.deepEqual(t.komis.map((k) => [k.komis, k.tasks, k.hours]), [['K1', 1, 8], ['K2', 1, 2]]);
});
