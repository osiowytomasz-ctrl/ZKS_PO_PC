import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Atrapa arkuszy i SpreadsheetApp, żeby sprawdzić Code_MistrzPO.js bez Google.
function makeSheet(rows = [], maxCols = 14) {
  const grid = rows.map((r) => r.slice());
  const cell = (r, c) => { while (grid.length < r) grid.push([]); const row = grid[r - 1]; while (row.length < c) row.push(''); return row; };
  const sheet = {
    grid,
    getLastRow: () => { let last = 0; grid.forEach((row, i) => { if (row.some((v) => v !== '' && v != null)) last = i + 1; }); return last; },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = cell(r + i, c + j); return row[c + j - 1] ?? ''; })),
        getValue: () => cell(r, c)[c - 1] ?? '',
        setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => { cell(r + i, c + j)[c + j - 1] = v; })),
        setValue: (v) => { cell(r, c)[c - 1] = v; },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) cell(r + i, c + j)[c + j - 1] = ''; },
        copyTo: (dst) => { sheet.copied.push([r, c, dst]); },
      };
    },
    copied: [],
  };
  void maxCols;
  return sheet;
}

function setupRows(manage = [], details = [], docs = []) {
  const n = Math.max(manage.length, details.length, docs.length);
  const rows = [[], ['', '', 'Mistrz', 'Lista', 'Dok']];
  for (let i = 0; i < n; i++) rows.push(['', '', manage[i] || '', details[i] || '', docs[i] || '']);
  return rows;
}

function makeEnv({ setup, detailRegister = [], detailList = [], oper = [], docs = [] } = {}) {
  const sheets = {
    Setup: makeSheet(setup || setupRows(['mistrz@x.pl'], ['lista@x.pl'], ['dok@x.pl'])),
    'Rejestr detali': makeSheet(detailRegister),
    'Lista detali': makeSheet(detailList),
    'Rejestr operacji': makeSheet(oper),
    'Rejestr dokumentacji': makeSheet(docs),
  };
  const SpreadsheetApp = {
    openById: () => ({ getSheetByName: (n) => sheets[n] || null, getName: () => 'Mistrz_po' }),
    flush() {},
  };
  const Utilities = { formatDate: (d, tz, fmt) => (fmt === 'HH:mm' ? '12:34' : '09.11.2026') };
  const api_error_ = (code, message) => { const e = new Error(message); e.apiCode = code; return e; };
  const ctx = vm.createContext({ SpreadsheetApp, Utilities, api_error_, Logger: { log() {} }, console: { log() {}, error() {} }, Date, JSON, String, Number, Array, Object, Math, isFinite, isNaN, parseInt });
  vm.runInContext(fs.readFileSync(new URL('../backend/Code_MistrzPO.gs', import.meta.url), 'utf8'), ctx);
  return { ctx, sheets };
}
// Wynik przechodzi przez JSON, bo obiekty z kontekstu vm mają inne prototypy niż w teście.
const call = (env, fn, ...args) => { const r = vm.runInContext(fn, env.ctx)(...args); return r === undefined ? r : JSON.parse(JSON.stringify(r)); };
const user = (email) => ({ email, name: email });

const OP = (komis, przew, nr, extra = '') => `*${komis}*#${przew}#@${nr}@^Klient^$rys$${extra}`;

test('uprawnienia: osobne listy w kolumnach C, D, E zakładki Setup', () => {
  const env = makeEnv();
  assert.deepEqual(call(env, 'mp_getPermissions_', user('Mistrz@X.pl')), { manage: true, details: false, docs: false });
  assert.deepEqual(call(env, 'mp_getPermissions_', user('lista@x.pl')), { manage: false, details: true, docs: false });
  assert.deepEqual(call(env, 'mp_getPermissions_', user('dok@x.pl')), { manage: false, details: false, docs: true });
  assert.deepEqual(call(env, 'mp_getPermissions_', user('ktos@x.pl')), { manage: false, details: false, docs: false });
});

test('detale: zapis, limit ilości zleconej i wymagane pola', () => {
  const env = makeEnv({
    detailList: [['h'], ['', 'K1', '', 'R1', 'P1', 'KOM', 5]],
    detailRegister: [],
  });
  const code = '*K1*$R1$⍵P1⍵^KOM^';
  const r = call(env, 'mp_saveDetail_', { productCode: code, extraNotes: '3' }, user('op@x.pl'));
  assert.equal(r.status, 'success');
  assert.deepEqual(env.sheets['Rejestr detali'].grid[0].slice(0, 8), ['09.11.2026', '12:34', 'K1', 'R1', 'P1', 'KOM', '3', 'op@x.pl']);
  assert.throws(() => call(env, 'mp_saveDetail_', { productCode: code, extraNotes: '3' }, user('op@x.pl')), /dozwolona ilość: 2/);
  call(env, 'mp_saveDetail_', { productCode: code, extraNotes: '2' }, user('op@x.pl'));
  assert.equal(env.sheets['Rejestr detali'].grid[1][6], '2');          // drugi wiersz zapisany pod pierwszym
  assert.throws(() => call(env, 'mp_saveDetail_', { productCode: code, extraNotes: '0' }, user('op@x.pl')), /większe lub równe 1/);
  assert.throws(() => call(env, 'mp_saveDetail_', { productCode: '*K1*', extraNotes: '1' }, user('op@x.pl')), /kluczowych polach/);
  assert.throws(() => call(env, 'mp_saveDetail_', { productCode: '*K9*$R1$⍵P1⍵^KOM^', extraNotes: '1' }, user('op@x.pl')), /nie zarejestrowany/);
});

test('operacje: kolejność statusów Start, W toku, Koniec', () => {
  const env = makeEnv({ oper: [['formuły'], [], []] });
  const op = user('op@x.pl');
  const code = OP('K1', 'P1', '10');
  assert.throws(() => call(env, 'mp_saveOperation_', { productCode: code, status: 'Koniec' }, op), /brak 'Start'/);
  call(env, 'mp_saveOperation_', { productCode: code, status: 'Start', notes: 'uwaga' }, op);
  const row = env.sheets['Rejestr operacji'].grid[2];
  assert.deepEqual(row.slice(0, 10), ['09.11.2026', '12:34', 'K1', 'P1', '10', 'Klient', 'rys', 'op@x.pl', 'Start', 'uwaga']);
  assert.equal(env.sheets['Rejestr operacji'].copied.length, 2);       // formuły i formatowanie K:M skopiowane (2 wywołania copyTo)
  assert.throws(() => call(env, 'mp_saveOperation_', { productCode: code, status: 'Start' }, op), /już ma status 'Start'/);
  call(env, 'mp_saveOperation_', { productCode: code, status: 'W toku' }, op);
  call(env, 'mp_saveOperation_', { productCode: code, status: 'Koniec' }, op);
  assert.throws(() => call(env, 'mp_saveOperation_', { productCode: code, status: 'W toku' }, op), /zakończona/);
  assert.throws(() => call(env, 'mp_saveOperation_', { productCode: code, status: 'Usunięta' }, op), /Nieprawidłowy status/);
});

test('operacje: wyszukiwanie zwraca obiekty posortowane po numerze', () => {
  const env = makeEnv({
    oper: [[], [],
      ['d', 't', 'K1', 'P1', 'B', 'Kl', 'r', 'o1', 'Start', '', 'W toku'],
      ['d', 't', 'K1', 'P1', 'A', 'Kl', 'r', 'o2', 'Start', '', 'Koniec'],
      ['d', 't', 'K2', 'P9', 'C', 'Kl', 'r', 'o3', 'Start', '', 'W toku']],
  });
  const pending = call(env, 'mp_pendingOperations_', 'K1');
  assert.deepEqual(pending.map((x) => x.nr), ['B']);                    // A ma kolumnę K = Koniec
  const all = call(env, 'mp_displayOperations_', 'K1', 'P1');
  assert.deepEqual(all.map((x) => x.nr), ['A', 'B']);
  assert.equal(all[0].operator, 'o2');
  assert.equal(all[0].status, 'Start');
});

test('zmiana statusu i usuwanie operacji wymagają uprawnienia, usuwanie jest miękkie', () => {
  const env = makeEnv({
    oper: [[], [],
      ['d', 't', 'K1', 'P1', '10', 'Kl', 'r', 'o', 'Koniec', '', 'Koniec'],
      ['d', 't', 'K1', 'P1', '20', 'Kl', 'r', 'o', 'Start', '', 'W toku']],
  });
  const code10 = OP('K1', 'P1', '10');
  assert.throws(() => call(env, 'mp_changeOperationStatus_', { productCode: code10 }, user('ktos@x.pl')), (e) => e.apiCode === 'FORBIDDEN');
  assert.throws(() => call(env, 'mp_deleteOperation_', { productCode: code10 }, user('ktos@x.pl')), (e) => e.apiCode === 'FORBIDDEN');
  const grid = env.sheets['Rejestr operacji'].grid;
  assert.equal(grid[2][8], 'Koniec');                                    // nic nie zmieniono

  call(env, 'mp_changeOperationStatus_', { productCode: code10 }, user('mistrz@x.pl'));
  assert.equal(grid[2][8], 'W toku');
  assert.match(grid[2][9], /Zmiana statusu na W toku: 09\.11\.2026 12:34 przez mistrz/);

  const r = call(env, 'mp_deleteOperation_', { productCode: OP('K1', 'P1', '20') }, user('mistrz@x.pl'));
  assert.match(r.message, /1 operacji/);
  assert.equal(grid[3][8], 'Usunięta');
  assert.throws(() => call(env, 'mp_deleteOperation_', { productCode: OP('K1', 'P1', '20') }, user('mistrz@x.pl')), /Nie znaleziono aktywnych/);
  assert.deepEqual(call(env, 'mp_findOperations_', 'K1', 'P1', '20'), []); // usunięte nie są już „aktywne”
});

test('dokumentacja: zapis, blokada duplikatu (także liczba w arkuszu), lista i usuwanie dla uprawnionych', () => {
  const env = makeEnv({ docs: [[], []] });
  const code = '*K1*#P1#^Typ^$Nazwa$!R1!~7~@3@';
  const op = user('op@x.pl');
  call(env, 'mp_saveDocument_', { productCode: code }, op);
  const grid = env.sheets['Rejestr dokumentacji'].grid;
  assert.deepEqual(grid[2].slice(0, 10), ['09.11.2026', '12:34', 'K1', 'P1', 'Typ', 'Nazwa', 'R1', '7', '3', 'op@x.pl']);
  assert.throws(() => call(env, 'mp_saveDocument_', { productCode: code }, op), /już istnieje/);
  grid[2][2] = 55; grid[2][3] = 8;                                        // liczby w arkuszu, kod ma tekst
  assert.throws(() => call(env, 'mp_saveDocument_', { productCode: '*55*#8#^T^$N$!R!~1~@1@' }, op), /już istnieje/);
  assert.throws(() => call(env, 'mp_saveDocument_', { productCode: '*K1*#P2#' }, op), /Nieprawidłowy format/);

  assert.throws(() => call(env, 'mp_listDocuments_', {}, op), (e) => e.apiCode === 'FORBIDDEN');
  const list = call(env, 'mp_listDocuments_', {}, user('dok@x.pl'));
  assert.equal(list.length, 1);
  assert.equal(list[0].row, 3);
  assert.equal(list[0].komis, '55');

  assert.throws(() => call(env, 'mp_deleteDocument_', { row: 3, komis: '55', przewodnik: '8' }, op), (e) => e.apiCode === 'FORBIDDEN');
  assert.throws(() => call(env, 'mp_deleteDocument_', { row: 3, komis: 'inny', przewodnik: '8' }, user('dok@x.pl')), /zmienił się/);
  call(env, 'mp_deleteDocument_', { row: 3, komis: '55', przewodnik: '8' }, user('dok@x.pl'));
  assert.deepEqual(grid[2].slice(0, 10), ['', '', '', '', '', '', '', '', '', '']);
  assert.deepEqual(call(env, 'mp_listDocuments_', {}, user('dok@x.pl')), []);
});

test('lista detali: dodawanie tylko z uprawnieniem, bez duplikatów, kolumny A i C nietknięte', () => {
  const env = makeEnv({ detailList: [['h'], ['f1', 'K1', 'f2', 'R1', 'P1', 'KOM', 5], ['f1', '', 'f2']] });
  const form = { komis: 'K2', rysunek: 'R2', pozycja: 'P2', komplet: 'KK', ilosc: '4' };
  assert.throws(() => call(env, 'mp_addDetail_', form, user('op@x.pl')), (e) => e.apiCode === 'FORBIDDEN');
  const r = call(env, 'mp_addDetail_', form, user('lista@x.pl'));
  assert.match(r.message, /wierszu 3/);                                   // pierwszy wiersz bez danych (B, D, E puste)
  const row = env.sheets['Lista detali'].grid[2];
  assert.deepEqual(row.slice(0, 7), ['f1', 'K2', 'f2', 'R2', 'P2', 'KK', 4]);
  assert.throws(() => call(env, 'mp_addDetail_', form, user('lista@x.pl')), /już na liście/);
  assert.throws(() => call(env, 'mp_addDetail_', { ...form, pozycja: 'P3', ilosc: '0' }, user('lista@x.pl')), /całkowitą/);
  assert.throws(() => call(env, 'mp_addDetail_', { ...form, pozycja: '' }, user('lista@x.pl')), /Uzupełnij/);
  assert.equal(call(env, 'mp_listDetails_', user('lista@x.pl')).length, 2);
  assert.throws(() => call(env, 'mp_listDetails_', user('op@x.pl')), (e) => e.apiCode === 'FORBIDDEN');
});

test('biała lista API: wszystkie funkcje mp_ z Api.js istnieją w Code_MistrzPO.js', () => {
  const api = fs.readFileSync(new URL('../backend/Api.gs', import.meta.url), 'utf8');
  const code = fs.readFileSync(new URL('../backend/Code_MistrzPO.gs', import.meta.url), 'utf8');
  const used = [...api.matchAll(/\b(mp_[A-Za-z]+_)\(/g)].map((m) => m[1]);
  assert.ok(used.length >= 13);
  for (const name of new Set(used)) assert.match(code, new RegExp(`function ${name}\\(`), name);
});
