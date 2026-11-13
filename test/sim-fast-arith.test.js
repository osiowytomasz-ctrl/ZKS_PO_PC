// Szybkie liczenie wyrażeń w symulatorach (web/symulator.html, web/symulator-num.html): wynik musi być taki sam jak
// dotychczasowe Function('return(...)'), a gdy JavaScript zgłosiłby błąd składni – fastArith oddaje undefined (stara droga).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function extract(file) {
  const src = fs.readFileSync(new URL('../web/' + file, import.meta.url), 'utf8');
  const a = src.indexOf('function fastArith(s){');
  assert.ok(a > 0, 'brak fastArith w ' + file);
  let depth = 0, i = src.indexOf('{', a);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return new Function(src.slice(a, i + 1) + '\nreturn fastArith;')();
}
const ref = (s) => { try { if (/^[\d\s()+\-*/.%eE^]+$/.test(s)) return parseFloat(Function('"use strict";return(' + s + ')')()); } catch (e) { /* jak w symulatorze */ } return parseFloat(s); };

for (const file of ['symulator.html', 'symulator-num.html']) {
  test(`fastArith (${file}) – zgodny z JavaScriptem`, () => {
    const fa = extract(file);
    for (const [s, v] of [['1+2*3', 7], ['(1+2)*3', 9], ['2**3**2', 512], ['7%4', 3], ['-3+ -2', -5], ['1e3/4', 250], ['.5+1.', 1.5], ['10/0', Infinity]]) assert.equal(fa(s), v, s);
    for (const s of ['-2**2', '08', '1 2', '1.2.3', '2e', '--1', '()', '', '1//2', '\t1']) assert.equal(fa(s), undefined, JSON.stringify(s));
    assert.ok(Object.is(fa('-0'), 0));
    const al = ['0', '1', '2', '07', '0.5', '.5', '1.', '12.25', '3e2', '1E-3', '2e+1', '5.e3', ' ', '(', ')', '+', '-', '*', '/', '%', '**', 'e', '.', '00', '10'];
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let k = 0; k < 60000; k++) {
      let s = ''; const L = 1 + Math.floor(rnd() * 7);
      for (let j = 0; j < L; j++) s += al[Math.floor(rnd() * al.length)];
      const f = fa(s); if (f === undefined) continue;
      const r = ref(s);
      assert.ok(Object.is(f, r) || (Number.isNaN(f) && Number.isNaN(r)), `${JSON.stringify(s)}: ${f} ≠ ${r}`);
    }
  });
}
