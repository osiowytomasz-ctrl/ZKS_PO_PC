import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { idError, renamePlan, lpCompare, isSyntheticId, predError, predecessorChoices, validateNewOps, dependents, statKey, chunkId, parseGrafik, daysByKeyOf, buildHarmData, fmtDt } from '../src/renderer/js/logic/harmModel.js';
import { sortRows, filterOptions } from '../src/renderer/js/logic/tableFilter.js';
import { importOperations, opsFromSheetRows, parseDelimited } from '../src/renderer/js/logic/harmImport.js';

// tekst graf_norm (arkusz) → kształt odpowiedzi API getGrafNorm: kolumny od H w prawo
const grafApi = (text) => { const rows = parseDelimited(text).filter((r) => r.length > 8); return { stations: rows[0].slice(1, 7), header: rows[0].slice(7), rows: rows.slice(1).map((r) => r.slice(7)).filter((r) => r[0]) }; };

test('chunkId: operacje po 50 numerów, nienumeryczne do cx', () => {
  assert.equal(chunkId('0'), 'c0000'); assert.equal(chunkId('49'), 'c0000'); assert.equal(chunkId('50'), 'c0001'); assert.equal(chunkId('2000'), 'c0040'); assert.match(chunkId('A1'), /^x\d\d$/);
});

test('grafik z API → dni; harmonogram liczy koniec z kodów', () => {
  const g = { stations: ['1Si'], header: ['', '1Si1', '1Si2'], rows: [['02-11-2026', 'a8', 'b8'], ['03-11-2026', 'a8', 'b8'], ['04-11-2026', 'a8', '']] };
  const p = parseGrafik(g);
  assert.equal(p.days.length, 3);
  assert.deepEqual(p.days[2].slots, { '1Si1': 'a8' });
  const ops = { 1: { preds: [], station: '1Si', hours: 8, startManual: Date.UTC(2026, 10, 2, 6), komis: 'K1', element: 'E1' } };
  const d = buildHarmData(ops, daysByKeyOf(p), null, Date.UTC(2026, 10, 2));
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].start, '02.11.2026 06:00');
  assert.equal(d.rows[0].koniec, '02.11.2026 14:00');
  assert.equal(fmtDt(null), '');
});

test('opsFromSheetRows: bierze dane ręczne, pomija wyliczane', () => {
  const rows = [
    { lp: '1', z1: '', z2: '', z3: '', z4: '', client: 'KL', komis: 'K1', element: 'E1', stanowisko: '1Si', start: '01.11.2026 06:00', startManual: '02.11.2026 06:00', godziny: '8,5', endManual: '', koniec: '03.11.2026 06:00', wysylka: '10.11.2026', dostawa: '', zak: '', stanowiskoBg: '#ff0000', stanowiskoColor: '#000000' },
    { lp: '2', z1: '1', z2: '9', komis: 'K1', element: 'E2', stanowisko: '2Un', godziny: '4', endManual: '05.11.2026 12:00', zak: 'zak.' },
    { lp: '2', komis: 'K', element: 'dubel', stanowisko: '2Un' },
    { lp: '', rowIndex: 40, komis: 'K9', element: 'zakończona bez numeru', stanowisko: '3Co', godziny: '46', endManual: '12.05.2026 14:00' },
  ];
  const r = opsFromSheetRows(rows);
  assert.equal(r.operations.length, 3);
  assert.equal(r.operations[2].lp, 's40'); assert.equal(chunkId('s40'), 's0000'); assert.equal(chunkId('s125'), 's0002');
  const o1 = r.operations[0];
  assert.equal(o1.hours, 8.5); assert.equal(o1.startManual, Date.UTC(2026, 10, 2, 6)); assert.equal(o1.client, 'KL'); assert.equal(o1.wysylka, Date.UTC(2026, 10, 10));
  assert.ok(!('start' in o1) && !('koniec' in o1));
  assert.deepEqual(r.operations[1].preds, ['1', '9']); assert.equal(r.operations[1].endManual, Date.UTC(2026, 10, 5, 12)); assert.equal(r.operations[1].status, 'zak.'); assert.equal(r.operations[0].status, '');
  assert.ok(!JSON.stringify(r.operations).match(/#ff0000|color|Bg/i));   // żadnych kolorów
  assert.ok(r.warnings.some((w) => w.includes('powtórzony')) && r.warnings.some((w) => w.includes('poprzednik 9')));
});

const GRAF = new URL('./fixtures/graf-norm.txt', import.meta.url).pathname;
const EXPORT = new URL('./fixtures/harm-export.txt', import.meta.url).pathname;
const SAMPLE = new URL('./fixtures/harm-sample.json', import.meta.url).pathname;
test('prawdziwe dane: model buduje wiersze zgodne z arkuszem', { skip: !(fs.existsSync(GRAF) && fs.existsSync(EXPORT) && fs.existsSync(SAMPLE)) && 'brak danych' }, () => {
  const daysByKey = daysByKeyOf(parseGrafik(grafApi(fs.readFileSync(GRAF, 'utf8'))));
  const imp = importOperations(fs.readFileSync(EXPORT, 'utf8'));
  const opsByLp = {}; for (const { lp, ...o } of imp.operations) if (!(lp in opsByLp)) opsByLp[lp] = o;
  const data = buildHarmData(opsByLp, daysByKey, null, Date.UTC(2026, 10, 10));
  const want = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const byLp = new Map(data.rows.map((r) => [r.lp, r]));
  const bad = want.filter((w) => { const r = byLp.get(w.lp); return !r || r.start !== (w.startCalc || '').slice(0, 16) || r.koniec !== (w.endCalc || '').slice(0, 16); }).map((w) => w.lp);
  assert.deepEqual(bad.slice(0, 5), []);
});

test('klucz „Stat.” (kolumna S): zakończone, stanowisko + numer startu, 0ZZ', () => {
  const day = Date.UTC(2026, 10, 14, 14);           // 46340,5833333333
  const mk = (o, start) => buildHarmData({ 1: { preds: [], hours: 8, ...o } }, {}, null, Date.UTC(2026, 10, 10)).rows[0].key;
  assert.equal(mk({ station: '2Un', element: 'x', status: 'zak.' }), '00Zak');
  assert.equal(mk({ station: '2Un', element: 'x', startManual: day }), '2Un46340,5833333333');
  assert.equal(mk({ station: '2Un', element: 'x', startManual: Date.UTC(2029, 0, 1) }), '0ZZ');           // poza horyzontem 417 dni
  assert.equal(mk({ station: '2Un', element: '' }), '0ZZZ');                                              // brak startu i opisu
  assert.equal(mk({ station: '', element: 'x', startManual: day }), '0ZZ');
});

test('sortowanie i lista wartości kolumn z datami: rok, miesiąc, dzień, godzina (także zapis „dd.mm.rrrr hh”)', () => {
  const cols = [{ key: 'd', isDate: true }];
  const rows = ['15.04.2027 00', '30.10.2026 06', '29.06.2027 00', '', '08.11.2026 14', '08.11.2026 06', '02.01.2027 00'].map((d) => ({ d }));
  const get = (r, c) => r[c.key];
  assert.deepEqual(sortRows(rows, cols, [{ key: 'd', ascending: true }], get).map((r) => r.d), ['30.10.2026 06', '08.11.2026 06', '08.11.2026 14', '02.01.2027 00', '15.04.2027 00', '29.06.2027 00', '']);
  assert.deepEqual(sortRows(rows, cols, [{ key: 'd', ascending: false }], get).map((r) => r.d).slice(0, 2), ['29.06.2027 00', '15.04.2027 00']);
  assert.equal(filterOptions(rows, cols, {}, get, cols[0]).map((o) => o.value)[0], '30.10.2026 06');
});

test('poprzednicy: lista tylko bezpiecznych powiązań (bez cyklu, samej siebie, powtórzeń)', () => {
  // 1 → 2 → 3 (3 zależy od 2, 2 zależy od 1); 4 niezależna
  const ops = { 1: { preds: [] }, 2: { preds: ['1'] }, 3: { preds: ['2'] }, 4: { preds: [] }, 5: { preds: ['4', '1'] } };
  assert.deepEqual([...dependents(ops, '2')].sort(), ['2', '3']);
  assert.deepEqual(predecessorChoices(ops, '2', 0), ['1', '4', '5']);          // nie 2 (ona sama) ani 3 (zależy od 2)
  assert.deepEqual(predecessorChoices(ops, '1', 0), ['4']);                    // 2, 3 i 5 zależą od 1, więc odpada
  assert.match(predError(ops, '1', 0, '3'), /cykl/);
  assert.match(predError(ops, '5', 0, '1'), /już wpisana/);                      // 1 jest w pozycji 2 → nie można w pozycji 1
  assert.equal(predError(ops, '5', 1, '1'), null);                              // ta sama pozycja: podmiana na siebie jest dozwolona
  assert.match(predError(ops, '1', 0, '1'), /swoim poprzednikiem/);
  assert.match(predError(ops, '1', 0, '99'), /nie istnieje/);
  assert.equal(predError(ops, '1', 0, ''), null);
});

test('nowe operacje: tabela, puste wiersze pomijane, duplikaty numerów zablokowane', () => {
  const pd = (t) => (t === '14.11.2026 14:00' ? 1 : null), pn = (t) => (/^\d+$/.test(t) ? Number(t) : null);
  const rows = [
    { lp: '10', komis: 'K1', element: 'A', station: '1Si', hours: '8', wysylka: '14.11.2026 14:00' },
    { lp: '11' },                                                  // pusty → pominięty
    { lp: '12', komis: 'K2', hours: '5' },
  ];
  const ok = validateNewOps(rows, { 1: {} }, pd, pn);
  assert.deepEqual(ok.errors, []); assert.equal(ok.ops.length, 2); assert.equal(ok.ops[0][1].wysylka, 1);
  assert.match(validateNewOps([{ lp: '1', komis: 'x' }], { 1: {} }, pd, pn).errors[0], /już istnieje/);                 // duplikat z bazą
  assert.match(validateNewOps([{ lp: '5', komis: 'x' }, { lp: '5', komis: 'y' }], {}, pd, pn).errors[0], /powtórzony/); // duplikat w tabeli
  assert.match(validateNewOps([{ lp: 'a b', komis: 'x' }], {}, pd, pn).errors[0], /litery/);
  assert.match(validateNewOps([{ lp: '5', komis: 'x', hours: 'zz' }], {}, pd, pn).errors[0], /czas/);
  assert.match(validateNewOps([{ lp: '5', komis: 'x', dostawa: 'jutro' }], {}, pd, pn).errors[0], /daty/);
  assert.match(validateNewOps([{ lp: '5' }], {}, pd, pn).errors[0], /przynajmniej jedną/);
});

test('numery operacji z literami: format, kolejność, dokumenty, zmiana numeru z poprawą powiązań', () => {
  assert.equal(idError('A12', {}), null); assert.equal(idError('Śl-3', {}), null); assert.equal(idError('12', {}), null);
  assert.match(idError('', {}), /pusty/); assert.match(idError('a b', {}), /litery, cyfry/); assert.match(idError('a.b', {}), /litery, cyfry/);
  assert.match(idError('s12', {}), /zarezerwowane/); assert.match(idError('A1', { A1: {} }), /już istnieje/);
  assert.equal(idError('A1', { A1: {} }, { ignore: 'A1' }), null);
  assert.deepEqual(['b2', '10', 'a10', '9', 's5', 'a9', 'A1'].sort(lpCompare), ['9', '10', 'A1', 'a9', 'a10', 'b2', 's5']);
  assert.equal(isSyntheticId('s40'), true); assert.equal(isSyntheticId('S40'), false);
  assert.match(chunkId('A12'), /^x\d\d$/); assert.equal(chunkId('A12'), chunkId('A12')); assert.equal(chunkId('49'), 'c0000');
  const ops = { 1: { preds: [], element: 'a' }, 2: { preds: ['1'] }, 3: { preds: ['2', '1'] }, X: { preds: [] } };
  const plan = renamePlan(ops, '1', 'A-1');
  assert.equal(plan.newId, 'A-1'); assert.deepEqual(plan.referrers.sort(), [['2', ['A-1']], ['3', ['2', 'A-1']]]);
  assert.match(renamePlan(ops, '1', '2').error, /już istnieje/); assert.match(renamePlan(ops, '1', 'x y').error, /litery/);
  assert.equal(renamePlan(ops, '1', '1').same, true); assert.match(renamePlan(ops, '99', 'Q').error, /nie istnieje/);
  // letters w dodawaniu operacji i w poprzednikach
  const pd = () => null, pn = (t) => Number(t);
  assert.equal(validateNewOps([{ lp: 'A7', komis: 'k' }], {}, pd, pn).ops[0][0], 'A7');
  assert.match(validateNewOps([{ lp: 'a b', komis: 'k' }], {}, pd, pn).errors[0], /litery/);
});
