import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeSchedule, buildCapacity } from '../src/renderer/js/logic/schedule.js';
import { reorderIds, reorderPlan, capacityFrom, idError, renamePlan, lpCompare, isSyntheticId, isSubId, arrangeRows, blockedPredecessors, predError, predecessorChoices, validateNewOps, statKey, chunkId, parseGrafik, daysByKeyOf, buildHarmData, fmtDt, withKomisRows, isKomisId } from '../src/renderer/js/logic/harmModel.js';
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
  assert.deepEqual([...blockedPredecessors(ops, '2')].sort(), ['2', '3']);
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
  assert.match(validateNewOps([{ lp: 'a b', komis: 'x' }], {}, pd, pn).errors[0], /liczba/);
  assert.match(validateNewOps([{ lp: '5', komis: 'x', hours: 'zz' }], {}, pd, pn).errors[0], /czas/);
  assert.match(validateNewOps([{ lp: '5', komis: 'x', dostawa: 'jutro' }], {}, pd, pn).errors[0], /daty/);
  assert.match(validateNewOps([{ lp: '5' }], {}, pd, pn).errors[0], /przynajmniej jedną/);
});

test('numery: operacja główna = liczba, suboperacja = liczba + litera; kolejność, dokumenty, zmiana numeru', () => {
  const ops = { 3000: { preds: [] }, '3000a': {}, '3000b': {}, 3001: { preds: ['3000'] } };
  assert.equal(idError('3002', ops), null); assert.equal(idError('3000c', ops), null); assert.equal(idError('3000ab', ops), null);
  assert.match(idError('', ops), /pusty/); assert.match(idError('A12', ops), /liczba/); assert.match(idError('3000 a', ops), /liczba/); assert.match(idError('30.5', ops), /liczba/);
  assert.match(idError('s12', ops), /zarezerwowane/); assert.match(idError('3000a', ops), /już istnieje/);
  assert.match(idError('4000a', ops), /wymaga istniejącej operacji głównej 4000/);
  assert.equal(idError('4000a', ops, { pending: new Set(['4000']) }), null);
  assert.equal(idError('3000a', ops, { ignore: '3000a' }), null);
  assert.deepEqual(['3001', '3000b', '9', '3000', 's5', '3000a', '10'].sort(lpCompare), ['9', '10', '3000', '3000a', '3000b', '3001', 's5']);
  assert.equal(isSyntheticId('s40'), true); assert.equal(isSubId('3000a'), true); assert.equal(isSubId('3000'), false);
  assert.equal(chunkId('3000a'), chunkId('3000')); assert.equal(chunkId('49'), 'c0000'); assert.match(chunkId('A12'), /^x\d\d$/);
  // zmiana numeru operacji głównej przenosi suboperacje i poprawia powiązania
  const plan = renamePlan(ops, '3000', '3005');
  assert.deepEqual(plan.moves.map((m) => [m.oldId, m.newId]).sort(), [['3000', '3005'], ['3000a', '3005a'], ['3000b', '3005b']]);
  assert.deepEqual(plan.referrers, [['3001', ['3005']]]);
  assert.match(renamePlan(ops, '3000', '3001').error, /już istnieje/); assert.match(renamePlan(ops, '3000', '3000a').error, /już istnieje|główna/);
  assert.match(renamePlan(ops, '3000', '5000a').error, /wymaga istniejącej operacji głównej 5000/);
  assert.equal(renamePlan(ops, '3000', '3000').same, true); assert.match(renamePlan(ops, '99', '100').error, /nie istnieje/);
  const rp = renamePlan(ops, '3000a', '3000c'); assert.equal(rp.moves.length, 1); assert.equal(rp.newId, '3000c');
  // dodawanie: suboperacja razem z operacją główną w jednej tabeli, bez operacji głównej – błąd
  const pd = () => null, pn = (t) => Number(t);
  assert.equal(validateNewOps([{ lp: '70a', komis: 'k' }, { lp: '70', komis: 'k' }], {}, pd, pn).errors.length, 0);
  assert.match(validateNewOps([{ lp: '71a', komis: 'k' }], {}, pd, pn).errors[0], /wymaga istniejącej operacji głównej/);
});

test('suboperacje: czas operacji głównej = suma, po kolei od startu, czekają na swoje poprzedniki, przerwa w operacji głównej', () => {
  const c = {}; for (const st of ['1Si', '2Un']) { c[st] = buildCapacity(Array.from({ length: 40 }, (_, i) => ({ date: Date.UTC(2026, 10, 2) + i * 86400000, hours: 16 }))); }
  const D = (d, h) => Date.UTC(2026, 10, d, h);
  const ops = [
    { lp: '10', startManual: D(2, 6), station: '1Si' },                                   // bez czasu → trwa do końca ostatniej suboperacji
    { lp: '10a', hours: 8, station: '1Si' },                                              // 6:00–14:00
    { lp: '10b', hours: 4, station: '2Un' },                                              // po 10a: 14:00–18:00
    { lp: '11', preds: ['10b'], hours: 2, station: '1Si' },                               // zależność od suboperacji: start = koniec 10b
    { lp: '12', startManual: D(2, 6), hours: 5, station: '1Si' }, { lp: '12a', hours: 3, station: '1Si' },   // własny czas operacji głównej ma pierwszeństwo
    { lp: '13', startManual: D(2, 6), hours: 2, station: '1Si' },                          // 6–8
    { lp: '14', startManual: D(2, 6), station: '1Si' }, { lp: '14a', hours: 3, station: '1Si' }, { lp: '14b', hours: 2, station: '1Si', preds: ['13'] },   // 14a 6–9, 14b czeka na 13 (8) i 14a (9)
    { lp: '15', startManual: D(2, 6), station: '1Si' }, { lp: '15a', hours: 1, station: '1Si' }, { lp: '15b', hours: 1, station: '1Si', preds: ['16'] },
    { lp: '16', startManual: D(2, 12), hours: 1, station: '1Si' },                         // 12–13: 15b zaczyna dopiero o 13 → przerwa w 15
  ];
  const r = computeSchedule(ops, c);
  assert.equal(r.get('10').start, D(2, 6)); assert.equal(r.get('10').end, D(2, 18));       // czas = 8 + 4, koniec = koniec ostatniej suboperacji
  assert.equal(r.get('10a').end, D(2, 14)); assert.equal(r.get('10b').start, D(2, 14)); assert.equal(r.get('10b').end, D(2, 18));
  assert.equal(r.get('11').start, D(2, 18));
  assert.equal(r.get('12').end, D(2, 11));                                                 // 5 h, nie 3
  assert.equal(r.get('14b').start, D(2, 9)); assert.equal(r.get('14').end, D(2, 11));
  assert.equal(r.get('15a').end, D(2, 7)); assert.equal(r.get('15b').start, D(2, 13)); assert.equal(r.get('15').end, D(2, 14));   // przerwa 7–13
});

test('suboperacje: dozwolone powiązania między różnymi operacjami, błąd dla własnej matki i własnych suboperacji', () => {
  const ops = { 3000: { preds: [] }, '3000a': { hours: 2 }, 3001: { preds: [] }, '3001a': { hours: 1 } };
  assert.equal(predError(ops, '3000', 0, '3001a'), null);                       // 3000 | 3001a – ok
  assert.equal(predError(ops, '3000a', 0, '3001'), null);                       // 3000a | 3001 – ok
  assert.equal(predError(ops, '3000a', 0, '3001a'), null);                      // suboperacja zależna od suboperacji innej operacji
  assert.match(predError(ops, '3000', 0, '3000a'), /suboperacją tej operacji/);  // 3000 | 3000a – błąd
  assert.match(predError(ops, '3000a', 0, '3000'), /operacją główną tej suboperacji/);   // 3000a | 3000 – błąd
  assert.deepEqual(predecessorChoices(ops, '3000', 0), ['3001', '3001a']);
  assert.deepEqual(predecessorChoices(ops, '3000a', 0), ['3001', '3001a']);
  // cykl przez operację główną: 3001 zależy od 3000 (czyli od końca 3000a), więc 3000a nie może zależeć od 3001
  const o2 = { ...ops, 3001: { preds: ['3000'] } };
  assert.match(predError(o2, '3000a', 0, '3001'), /cykl/); assert.match(predError(o2, '3000a', 0, '3001a'), /cykl/);
  assert.equal(predError(o2, '3001a', 0, '3000a'), null);
  assert.match(predError(o2, '3000', 0, '3001a'), /cykl/);                      // 3001a (sub 3001, start = start 3001 po końcu 3000)
  // silnik zgłasza cykl
  const cap = { '1Si': buildCapacity(Array.from({ length: 5 }, (_, i) => ({ date: Date.UTC(2026, 10, 2) + i * 86400000, hours: 16 }))) };
  const res = computeSchedule([{ lp: '3000', startManual: Date.UTC(2026, 10, 2, 6), station: '1Si' }, { lp: '3000a', hours: 2, station: '1Si', preds: ['3001'] }, { lp: '3001', preds: ['3000'], hours: 1, station: '1Si' }], cap);
  assert.equal(res.get('3000a').state, 'cycle'); assert.equal(res.get('3001').state, 'cycle');
});

test('suboperacje mieszają się z innymi operacjami według chronologii (stanowisko, start)', () => {
  const t0 = Date.UTC(2026, 10, 2, 6);
  const ops = {
    10: { station: '1Si', startManual: t0, hours: 2 },                            // 6:00–8:00
    '10a': { hours: 5 }, '10b': { hours: 5 },                                      // dziedziczą 1Si; a: 6–11, b: 11–16
    20: { station: '1Si', startManual: t0 + 3 * 3600000, hours: 1 },               // 9:00 – wypada między 10a i 10b
  };
  const cap = {}; const days = {}; for (let i = 0; i < 5; i++) { const k = `2026-11-${String(2 + i).padStart(2, '0')}`; days[k] = { '1Si1': 'a8', '1Si2': 'b8' }; }
  const d = buildHarmData(ops, days, null, t0);
  assert.deepEqual(d.rows.map((r) => r.id), ['10', '10a', '20', '10b']);
  assert.deepEqual(arrangeRows(d.rows, new Set(['10'])).map((r) => r.id), ['10', '20']);
});

test('operacja główna bez zależności dziedziczy start po pierwszej suboperacji (tylko po pierwszej)', () => {
  const D = (d, h) => Date.UTC(2026, 10, d, h);
  const cap = { '1Si': buildCapacity(Array.from({ length: 10 }, (_, i) => ({ date: Date.UTC(2026, 10, 2) + i * 86400000, hours: 16 }))) };
  const ops = [
    { lp: '5', startManual: D(3, 6), hours: 4, station: '1Si' },                                       // 6–10 (3.11)
    { lp: '10', station: '1Si' },                                                                      // bez zależności i bez startu
    { lp: '10a', hours: 2, station: '1Si', preds: ['5'] },                                             // pierwsza suboperacja zależy od 5 → operacja 10 dziedziczy
    { lp: '10b', hours: 2, station: '1Si', preds: ['6'] }, { lp: '6', startManual: D(4, 6), hours: 4, station: '1Si' },   // zależność drugiej suboperacji NIE jest dziedziczona
    { lp: '20', station: '1Si' }, { lp: '20a', hours: 1, station: '1Si' },                              // pierwsza bez zależności → brak startu
    { lp: '30', startManual: D(8, 6), station: '1Si' }, { lp: '30a', hours: 1, station: '1Si', preds: ['5'] },   // własny start ma pierwszeństwo
  ];
  const r = computeSchedule(ops, cap);
  assert.equal(r.get('10a').start, D(3, 10)); assert.equal(r.get('10').start, D(3, 10));            // start 10 = start 10a (koniec 5)
  assert.equal(r.get('10b').start, D(4, 10));                                                          // czeka na 6 (koniec 4.11 10:00)
  assert.equal(r.get('10').end, D(4, 12));
  assert.equal(r.get('20').state, 'no-start');
  assert.equal(r.get('30').start, D(8, 6)); assert.equal(r.get('30a').start, D(8, 6));                 // 30a: max(start 30, koniec 5)
  // wykrywanie cyklu uwzględnia dziedziczenie: operacja 10 zależy teraz od końca 5, więc 5 nie może zależeć od 10
  const m = { 5: { preds: [] }, 10: { preds: [] }, '10a': { preds: ['5'], hours: 2 } };
  assert.match(predError(m, '5', 0, '10'), /cykl/);
});

test('zmiana numeru: operacja główna → suboperacja istniejącej operacji i suboperacja → wolny numer operacji', () => {
  const ops = { 800: { preds: [] }, 805: { preds: ['700'], hours: 3 }, 700: { preds: [] }, 810: { preds: ['805'] }, 900: { preds: [] }, '900a': { hours: 1 }, 760: { preds: [] } };
  // 805 → 800a: operacja 800 istnieje; powiązania innych operacji idą za nowym numerem
  const p = renamePlan(ops, '805', '800a');
  assert.equal(p.error, null); assert.deepEqual(p.moves.map((m) => [m.oldId, m.newId]), [['805', '800a']]); assert.deepEqual(p.referrers, [['810', ['800a']]]);
  assert.deepEqual(p.moves[0].op.preds, ['700']);
  assert.match(renamePlan(ops, '805', '850a').error, /wymaga istniejącej operacji głównej 850/);       // nie ma operacji 850
  assert.match(renamePlan(ops, '800', '800a').error, /wymaga istniejącej operacji głównej 800/);       // 800 nie może zostać własną suboperacją
  const r9 = renamePlan(ops, '900', '800a');                                                          // operacja z suboperacjami → suboperacja: jej suboperacje stają się subsuboperacjami
  assert.equal(r9.error, null); assert.deepEqual(r9.moves.map((m) => [m.oldId, m.newId]), [['900', '800a'], ['900a', '800aa']]);
  // powiązanie z przyszłą operacją główną blokuje zmianę (cykl)
  assert.match(renamePlan({ ...ops, 805: { preds: ['800'] } }, '805', '800a').error, /byłby jej rodzicem/);
  assert.match(renamePlan({ ...ops, 800: { preds: ['805'] } }, '805', '800a').error, /cykl/);         // 800 zależałaby od własnej suboperacji
  // suboperacja → operacja: tylko na wolny numer
  const q = renamePlan(ops, '900a', '761');
  assert.equal(q.error, null); assert.equal(q.newId, '761');
  assert.match(renamePlan(ops, '900a', '760').error, /już istnieje/);
});

test('trzy poziomy: operacja › suboperacja (detal) › subsuboperacja, kolorowy pasek, zwijanie, ukrywanie operacji głównych', () => {
  const D = (d, h) => Date.UTC(2026, 10, d, h);
  const days = {}; for (let i = 0; i < 10; i++) days[`2026-11-${String(2 + i).padStart(2, '0')}`] = { '1Si1': 'a8', '1Si2': 'b8', '2Un1': 'a8', '2Un2': 'b8', '3Co1': 'a8', '3Co2': 'b8' };
  const ops = {
    100: { startManual: D(2, 6), komis: 'Z1', element: 'Zespół' },                       // bez stanowiska i bez czasu: przechodzi przez różne stanowiska
    '100a': { element: 'Detal A' }, '100aa': { hours: 4, station: '1Si' }, '100ab': { hours: 2, station: '2Un' },
    '100b': { element: 'Detal B' }, '100ba': { hours: 3, station: '3Co', preds: ['200'] },
    200: { startManual: D(2, 16), hours: 2, station: '1Si' },                                 // 16–18: 100ba czeka na nią → przerwa
  };
  const r = computeSchedule(Object.entries(ops).map(([lp, o]) => ({ lp, ...o })), capacityFrom(days, ['1Si', '2Un', '3Co']));
  assert.equal(r.get('100a').start, D(2, 6)); assert.equal(r.get('100aa').start, D(2, 6)); assert.equal(r.get('100aa').end, D(2, 10));
  assert.equal(r.get('100ab').start, D(2, 10)); assert.equal(r.get('100ab').end, D(2, 12)); assert.equal(r.get('100a').end, D(2, 12));
  assert.equal(r.get('100b').start, D(2, 12)); assert.equal(r.get('100ba').start, D(2, 18)); assert.equal(r.get('100ba').end, D(2, 21));
  assert.equal(r.get('100').end, D(2, 21));
  const d = buildHarmData(ops, days, null, D(2, 6));
  const row = (id) => d.rows.find((x) => x.id === id);
  assert.equal(row('100').hoursShown, 'Σ9'); assert.equal(row('100a').hoursShown, 'Σ6'); assert.equal(row('100').station, '');
  assert.equal(row('100aa').depth, 2); assert.equal(row('100aa').parent, '100a'); assert.equal(row('100aa').komis, 'Z1');
  // pasek operacji: odcinki wszystkich subsuboperacji w kolorach ich stanowisk
  assert.deepEqual(row('100').segs.map((x) => x[2]), ['#0070c0', '#00b0f0', '#ffc000']);
  assert.deepEqual(row('100a').segs.map((x) => [x[0], x[1]]), [[D(2, 6), D(2, 10)], [D(2, 10), D(2, 12)]]);
  // zwijanie operacji chowa wszystkie poziomy; zwinięcie suboperacji chowa tylko jej subsuboperacje
  assert.deepEqual(arrangeRows(d.rows, new Set(['100'])).map((x) => x.id).sort(), ['100', '200']);
  assert.deepEqual(arrangeRows(d.rows, new Set(['100a'])).map((x) => x.id).sort(), ['100', '100a', '100b', '100ba', '200']);
  assert.deepEqual([row('100').level, row('100a').level, row('100aa').level, row('100b').level, row('200').level], [3, 2, 1, 2, 1]);
  assert.deepEqual(arrangeRows(d.rows, new Set(), new Set([3])).map((x) => x.id).sort(), ['100a', '100aa', '100ab', '100b', '100ba', '200']);   // ukryty poziom III
  assert.deepEqual(arrangeRows(d.rows, new Set(), new Set([2, 3])).map((x) => x.id).sort(), ['100aa', '100ab', '100ba', '200']);             // widać tylko poziom I
  assert.deepEqual(arrangeRows(d.rows, new Set(), new Set([1])).map((x) => x.id).sort(), ['100', '100a', '100b']);                          // same poziomy zbiorcze
  // numery i powiązania
  assert.equal(idError('100ac', ops), null); assert.match(idError('100ca', ops), /wymaga istniejącej suboperacji 100c/); assert.match(idError('100aaa', ops), /dwie litery/);
  assert.match(predError(ops, '100aa', 0, '100'), /operacją główną/); assert.match(predError(ops, '100aa', 0, '100a'), /cykl/); assert.match(predError(ops, '100', 0, '100ab'), /subsuboperacją/);
  assert.equal(predError(ops, '200', 0, '100ab'), null);
  const mv = renamePlan(ops, '100a', '300');                                                         // detal staje się operacją, jego subsuboperacje suboperacjami
  assert.equal(mv.error, null); assert.deepEqual(mv.moves.map((m) => [m.oldId, m.newId]), [['100a', '300'], ['100aa', '300a'], ['100ab', '300b']]);
  assert.match(renamePlan(ops, '100', '200a').error, /trzy poziomy/);                                  // 100aa → 200aaa
});

test('zmiana kolejności suboperacji (przeciągnij i upuść): litery zostają w grupie, dzieci idą za rodzicem, powiązania i cykle', () => {
  const ops = {
    100: {}, '100a': { element: 'A' }, '100aa': { hours: 1 }, '100ab': { hours: 2 }, '100b': { element: 'B' }, '100ba': { hours: 3 }, '100c': { hours: 4 },
    500: { preds: ['100b'] }, 600: { preds: ['100ab'] },
  };
  // zamiana 100a ↔ 100b: dzieci idą razem z rodzicami
  const m = reorderIds(ops, '100', { 100: ['100b', '100a', '100c'] });
  assert.deepEqual(Object.fromEntries(m), { '100b': '100a', '100ba': '100aa', '100a': '100b', '100aa': '100ba', '100ab': '100bb' });
  const p = reorderPlan(ops, '100', { 100: ['100b', '100a', '100c'] });
  assert.equal(p.error, null);
  assert.deepEqual(p.referrers.sort(), [['500', ['100a']], ['600', ['100bb']]]);           // powiązania z zewnątrz idą za operacjami
  assert.equal(new Set(p.moves.map((x) => x.newId)).size, p.moves.length);
  // zmiana kolejności subsuboperacji w jednej suboperacji
  assert.deepEqual(Object.fromEntries(reorderIds(ops, '100a', { '100a': ['100ab', '100aa'] })), { '100ab': '100aa', '100aa': '100ab' });
  // bez zmian
  assert.equal(reorderPlan(ops, '100', { 100: ['100a', '100b', '100c'] }).same, true);
  // przenoszenie między operacjami jest niedozwolone
  assert.match(reorderPlan(ops, '100', { 100: ['100a', '100b', '100c', '500'] }).error, /niedozwolone/);
  assert.match(reorderPlan(ops, '100', { '100a': ['100aa', '100ba'] }).error, /niedozwolone/);
  // cykl: 100b zależy od 100a; po zamianie 100a ↔ 100b pierwsze dziecko czekałoby na swoje następne rodzeństwo
  const c = { 100: { startManual: 0 }, '100a': { hours: 1 }, '100b': { hours: 1, preds: ['100a'] } };
  assert.match(reorderPlan(c, '100', { 100: ['100b', '100a'] }).error, /cykl/);
});

test('poziom IV: pasek komisu – podsumowanie z operacji komisu, nie zmienia harmonogramu', () => {
  const D = (d, h) => Date.UTC(2026, 10, d, h);
  const days = {}; for (let i = 0; i < 10; i++) days[`2026-11-${String(2 + i).padStart(2, '0')}`] = { '1Si1': 'a8', '1Si2': 'b8', '2Un1': 'a8', '2Un2': 'b8', '3Co1': 'a8', '3Co2': 'b8' };
  const ops = {
    100: { startManual: D(2, 6), komis: 'Z1', element: 'Zespół', client: 'ACME', wysylka: D(3, 12) },
    '100a': { hours: 4, station: '1Si', status: 'zak.' }, '100b': { hours: 2, station: '2Un', wysylka: D(5, 12), dostawa: D(1, 8) },
    200: { startManual: D(2, 16), hours: 2, station: '1Si', komis: '300' },     // komis „300” nie myli się z operacją 300
    300: { startManual: D(4, 6), hours: 3, station: '3Co', komis: 'Z1', preds: [] },
    400: { startManual: D(2, 6), hours: 1, station: '3Co' },                     // bez komisu: bez paska komisu
  };
  const without = buildHarmData(Object.fromEntries(Object.entries(ops).map(([k, o]) => [k, { ...o, komis: '' }])), days, null, D(2, 6));
  const d = buildHarmData(ops, days, null, D(2, 6));
  for (const r of without.rows) assert.equal(d.rows.find((x) => x.id === r.id).koniec, r.koniec);   // komisy nie zmieniają terminów
  assert.equal(d.rows.length, 6);                                                                       // paski komisów nie są wierszami danych
  const k = d.komisRows.get('Z1');
  assert.equal(k.id, 'K:Z1'); assert.ok(isKomisId(k.id)); assert.equal(k.level, 4); assert.equal(k.lp, '');
  assert.equal(k.opCount, 4); assert.equal(k.leafCount, 3); assert.equal(k.zakCount, 1); assert.equal(k.status, '1/3');
  assert.equal(k.hoursShown, 'Σ9'); assert.equal(k.client, 'ACME');
  assert.equal(k.ms.start, D(2, 6)); assert.equal(k.ms.koniec, D(4, 9)); assert.equal(k.ms.wysylka, D(3, 12)); assert.equal(k.ms.dostawa, D(1, 8));
  assert.equal(k.late, true);
  assert.deepEqual(k.segs.map((x) => x[2]), ['#93c47d', '#00b0f0', '#ffc000']);                         // zakończona operacja na zielono
  assert.equal(d.komisRows.get('300').opCount, 1); assert.equal(d.komisRows.size, 2);
  // wstawianie: pasek komisu nad pierwszą operacją komisu; zwinięcie chowa operacje komisu; ukryty poziom IV chowa tylko paski
  const rows = arrangeRows(d.rows, new Set(), new Set());
  const ins = withKomisRows(rows, d.komisRows, new Set(), new Set());
  assert.equal(ins.length, rows.length + 2);
  const iK = ins.findIndex((r) => r.id === 'K:Z1');
  assert.ok(iK < ins.findIndex((r) => r.id === '100') && iK < ins.findIndex((r) => r.id === '300'));
  const col = withKomisRows(rows, d.komisRows, new Set(['K:Z1']), new Set());
  assert.deepEqual(col.filter((r) => String(r.komis) === 'Z1').map((r) => r.id), ['K:Z1']);
  const hid = withKomisRows(rows, d.komisRows, new Set(['K:Z1']), new Set([4]));
  assert.equal(hid.length, rows.length);
});
