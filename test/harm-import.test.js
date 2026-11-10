import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDelimited, detectDelimiter, parseDateTime, parseNumber, importOperations } from '../src/renderer/js/logic/harmImport.js';

test('parser: cudzysłowy, podwójny cudzysłów, nowe linie w komórce, separatory', () => {
  assert.deepEqual(parseDelimited('a\tb\n"x\ny"\t"z ""q"""\n'), [['a', 'b'], ['x\ny', 'z "q"']]);
  assert.deepEqual(parseDelimited('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseDelimited('a,"b,c",d\r\n'), [['a', 'b,c', 'd']]);
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.deepEqual(parseDelimited('﻿x\ty'), [['x', 'y']]);
});

test('daty i liczby z arkusza', () => {
  assert.equal(parseDateTime('14.11.2026 14:00'), Date.UTC(2026, 10, 14, 14));
  assert.equal(parseDateTime('22.11.2026'), Date.UTC(2026, 10, 22));
  assert.equal(parseDateTime('07.02.2027  6'), Date.UTC(2027, 1, 7, 6));
  assert.equal(parseDateTime('17.11.2026 00:00'), Date.UTC(2026, 10, 17));
  assert.equal(parseDateTime('2026-11-14 08:30'), Date.UTC(2026, 10, 14, 8, 30));
  for (const bad of ['', 'abc', '31.02.2026', '10.13.2026', '1.1.2026 25:00', null]) assert.equal(parseDateTime(bad), null, String(bad));
  assert.equal(parseNumber('70'), 70); assert.equal(parseNumber('2,5'), 2.5); assert.equal(parseNumber(' 1 000 '), 1000);
  assert.equal(parseNumber('x'), null); assert.equal(parseNumber(''), null);
});

// wiersz w układzie arkusza: A lp, B–E Z1–Z4, F klient, G komis, H opis, I start (wyliczony), J start ręczny, K czas, L koniec ręczny, M koniec (wyliczony), … R termin, S klucz, T status, … X dostawa, AB stanowisko
function row(o) {
  const c = Array(28).fill('');
  Object.entries({ 0: o.lp, 1: o.z1, 2: o.z2, 3: o.z3, 4: o.z4, 5: o.client, 6: o.komis, 7: o.element, 8: o.I, 9: o.J, 10: o.K, 11: o.L, 12: o.M, 13: o.N, 17: o.R, 18: o.S, 19: o.T, 23: o.X, 27: o.AB }).forEach(([i, v]) => { if (v != null) c[i] = v; });
  return c.join('\t');
}

test('import: tylko dane wejściowe, wyliczone kolumny są pomijane, ostrzeżenia', () => {
  const text = ['"\nHarmonogram\nWydziałów"\tKomis\t=DZIŚ()', 'lp.\tzależności', '\tZ1\tz2\tz3\tz4\tKlient',
    row({ lp: '1', client: 'Klient A', komis: '26/1', element: 'Op 1', I: '01.01.2027 06:00', J: '01.01.2027 06:00', K: '10,5', M: '02.01.2027 10:00', R: '30.06.2027', S: '1Si46000', T: 'zak.', X: '05.12.2026 6', AB: '1Si' }),
    row({ lp: '2', z1: '1', z2: '99', element: 'Op 2', K: '48', L: '10.01.2027 12:00', I: '02.01.2027 10:00', M: '10.01.2027 12:00', N: 'x', AB: '2Un' }),
    row({ lp: '2', element: 'Duplikat', K: 'abc', J: 'zły termin', AB: '' }),
    row({ lp: 'Suma', element: 'nie operacja', AB: '1Si' }),
    row({ lp: '5' })].join('\n');
  const { operations: ops, warnings } = importOperations(text);
  assert.equal(ops.length, 3);                                                   // „Suma” i pusty wiersz pominięte
  assert.deepEqual(ops[0], { lp: '1', preds: [], client: 'Klient A', komis: '26/1', element: 'Op 1', station: '1Si', hours: 10.5,
    startManual: Date.UTC(2027, 0, 1, 6), endManual: null, wysylka: Date.UTC(2027, 5, 30), dostawa: Date.UTC(2026, 11, 5, 6), status: 'zak.' });
  assert.equal(ops[0].endManual, null);                                          // M (wyliczony koniec) nie jest czytany
  assert.deepEqual(ops[1].preds, ['1', '99']); assert.equal(ops[1].endManual, Date.UTC(2027, 0, 10, 12)); assert.equal(ops[1].startManual, null);   // I (wyliczony start) nie jest czytany
  assert.ok(warnings.some((w) => /poprzednik 99 nie występuje/.test(w)));
  assert.ok(warnings.some((w) => /numer operacji 2 powtórzony/.test(w)));
  assert.ok(warnings.some((w) => /czasu „abc”/.test(w)));
  assert.ok(warnings.some((w) => /daty „zły termin”/.test(w)));
  assert.ok(warnings.some((w) => /brak stanowiska/.test(w)));
  assert.match(importOperations('nic tu nie ma').warnings[0], /Nie znaleziono żadnych operacji/);
});

// ---- test na prawdziwym pliku użytkownika (lokalnie i w prywatnym repozytorium) ----
const EXPORT = process.env.ZKS_HARM_EXPORT || new URL('./fixtures/harm-export.txt', import.meta.url).pathname;
test('prawdziwy eksport: 105 operacji, poprzedniki i ręczne starty zgodne z arkuszem', { skip: !fs.existsSync(EXPORT) && 'brak pliku z eksportem' }, () => {
  const { operations: ops, warnings } = importOperations(fs.readFileSync(EXPORT, 'utf8'));
  console.log(`# eksport: operacji=${ops.length}, ostrzeżeń=${warnings.length}, ręczny start=${ops.filter((o) => o.startManual != null).length}`);
  assert.equal(ops.length, 105);
  assert.equal(ops.filter((o) => o.startManual != null).length, 12);
  assert.equal(ops.filter((o) => o.endManual != null).length, 0);
  const first = ops.find((o) => o.lp === '2');
  assert.deepEqual([first.preds, first.station, first.hours], [['1'], '1Si', 70]);
  assert.equal(ops.find((o) => o.lp === '110').startManual, Date.UTC(2026, 10, 8, 14));
  assert.ok(ops.every((o) => o.station && o.hours != null));
});
