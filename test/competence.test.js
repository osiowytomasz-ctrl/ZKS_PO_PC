import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx } from '../src/renderer/js/logic/xlsx.js';
import { readXlsx, excelToIso } from '../src/renderer/js/logic/xlsxRead.js';
import { parseCompetenceSheet, points, parseLevel, permAlert, personId, parsePermValue, fmtPerm, levelColor } from '../src/renderer/js/logic/competence.js';

test('odczyt .xlsx i import matrycy (nagłówki w wierszu 3, wagi i kolory grup w wierszu 2)', async () => {
  const D = (iso) => ({ v: Date.parse(iso + 'T00:00:00Z'), style: { date: true } });
  const head = ['lp.', '', 'Nazwisko i Imię pracownika', 'Komis wewnętrzny', 'Obsługiwana maszyna, stanowisko', 'Stanowisko wg. umowy', 'ewid. ZKS', 'Badania ważne do', 'Suwnica Nr uprawnień', 'ur', 'Punkty', 'CNC', 'Piła'];
  const rows = [
    ['Dane podstawowe'],
    [null, null, null, null, null, null, null, null, null, null, null, { v: 3, style: { bg: '#92d050' } }, { v: 1, style: { bg: '#ffc000' } }],
    head,
    [1, 'po', 'Testowy Jan', '606-01', 'Tokarz', 'Operator', 12007, D('2026-12-01'), 'O/09/1', D('1980-01-01'), null, 50, 100],
    [2, 'PL', 'Próbny Adam', '', 'Piła', '', '', 'x', '', null, null, '', 25],
  ];
  const bytes = buildXlsx({ name: 'MK', rows });
  const sheets = await readXlsx(bytes);
  assert.equal(sheets[0].name, 'MK');
  const r = parseCompetenceSheet(sheets[0]);
  assert.deepEqual(r.skills.map((s) => [s.name, s.weight, s.color]), [['CNC', 3, '#92d050'], ['Piła', 1, '#ffc000']]);
  assert.deepEqual(r.perms.map((p) => [p.name, !!p.expiry]), [['Badania ważne do', true], ['Suwnica Nr uprawnień', false]]);   // bez „ur”
  const p = r.people.PO12007;
  assert.equal(p.name, 'Testowy Jan'); assert.equal(p.machine, 'Tokarz');
  assert.equal(Object.values(p.perms)[0], '2026-12-01');
  assert.equal(points(p, r.skills), 50 * 3 + 100 * 1);
  assert.ok(r.people.k5, 'bez numeru – identyfikator z wiersza');
  assert.equal(excelToIso(46357), '2026-12-01');
});

test('wpisy poziomów, dat i terminy uprawnień', () => {
  assert.equal(parseLevel('50'), 50); assert.equal(parseLevel('75%'), 75); assert.equal(parseLevel('0,5'), 50); assert.equal(parseLevel(''), '');
  assert.equal(parseLevel('abc'), null); assert.equal(parseLevel('120'), null);
  assert.equal(parsePermValue('3.3.2025'), '2025-03-03'); assert.equal(parsePermValue('O/09/01631/12'), 'O/09/01631/12');
  assert.equal(fmtPerm('2025-03-03'), '03.03.2025');
  assert.equal(permAlert('2026-11-10', '2026-11-16'), 'expired'); assert.equal(permAlert('2026-12-01', '2026-11-16'), 'soon'); assert.equal(permAlert('2027-01-01', '2026-11-16'), ''); assert.equal(permAlert('x', '2026-11-16'), '');
  assert.equal(personId('po', '12007', 4), 'PO12007'); assert.equal(personId('PO', '', 9), 'k9');
  assert.equal(levelColor(0), null); assert.equal(levelColor(100), '#57bb8a');
});

test('uprawnienia: numer, wydano, ważne do – odczyt arkusza, ważność, terminy', async () => {
  const { parsePermCell, permColumn, mergePermCell, permOf, permValid, validStatus, personPermStatus, isNewPermDefs, parsePermsSheet, PERM_TYPES } = await import('../src/renderer/js/logic/competence.js');
  assert.deepEqual(parsePermCell({ v: 'waż. 15/07/2023' }), { date: '2023-07-15', kind: 'valid' });
  assert.deepEqual(parsePermCell({ v: 'wyd. 18/10/2021' }), { date: '2021-10-18', kind: 'issued' });
  assert.deepEqual(parsePermCell({ v: 'x' }), { text: 'x' });
  assert.equal(parsePermCell({ v: '-' }), null); assert.equal(parsePermCell({ v: 'brak' }), null);
  assert.deepEqual(parsePermCell({ v: 46350, date: true }), { date: '2026-11-24', kind: null });
  assert.deepEqual(permColumn('Suwnica\nNr uprawnień'), ['suw', 'nr']); assert.deepEqual(permColumn('Podesty ruch. wazne data'), ['pod', 'valid']);
  assert.deepEqual(permColumn('Badania ważne do'), ['bad', 'valid']); assert.equal(permColumn('ur'), null);
  // data bez dopisku w kolumnie „data wyd/waż”: przyszła = ważność, miniona = wydanie
  assert.deepEqual(mergePermCell({}, 'auto', { date: '2027-11-24', kind: null }, '2026-11-17'), { valid: '2027-11-24' });
  assert.deepEqual(mergePermCell({ nr: 'A' }, 'auto', { date: '2012-05-23', kind: null }, '2026-11-17'), { nr: 'A', issued: '2012-05-23' });
  assert.deepEqual(permOf({ perms: { a: 'O/1' } }, 'a'), { nr: 'O/1' });
  assert.deepEqual(permValid({ issued: '2021-11-20' }, { validYears: 5 }), { iso: '2026-11-19', computed: true });
  assert.deepEqual(permValid({ issued: '2021-11-20', valid: '2030-01-01' }, { validYears: 5 }), { iso: '2030-01-01', computed: false });
  assert.equal(validStatus('2026-11-10', '2026-11-17'), 'expired'); assert.equal(validStatus('2026-12-01', '2026-11-17'), 'soon'); assert.equal(validStatus('2027-06-01', '2026-11-17'), '');
  assert.equal(personPermStatus({ perms: { bad: { valid: '2026-12-01' } } }, PERM_TYPES, '2026-11-17'), 'soon');
  assert.ok(isNewPermDefs(PERM_TYPES)); assert.ok(!isNewPermDefs([{ key: 'pJ', name: 'Badania ważne do' }]));
  // arkusz: nagłówki w wierszu 3, osoba PO + nr ew.
  const rows = [[], [], ['lp.', '', 'Nazwisko i Imię', 'ewid. ZKS', 'Badania ważne do', 'Data szkolenia BHP', 'Suwnica Nr uprawnień', 'Suwnica data wyd/waż', 'ur'],
    [1, 'po', 'Testowy Jan', 12007, 'waż. 15/07/2027', 'wyd. 18/10/2021', 'O/9/1', { v: Date.parse('2012-05-23T00:00:00Z'), style: { date: true } }, { v: Date.parse('1980-01-01T00:00:00Z'), style: { date: true } }]];
  const ws = (await readXlsx(buildXlsx({ name: 'MK', rows })))[0];
  const r = parsePermsSheet(ws, '2026-11-17');
  assert.deepEqual(r.people.PO12007.perms, { bad: { valid: '2027-07-15' }, bhp: { issued: '2021-10-18' }, suw: { nr: 'O/9/1', issued: '2012-05-23' } });
});
