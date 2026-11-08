import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Atrapa arkusza i SpreadsheetApp, żeby sprawdzić backend Workflow.gs bez Google.
function makeEnv(initialRows, maxRows = 12) {
  const grid = []; // grid[r][c] = {v, runs, formula, fmt}
  for (let r = 0; r <= maxRows; r++) { grid.push([]); for (let c = 0; c <= 8; c++) grid[r].push({ v: '', runs: null, formula: '', fmt: '' }); }
  initialRows.forEach((cells, i) => cells.forEach((v, c) => { grid[i + 2][c + 1].v = v; }));
  const mkRich = (text, runs) => ({
    getText: () => text,
    getRuns: () => {
      if (!runs || !runs.length) return [{ getText: () => text, getTextStyle: () => ({ isBold: () => false, isItalic: () => false, isUnderline: () => false, isStrikethrough: () => false, getForegroundColor: () => null }) }];
      const out = []; let pos = 0;
      const push = (s, e, st) => out.push({ getText: () => text.slice(s, e), getTextStyle: () => st || ({ isBold: () => false, isItalic: () => false, isUnderline: () => false, isStrikethrough: () => false, getForegroundColor: () => null }) });
      runs.sort((a, b) => a.s - b.s).forEach((r) => { if (r.s > pos) push(pos, r.s); push(r.s, r.e, r.st); pos = r.e; });
      if (pos < text.length) push(pos, text.length);
      return out;
    },
  });
  const sheet = {
    getLastRow: () => { let last = 1; for (let r = 2; r <= maxRows; r++) if (grid[r].slice(1).some((x) => x.v !== '' || x.formula)) last = r; return last; },
    getMaxRows: () => maxRows,
    getRange(r, c, nr = 1, nc = 1) {
      const cells = [];
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) cells.push(grid[r + i][c + j]);
      const at = (i, j) => grid[r + i][c + j];
      return {
        getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String(at(i, j).v))),
        getRichTextValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => mkRich(String(at(i, j).v), at(i, j).runs))),
        getDisplayValue: () => String(at(0, 0).v),
        getFormula: () => at(0, 0).formula,
        setValue: (v) => { at(0, 0).v = v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : v; at(0, 0).runs = null; },
        setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => { at(i, j).v = v; })),
        setRichTextValue: (rt) => { at(0, 0).v = rt._text; at(0, 0).runs = rt._runs; },
        setNumberFormat: (f) => { at(0, 0).fmt = f; },
        copyTo: (target) => { target._set(at(0, 0).formula.replace(/\d+/g, (m) => String(Number(m) + 1))); },
        _set: (f) => { at(0, 0).formula = f; at(0, 0).v = 'zz'; },
      };
    },
  };
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => ({ getSheetByName: (n) => (n === 'Z' ? sheet : null) }),
    flush() {},
    CopyPasteType: { PASTE_FORMULA: 'F' },
    newTextStyle: () => { const st = { b: false, i: false, u: false, s: false, c: null };
      const api = { setBold: (x) => { st.b = x; return api; }, setItalic: (x) => { st.i = x; return api; }, setUnderline: (x) => { st.u = x; return api; }, setStrikethrough: (x) => { st.s = x; return api; }, setForegroundColor: (x) => { st.c = x; return api; },
        build: () => ({ isBold: () => st.b, isItalic: () => st.i, isUnderline: () => st.u, isStrikethrough: () => st.s, getForegroundColor: () => st.c }) };
      return api; },
    newRichTextValue: () => { const o = { _text: '', _runs: [] };
      const api = { setText: (t) => { o._text = t; return api; }, setTextStyle: (s, e, st) => { o._runs.push({ s, e, st }); return api; }, build: () => ({ _text: o._text, _runs: o._runs }) };
      return api; },
  };
  const ctx = vm.createContext({ SpreadsheetApp, Logger: { log() {} }, Date, JSON, String, Number, Array, Object });
  vm.runInContext(fs.readFileSync(new URL('../backend/Workflow.gs', import.meta.url), 'utf8'), ctx);
  return { ctx, grid };
}
const call = (env, fn, ...args) => vm.runInContext(`${fn}`, env.ctx)(...args);

test('Workflow backend: odczyt zwraca wiersze i formatowanie E/F', () => {
  const env = makeEnv([['', 'x', '', '2021-01-01', 'K1', 'tekst', 'Jan', 'inne'], ['', '', '', '', '', '', '', '']]);
  const r = call(env, 'api_getWorkflow_');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].row, 2);
  assert.deepEqual(Object.keys(r.rows[0].runs), []);                // brak formatowania → brak runs
  env.grid[2][6].runs = [{ s: 0, e: 3, st: { isBold: () => true, isItalic: () => false, isUnderline: () => false, isStrikethrough: () => false, getForegroundColor: () => '#ff0000' } }];
  const r2 = call(env, 'api_getWorkflow_');
  assert.equal(r2.rows[0].runs.F[0].bold, true);
  assert.equal(r2.rows[0].runs.F[0].color, '#ff0000');
  assert.equal(r2.rows[0].runs.F[0].text, 'tek');
  assert.equal(r2.rows[0].runs.F[1].text, 'st');
});

test('Workflow backend: status jest wyłączny, data i zlecający tylko gdy puste', () => {
  const env = makeEnv([['', 'x', '', '', 'K1', 'zadanie', '', ''], ['x', '', '', '2021-05-05 10:00', 'K2', 'inne', 'Anna', '']]);
  call(env, 'api_saveWorkflow_', [{ row: 2, status: 'C' }], { name: 'Tomasz', email: 't@x' });
  assert.deepEqual([1, 2, 3].map((c) => env.grid[2][c].v), ['', '', 'x']);
  assert.match(String(env.grid[2][4].v), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);       // data uzupełniona
  assert.equal(env.grid[2][4].fmt, 'yyyy-mm-dd hh:mm');
  assert.equal(env.grid[2][7].v, 'Tomasz');                                    // zlecający uzupełniony
  call(env, 'api_saveWorkflow_', [{ row: 3, status: '' }], { name: 'Tomasz' });
  assert.deepEqual([1, 2, 3].map((c) => env.grid[3][c].v), ['', '', '']);
  assert.equal(env.grid[3][4].v, '2021-05-05 10:00');                          // niepusta data bez zmian
  assert.equal(env.grid[3][7].v, 'Anna');                                      // niepusty zlecający bez zmian
});

test('Workflow backend: tekst z formatowaniem, expect chroni przed nadpisaniem', () => {
  const env = makeEnv([['', '', '', '2021-01-01', 'K1', 'stary', 'Jan', '']]);
  const cells = { F: { runs: [{ text: 'pog', bold: true }, { text: 'rubiony', color: '#00ff00' }, { text: ' zwykły' }] } };
  call(env, 'api_saveWorkflow_', [{ row: 2, cells, expect: { F: 'stary' } }], { name: 'T' });
  assert.equal(env.grid[2][6].v, 'pogrubiony zwykły');
  const runs = env.grid[2][6].runs;
  assert.equal(runs.length, 2);
  assert.deepEqual([runs[0].s, runs[0].e, runs[0].st.isBold()], [0, 3, true]);
  assert.equal(runs[1].st.getForegroundColor(), '#00ff00');
  assert.throws(() => call(env, 'api_saveWorkflow_', [{ row: 2, cells: { F: { text: 'x' } }, expect: { F: 'inny' } }], { name: 'T' }), /zmienił się/);
  assert.equal(env.grid[2][6].v, 'pogrubiony zwykły');                         // nie nadpisano
});

test('Workflow backend: nowy wiersz w pierwszym wolnym, formuła H, walidacja bez częściowych zapisów', () => {
  const env = makeEnv([['', '', '', '2021-01-01', 'K1', 'a', 'Jan', 'inne'], ['', '', '', '', '', '', '', '']]);
  env.grid[2][8].formula = '=JEŻELI(D2<>"";"i";"z")';
  const res = call(env, 'api_saveWorkflow_', [{ row: null, status: 'B', cells: { E: { text: '604-01' }, F: { runs: [{ text: 'Nowe', bold: true }] } } }], { name: 'Ola' });
  assert.equal(JSON.stringify(res.rows), '[3]');
  assert.deepEqual([1, 2, 3].map((c) => env.grid[3][c].v), ['', 'x', '']);
  assert.equal(env.grid[3][5].v, '604-01');
  assert.equal(env.grid[3][7].v, 'Ola');
  assert.equal(env.grid[3][8].formula, '=JEŻELI(D3<>"";"i";"z")');            // formuła skopiowana z wiersza wyżej
  assert.throws(() => call(env, 'api_saveWorkflow_', [{ row: 2, status: 'A' }, { row: 3, status: 'X' }], {}), /Nieprawidłowy status/);
  assert.equal(env.grid[2][1].v, '');                                          // pierwszy element nie został zapisany
  assert.throws(() => call(env, 'api_saveWorkflow_', [{ row: null, cells: { F: { text: '  ' } } }], {}), /Wpisz/);
  assert.throws(() => call(env, 'api_saveWorkflow_', [{ row: 2, cells: { G: { text: 'x' } } }], {}), /nie jest edytowalna/);
  assert.throws(() => call(env, 'api_saveWorkflow_', [{ row: 99 }], {}), /numer wiersza/);
});
