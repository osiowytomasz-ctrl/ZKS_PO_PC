import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { statKey, chunkId, parseGrafik, daysByKeyOf, buildHarmData, fmtDt } from '../src/renderer/js/logic/harmModel.js';
import { sortRows, filterOptions } from '../src/renderer/js/logic/tableFilter.js';
import { importOperations, opsFromSheetRows, parseDelimited } from '../src/renderer/js/logic/harmImport.js';

// tekst graf_norm (arkusz) → kształt odpowiedzi API getGrafNorm: kolumny od H w prawo
const grafApi = (text) => { const rows = parseDelimited(text).filter((r) => r.length > 8); return { stations: rows[0].slice(1, 7), header: rows[0].slice(7), rows: rows.slice(1).map((r) => r.slice(7)).filter((r) => r[0]) }; };

test('chunkId: operacje po 50 numerów, nienumeryczne do cx', () => {
  assert.equal(chunkId('0'), 'c0000'); assert.equal(chunkId('49'), 'c0000'); assert.equal(chunkId('50'), 'c0001'); assert.equal(chunkId('2000'), 'c0040'); assert.equal(chunkId('A1'), 'cx');
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
