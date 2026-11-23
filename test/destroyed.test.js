import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/renderer/js/logic/destroyed.js';

const HEAD = ['lp.', 'Nr narz.', 'procent\r\nzniszcz', 'Opis narzedzia', 'Cena ', 'Firma', 'Oznaczenie', 'Kto\r\ngdzie', 'Data', 'data2', 'Kwota strat na narzędziu', 'Opis zniszczeń', 'Przyczyna'];
const row = (lp, code, pct, extra = {}) => [lp, code, pct, extra.opis || '', extra.cena || '', extra.firma || '', extra.mark || '', extra.who || '', extra.date || '', '', extra.loss || '', extra.damage || '', extra.cause || ''];
const VALUES = [['Osiągnięcia w dziedzinie użytkowania narzędzi - Ranking'], HEAD,
  row('21', 'FA025', '30%', { opis: 'Frez', cena: '1 200,00 zł', firma: 'Iscar', who: 'C_Par', date: '01.01.2022', loss: '360,00 zł', damage: 'utrata 2 rzędów', cause: 'Kolizja' }),
  row('25', 'FA025', '100%', { who: 'C_Kry', date: '20.06.2024', loss: '840,00 zł', damage: 'brak rzędu', cause: 'Posuw' }),
  row('9', '', '100%'), row('5', 'FC004', '', { date: '17.03.2022' }), row('2', 'fi002', '20%', { who: 'U_Mar', date: '09.05.2022' })];

test('parsowanie karty ZN: nagłówki z zawijaniem, pominięcie wierszy bez numeru, liczby i daty', () => {
  const e = D.parseZn(VALUES);
  assert.equal(e.length, 4); assert.deepEqual(e.map((x) => x.code), ['FA025', 'FA025', 'FC004', 'fi002']);
  assert.equal(e[0].pct, 30); assert.equal(e[0].loss, 360); assert.equal(e[0].cena, '1 200,00 zł'); assert.equal(e[2].pct, null); assert.ok(e[1].ts > e[0].ts);
  assert.equal(D.parseNumber('1 234,50 zł'), 1234.5); assert.equal(D.parseNumber('100%'), 100); assert.equal(D.parseNumber(''), null);
});

test('narzędzia z historią: stan z najnowszego wpisu, suma strat, sortowanie', () => {
  const g = D.groupByTool(D.parseZn(VALUES)), fa = g.find((x) => x.key === 'fa025');
  assert.equal(g.length, 3); assert.equal(fa.events, 2); assert.equal(fa.pct, 100); assert.equal(fa.loss, 1200); assert.equal(fa.entries[0].date, '20.06.2024'); assert.deepEqual(fa.who, ['C_Par', 'C_Kry'].sort().reverse().length ? fa.who : []);
  assert.equal(fa.opis, 'Frez'); assert.equal(fa.firma, 'Iscar');
  assert.deepEqual(D.sortGroups(g, 'pct').map((x) => x.key), ['fa025', 'fi002', 'fc004']); assert.deepEqual(D.sortGroups(g, 'code').map((x) => x.key), ['fa025', 'fc004', 'fi002']);
  assert.equal(D.sortGroups(g, 'loss')[0].key, 'fa025'); assert.equal(D.sortGroups(g, 'code', -1)[0].key, 'fi002');
  assert.equal(D.wearColor(10), '#00c853'); assert.equal(D.wearColor(50), '#ffd600'); assert.equal(D.wearColor(90), '#d50000'); assert.equal(D.wearColor(null), '#bdbdbd');
  assert.match(D.money(1200), /1\s?200,00 zł/);
});

test('formularz zniszczonego narzędzia: wymagane pola, procent, data', () => {
  const now = new Date(2026, 10, 23);
  assert.equal(D.todayKey(now), '2026-11-23');
  assert.equal(D.makeZnEntry({ code: ' ', pct: 50 }, now).error, 'Podaj numer narzędzia.');
  assert.match(D.makeZnEntry({ code: 'FA1', pct: '' }, now).error, /procent/); assert.match(D.makeZnEntry({ code: 'FA1', pct: 150 }, now).error, /procent/); assert.match(D.makeZnEntry({ code: 'FA1', pct: 'abc' }, now).error, /procent/);
  assert.match(D.makeZnEntry({ code: 'FA1', pct: 10, date: '2026-02-31' }, now).error, /data/i); assert.match(D.makeZnEntry({ code: 'FA1', pct: 10, date: '23.11.2026' }, now).error, /datę/);
  assert.deepEqual(D.makeZnEntry({ code: ' FA1 ', pct: '50,5%', who: ' C_Par ', damage: ' złamany ', cause: ' kolizja ' }, now), { entry: { code: 'FA1', pct: 50.5, who: 'C_Par', date: '2026-11-23', damage: 'złamany', cause: 'kolizja' } });
});
