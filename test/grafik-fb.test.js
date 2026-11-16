import test from 'node:test';
import assert from 'node:assert/strict';
import { cellStyle, headerStyle, personSummary, codeHours, displayName, grafNormDays, monthsBetween, daysBetween, unpackMonths, cleanCode } from '../src/renderer/js/logic/grafikFb.js';

const ctx = { todayIso: '2026-11-16', hour: 10 };   // poniedziałek, 10:00

test('kolory jak formatowanie warunkowe karty G (kolejność reguł)', () => {
  const bg = (code, iso, c = ctx) => cellStyle(code, iso, c).bg;
  assert.equal(bg('UT', '2026-11-20'), '#92d050');
  assert.equal(bg('ut', '2026-11-20'), '#92d050');                                // bez wielkości liter jak w arkuszu
  assert.equal(bg('UT', '2026-11-20', { ...ctx, utNegative: true }), '#ff0000');
  assert.equal(bg('L4', '2026-11-10'), '#000000');                                  // L4 przed regułą „minione”
  assert.equal(cellStyle('L4', '2026-11-10', ctx).color, '#ffff00');
  assert.equal(bg('a8', '2026-11-10'), '#434343');                                  // minione – szare
  assert.equal(bg('a8', '2026-11-18'), '#f3f3f3');                                  // I zmiana
  assert.equal(bg('b8', '2026-11-18'), '#d9d9d9');
  assert.equal(bg('c8', '2026-11-18'), '#b7b7b7');
  assert.equal(bg('a8b2', '2026-11-18'), '#d9d9d9');                                // 4 znaki: litera na 3. miejscu (jak w arkuszu)
  assert.equal(bg('a8', '2026-11-16'), '#00b050');                                  // dziś, I zmiana trwa (10:00)
  assert.equal(bg('a8', '2026-11-16', { ...ctx, hour: 15 }), '#434343');            // po 14:00 I zmiana minęła
  assert.equal(bg('b8', '2026-11-16', { ...ctx, hour: 15 }), '#00b050');
  assert.equal(bg('c8', '2026-11-15', { ...ctx, hour: 5 }), '#434343');              // jak w arkuszu: reguła „minione” jest wcześniej niż „trwa”
  assert.equal(bg('c8', '2026-11-16', { ...ctx, hour: 23 }), '#00b050');
  assert.equal(bg('', '2026-11-21'), '#00b0f0');                                    // pusta sobota
  assert.equal(bg('', '2026-11-22'), '#cc0000');                                    // pusta niedziela
  assert.equal(bg('', '2026-11-18', { ...ctx, holiday: true }), '#cc0000');
  assert.equal(bg('', '2026-11-18'), '#000000');                                    // pusty dzień roboczy – czarny
  assert.equal(bg('Nż', '2026-11-18'), '#0d904f');
  assert.equal(bg('x.w', '2026-11-18'), '#0000ff');
  assert.equal(bg('Szk', '2026-11-18'), '#7f6000');
  assert.equal(bg('a8*', '2026-11-18'), '#1155cc');
  assert.equal(bg('?', '2026-11-18'), '#ffc7ff');
  assert.equal(bg('a?8', '2026-11-18'), '#ff0000');
  assert.equal(headerStyle('2026-11-21').bg, '#00b0f0');
  assert.equal(headerStyle('2026-11-22').bg, '#cc0000');
  assert.equal(headerStyle('2026-11-11', true).bg, '#cc0000');
});

test('podsumowania urlopów i godzin jak kolumny C, D, F–Q, AD–AO, AS, AT, AU–BE', () => {
  const p = { name: 'Kowalski Jan', suffix: 'br', ut: { 2026: { prev: 2, cur: 26, plan: [2, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 6] } } };
  const codes = { '2026-01-05': 'UT', '2026-01-06': 'UT', '2026-01-07': 'a8', '2026-01-08': 'a5b3', '2026-02-02': 'L4', '2026-02-03': 'nż',
    '2026-11-20': 'UT', '2026-12-01': 'UT', '2025-12-31': 'UT', '2026-03-01': 'BO' };
  const s = personSummary(p, codes, 2026, '2026-11-16');
  assert.deepEqual(s.utByMonth.slice(0, 2), [2, 0]);
  assert.equal(s.utByMonth[10], 1); assert.equal(s.utByMonth[11], 1);
  assert.equal(s.used, 3);                                   // 2× UT w styczniu + NŻ (do dziś); 2025 nie liczy się
  assert.equal(s.future, 2);
  assert.equal(s.available, 2 + 26 - 3);
  assert.equal(s.remaining, 25 - 2);
  assert.equal(s.planned, 18);
  assert.deepEqual(s.hoursToMonth.slice(0, 3), [16, 16, 16]);
  assert.equal(s.absences.L4, 1); assert.equal(s.absences['NŻ'], 1); assert.equal(s.absences.BO, 1);
  assert.equal(s.monthPlanMet[0], true); assert.equal(s.monthPlanMet[11], false);
  assert.equal(displayName(p, s.remaining), 'Kowalski Jan   UT= 23 br');
  assert.equal(codeHours('a8b2'), 10); assert.equal(codeHours('L4'), 0);
});

test('graf_norm z Grafiku: miejsca pracy z kolumny BF', () => {
  const people = [{ id: 'p1', place: '1Si1' }, { id: 'p2', place: '1Si2' }, { id: 's', sep: true }, { id: 'p3', place: '' }, { id: 'p4', place: '1Si1' }];
  const codes = { p1: { '2026-11-16': 'a8' }, p2: { '2026-11-16': 'UT' }, p3: { '2026-11-16': 'a8' }, p4: { '2026-11-16': 'b8' } };
  assert.deepEqual(grafNormDays(people, codes, ['2026-11-16', '2026-11-17']), { '2026-11-16': { '1Si1': 'a8', '1Si2': 'UT' }, '2026-11-17': { '1Si1': '', '1Si2': '' } });
});

test('paczki miesięczne i daty', () => {
  assert.deepEqual(monthsBetween('2026-11-13', '2027-01-02'), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(daysBetween('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01']);
  const u = unpackMonths({ '2026-11': { c: { p1: { 16: 'a8', '17': 'b8' } }, n: { p1: { 16: 'zamiana z p2' } } } });
  assert.deepEqual(u.codes, { p1: { '2026-11-16': 'a8', '2026-11-17': 'b8' } });
  assert.deepEqual(u.notes, { p1: { '2026-11-16': 'zamiana z p2' } });
  assert.equal(cleanCode('  a8  b2 '), 'a8 b2');
});
