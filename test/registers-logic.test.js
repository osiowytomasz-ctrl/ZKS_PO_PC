import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, between, parseDetailCode, parseOperCode, parseDocCode, parsePieces, parseOrdered, operationsText, filterRows } from '../src/renderer/js/logic/registers.js';

test('between: tekst między ogranicznikami, pusty gdy brak', () => {
  assert.equal(between('*K1*#P1#', '*'), 'K1');
  assert.equal(between('*K1', '*'), '');
  assert.equal(between('abc', '*'), '');
  assert.equal(between('a⍵12⍵b', '⍵'), '12');
});

test('kod detalu: komis, rysunek, pozycja i komplet są wymagane', () => {
  const ok = parseDetailCode('*K1*$R1$⍵P1⍵^KOM^');
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.fields, { komis: 'K1', rysunek: 'R1', pozycja: 'P1', komplet: 'KOM' });
  assert.match(ok.display, /Nr kompletu: KOM/);
  assert.equal(parseDetailCode('*K1*$R1$').valid, false);
});

test('kod operacji: wymaga komisu, przewodnika i numeru; klient i rysunek opcjonalne', () => {
  const p = parseOperCode('*K1*#P1#@10@');
  assert.equal(p.valid, true);
  assert.equal(p.fields.klient, '');
  assert.equal(parseOperCode('*K1*#P1#').valid, false);
  assert.equal(parseOperCode('*K1*#P1#@10@^Kl^$r$').fields.rysunek, 'r');
});

test('kod dokumentu: wszystkie siedem pól', () => {
  assert.equal(parseDocCode('*K1*#P1#^Typ^$Nazwa$!R1!~7~@3@').valid, true);
  assert.equal(parseDocCode('*K1*#P1#^Typ^$Nazwa$!R1!~7~').valid, false);
});

test('ilości: sztuki ≥ 1 z przecinkiem, ilość zlecona całkowita', () => {
  assert.equal(parsePieces('3'), '3');
  assert.equal(parsePieces(' 2,5 '), '2.5');
  assert.equal(parsePieces('0'), null);
  assert.equal(parsePieces('0,5'), null);
  assert.equal(parsePieces('abc'), null);
  assert.equal(parsePieces(''), null);
  assert.equal(parseOrdered('12'), '12');
  assert.equal(parseOrdered('1,5'), null);
  assert.equal(parseOrdered('0'), null);
});

test('operationsText i filterRows', () => {
  assert.equal(operationsText([]), 'brak');
  assert.equal(operationsText([{ nr: '10', komis: 'K1', przewodnik: 'P1', klient: 'Kl', operator: 'o', status: 'Start' }]), '10 | K1 | P1 | Kl | o | Start');
  const rows = [{ komis: 'K1', nazwa: 'Wał' }, { komis: 'K2', nazwa: 'Tuleja' }];
  assert.equal(filterRows(rows, 'tul', ['komis', 'nazwa']).length, 1);
  assert.equal(filterRows(rows, '', ['komis']).length, 2);
});

test('classify: rodzaj kodu po znakach rozdzielających, produkt z listy ma pierwszeństwo', () => {
  const products = ['CCMT 120404', 'AB#12'];
  assert.equal(classify('  ', products), 'none');
  assert.equal(classify('*K1*$R1$⍵P1⍵^KOM^', products), 'detail');
  assert.equal(classify('*K1*#P1#^Typ^$Nazwa$!R1!~7~@3@', products), 'document');
  assert.equal(classify('*K1*#P1#@10@', products), 'operation');
  assert.equal(classify('*K1*#P1#', products), 'operation');     // niepełna operacja: rozpoznana, ale nieważna
  assert.equal(classify('ccmt  120404', products), 'product');
  assert.equal(classify('AB#12', products), 'product');           // z listy, mimo znaku #
  assert.equal(classify('DOWOLNY KOD', products), 'product');
  assert.equal(classify('*K1*', []), 'unknown');
  assert.equal(classify('^KOM^', []), 'unknown');
});
