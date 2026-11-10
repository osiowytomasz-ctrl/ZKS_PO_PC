import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shiftHours, isSumStation, stationHours, slotNumber, buildCapacity, computeEnd, computeSchedule, toSerial, sortKey, compareKeys, DAY_MS } from '../src/renderer/js/logic/schedule.js';

const D = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
const cap = (start, n, f) => buildCapacity(Array.from({ length: n }, (_, i) => ({ date: start + i * DAY_MS, hours: f(new Date(start + i * DAY_MS).getUTCDay(), i) })));

test('kody grafiku: godziny po literach a, b, c', () => {
  assert.deepEqual(shiftHours('a8'), { a: 8, b: 0, c: 0 });
  assert.deepEqual(shiftHours('a5b3'), { a: 5, b: 3, c: 0 });
  assert.deepEqual(shiftHours('a2b6'), { a: 2, b: 6, c: 0 });
  for (const k of ['L4', 'UT', 'BO', '*', '', null, undefined, 'A8']) assert.deepEqual(shiftHours(k), { a: 0, b: 0, c: 0 }, String(k));   // wielkie A się nie liczy
  assert.deepEqual(shiftHours('b8'), { a: 0, b: 8, c: 0 });
  assert.deepEqual(shiftHours('a4b4'), { a: 4, b: 4, c: 0 });
  assert.deepEqual(shiftHours('a12'), { a: 1, b: 0, c: 0 });                    // formuła czyta jedną cyfrę
});

test('godziny na stanowisku: dane z wiersza 07.01.2026 ze zrzutu grafiku (wyniki z arkusza: 16, 19, 16, 32, 16, 0)', () => {
  assert.equal(stationHours('1Si', ['L4', 'b8', 'c8']), 16);
  assert.equal(stationHours('2Un', ['a5b3', 'c8', 'a8']), 19);                    // min(8,13) + 3 + 8
  assert.equal(stationHours('3Co', ['b8', 'a8', 'a8']), 16);                      // min(8,16) + 8
  assert.equal(stationHours('5Śl', ['a8', 'a8', 'b8', 'a8']), 32);                // suma wszystkich
  assert.equal(stationHours('Do', ['a8', 'UT', 'a8']), 16);
  assert.equal(stationHours('1Si', ['L4', 'b8', 'a6']), 14);                      // wiersz 12.01.2026
  assert.equal(stationHours('2Un', ['c8', 'b8', 'a8']), 24);
  assert.equal(stationHours('1Si', []), 0);
  assert.equal(stationHours('1Si', ['a8', 'a8', 'a8', 'a8']), 8);                 // maszyna: tylko miejsca 1–3 i max 8 h na zmianę
  assert.equal(stationHours('Do', ['a8', 'a8', 'a8', 'a8']), 32);                 // suma bierze więcej niż 3 miejsca
});

test('rodzaje stanowisk i miejsca pracy', () => {
  for (const s of ['5Śl', '3Śl', 'Do', 'do', 'Narz']) assert.equal(isSumStation(s), true, s);
  for (const s of ['1Si', '2Un', '3Co']) assert.equal(isSumStation(s), false, s);
  assert.equal(slotNumber('1Si2', '1Si'), 2);
  assert.equal(slotNumber('5Śl4', '5Śl'), 4);
  assert.equal(slotNumber('Narz', 'Narz'), null);                                  // nagłówek bez cyfry nie pasuje: Narz ma w arkuszu 0 godzin
  assert.equal(slotNumber('Narz1', 'Narz'), 1);
  assert.equal(slotNumber('1Si10', '1Si'), null);
  assert.equal(slotNumber('2Un1', '1Si'), null);
});

test('koniec operacji: stanowisko 16 h na dobę', () => {
  const c = cap(D(2026, 11, 1), 40, () => 16);
  assert.equal(computeEnd(D(2026, 11, 10, 6), 10, c), D(2026, 11, 10, 16));       // start 06:00, 10 h: tego samego dnia 16:00
  assert.equal(computeEnd(D(2026, 11, 10, 14), 10, c), D(2026, 11, 11, 8));       // start 14:00: 8 h do 22:00, 2 h od 6:00
  assert.equal(computeEnd(D(2026, 11, 10, 6), 16, c), D(2026, 11, 10, 22));       // dokładnie cała doba
  assert.equal(computeEnd(D(2026, 11, 10, 6), 17, c), D(2026, 11, 11, 7));
  assert.equal(computeEnd(D(2026, 11, 10, 6, 30), 10, c), D(2026, 11, 10, 16, 30)); // minuty startu zostają
  assert.equal(computeEnd(D(2026, 11, 10, 6), 0, c), D(2026, 11, 10, 6));
});

test('koniec operacji: dni bez godzin (weekend) są pomijane', () => {
  const c = cap(D(2026, 11, 1), 40, (dow) => (dow === 0 || dow === 6 ? 0 : 16));  // 6.11.2026 to piątek
  assert.equal(new Date(D(2026, 11, 6)).getUTCDay(), 5);
  assert.equal(computeEnd(D(2026, 11, 6, 6), 20, c), D(2026, 11, 9, 10));          // pt 16 h + pon 4 h od 6:00
  assert.equal(computeEnd(D(2026, 11, 6, 14), 20, c), D(2026, 11, 9, 18));         // pt 8 h (do 22:00) + pon 12 h
  assert.equal(computeEnd(D(2026, 11, 7, 6), 10, c), D(2026, 11, 9, 16));          // start w sobotę: praca dopiero w poniedziałek
});

test('koniec operacji: zmienne godziny i brak danych', () => {
  const c = cap(D(2026, 11, 1), 10, (_, i) => [8, 16, 24, 8, 8, 0, 0, 16, 16, 16][i]);
  assert.equal(computeEnd(D(2026, 11, 1, 6), 30, c), D(2026, 11, 3, 12));          // 8 + 16 = 24, brakuje 6 h w trzeciej dobie
  assert.equal(computeEnd(D(2026, 11, 1, 6), 1000, c), null);                      // grafik się kończy
  assert.equal(computeEnd(D(2030, 1, 1, 6), 10, c), null);                         // start poza grafikiem
  assert.equal(computeEnd(null, 10, c), null);
  assert.equal(computeEnd(D(2026, 11, 1, 6), null, c), null);
});

const op = (lp, preds, o = {}) => ({ lp, preds, startManual: null, hours: 10, endManual: null, station: 'S', ...o });

test('harmonogram: start z poprzednika, ręczny start, kilka poprzedników, brak danych', () => {
  const capacity = { S: cap(D(2026, 11, 1), 60, () => 16) };
  const r = computeSchedule([
    op('1', [], { startManual: D(2026, 11, 10, 6) }),
    op('2', ['1']),                                   // start = koniec 1
    op('3', ['1', '2']),                              // start = późniejszy z końców (koniec 2)
    op('4', ['99']),                                  // poprzednik nie istnieje → brak startu
    op('5', ['4']),                                   // poprzednik bez końca → brak startu
    op('6', ['2'], { startManual: D(2026, 11, 20, 6) }),   // ręczny start ma pierwszeństwo przed poprzednikami
    op('7', []),                                      // bez poprzedników i bez startu
    op('8', ['1'], { hours: null }),                  // bez godzin → bez końca
  ], capacity);
  assert.equal(r.get('1').end, D(2026, 11, 10, 16));
  assert.equal(r.get('2').start, D(2026, 11, 10, 16));
  assert.equal(r.get('2').end, D(2026, 11, 11, 10));     // start 16:00: 6 h do 22:00, 4 h od 6:00 następnego dnia
  assert.equal(r.get('3').start, r.get('2').end);
  assert.equal(r.get('4').state, 'no-start'); assert.equal(r.get('5').state, 'no-start');
  assert.equal(r.get('6').start, D(2026, 11, 20, 6)); assert.equal(r.get('6').end, D(2026, 11, 20, 16));
  assert.equal(r.get('7').state, 'no-start');
  assert.equal(r.get('8').state, 'no-end'); assert.equal(r.get('8').start, r.get('1').end);
});

test('harmonogram: koniec ręczny (rzeczywisty) wyznacza start następnika; cykle i powtórzone numery', () => {
  const capacity = { S: cap(D(2026, 11, 1), 60, () => 16) };
  const r = computeSchedule([
    op('1', [], { startManual: D(2026, 11, 10, 6), endManual: D(2026, 11, 12, 9) }),
    op('2', ['1']),
    op('10', ['11']), op('11', ['10']),               // cykl
    op('12', ['10']),                                 // zależny od cyklu
    op('1', [], { startManual: D(2026, 12, 1, 6) }),  // powtórzony numer: liczy się pierwsza operacja
  ], capacity);
  assert.equal(r.get('1').end, D(2026, 11, 12, 9));
  assert.equal(r.get('2').start, D(2026, 11, 12, 9));
  assert.equal(r.get('10').state, 'cycle'); assert.equal(r.get('11').state, 'cycle'); assert.equal(r.get('12').state, 'cycle');
});

test('numer seryjny daty i klucz sortowania jak w kolumnie „Stat.”', () => {
  assert.ok(Math.abs(toSerial(D(2026, 11, 14, 14)) - 46340.5833333333) < 1e-9);    // „2Un46340,5833333333” z arkusza
  assert.equal(toSerial(D(2026, 11, 14)), 46340);
  const today = D(2026, 11, 10), horizon = 417;
  const a = sortKey({ station: '1Si', zak: '' }, D(2026, 12, 1), horizon, today);
  const b = sortKey({ station: '1Si', zak: '' }, D(2026, 11, 20), horizon, today);
  const c = sortKey({ station: '2Un', zak: '' }, D(2026, 11, 1), horizon, today);
  const z = sortKey({ station: '3Co', zak: 'zak.' }, D(2026, 11, 1), horizon, today);
  const far = sortKey({ station: '1Si', zak: '' }, D(2030, 1, 1), horizon, today);
  const none = sortKey({ station: '', zak: '' }, D(2026, 11, 1), horizon, today);
  const sorted = [c, a, far, z, b, none].sort(compareKeys);
  assert.equal(sorted[0], z);                                                    // zakończone na początku
  assert.ok(sorted.indexOf(b) < sorted.indexOf(a) && sorted.indexOf(a) < sorted.indexOf(c));   // stanowisko, potem start
  // klucze „00Zak” < „0ZZ…” < „1Si…”: poza horyzontem i bez stanowiska stoją przed stanowiskami (zaraz po zakończonych)
  assert.ok(sorted.indexOf(far) > sorted.indexOf(z) && sorted.indexOf(far) < sorted.indexOf(b));
  assert.ok(sorted.indexOf(none) > sorted.indexOf(z) && sorted.indexOf(none) < sorted.indexOf(b));
});

// ---- test na prawdziwych danych użytkownika (plik lokalny, nie jest częścią repozytorium) ----
const SAMPLE = process.env.ZKS_HARM_SAMPLE || new URL('./fixtures/harm-sample.json', import.meta.url).pathname;
const parseDt = (t) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{1,2}):(\d{2}))?$/.exec(String(t).trim()); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] || 0, +m[5] || 0) : null; };
test('prawdziwe dane: start z poprzedników zgadza się z arkuszem dla wszystkich operacji', { skip: !fs.existsSync(SAMPLE) && 'brak pliku z próbką danych' }, () => {
  const rows = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  // jako koniec każdej operacji podajemy koniec z arkusza (jako ręczny), więc sprawdzamy WYŁĄCZNIE regułę startu
  const ops = rows.map((r) => ({ lp: r.lp, preds: r.z, startManual: parseDt(r.startManual), hours: Number(String(r.hours).replace(',', '.')) || null, endManual: parseDt(r.endCalc), station: r.station }));
  const res = computeSchedule(ops, {});
  const bad = [];
  for (const r of rows) {
    const got = res.get(r.lp).start, want = parseDt(r.startCalc);
    if ((got ?? null) !== (want ?? null)) bad.push(`${r.lp}: arkusz=${r.startCalc || '(pusty)'} program=${got == null ? '(pusty)' : new Date(got).toISOString()}`);
  }
  console.log(`# próbka: operacji=${rows.length}, ręczny start=${rows.filter((r) => r.startManual).length}, rozbieżności startu=${bad.length}`);
  assert.deepEqual(bad, []);
  // klucz „Stat.” zgadza się z arkuszem co do stanowiska i numeru seryjnego startu
  for (const r of rows) {
    const s = res.get(r.lp).start;
    const want = r.key.slice(r.station.length).replace(',', '.');
    assert.ok(Math.abs(toSerial(s) - Number(want)) < 1e-6, `klucz ${r.lp}: ${r.key} vs ${toSerial(s)}`);
  }
});

// ---- koniec operacji i godziny dzienne na prawdziwym grafiku (pliki lokalne, poza repozytorium) ----
const GRAF = new URL('./fixtures/graf-norm.txt', import.meta.url).pathname;
test('prawdziwe dane: godziny dzienne z kodów i koniec operacji zgodne z arkuszem', { skip: (!fs.existsSync(GRAF) || !fs.existsSync(SAMPLE)) && 'brak plików z danymi' }, () => {
  const lines = fs.readFileSync(GRAF, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  const head = lines[0], names = head.slice(1, 7);
  const slotCols = head.map((h, i) => ({ h, i })).filter((x) => x.i >= 8 && x.h);
  const pd = (t) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null; };
  const days = Object.fromEntries(names.map((n) => [n, []]));
  let bad = 0;
  for (const r of lines.slice(1)) {
    const date = pd(r[7]); if (date == null) continue;
    names.forEach((st, k) => {
      const codes = Array(9).fill('');
      for (const c of slotCols) { const n = slotNumber(c.h, st); if (n) codes[n - 1] = r[c.i] || ''; }
      const want = Number(r[1 + k]) || 0;
      if (stationHours(st, codes) !== want) bad++;
      days[st].push({ date, hours: want });
    });
  }
  assert.equal(bad, 0);
  const capacity = Object.fromEntries(names.map((n) => [n, buildCapacity(days[n])]));
  const rows = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const ops = rows.map((r) => ({ lp: r.lp, preds: r.z, startManual: parseDt(r.startManual), hours: Number(String(r.hours).replace(',', '.')) || null, endManual: parseDt(r.endManual), station: r.station }));
  const res = computeSchedule(ops, capacity);
  const diffs = rows.filter((r) => (res.get(r.lp).end ?? null) !== (parseDt(r.endCalc) ?? null)).map((r) => r.lp);
  assert.deepEqual(diffs, []);
});
