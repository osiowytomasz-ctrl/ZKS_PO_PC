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
        getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = cell(r + i, c + j)[c + j - 1]; return v == null ? '' : String(v); })),
        setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => { cell(r + i, c + j)[c + j - 1] = v; })),
        setValue: (v) => { cell(r, c)[c - 1] = v; },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) cell(r + i, c + j)[c + j - 1] = ''; },
        copyTo: (dst) => { sheet.copied.push([r, c, dst]); },
      };
    },
    copied: [],
    getMaxColumns: () => 20, insertColumnsAfter() {},
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

// Atrapa bazy Firestore (REST) w pamięci: mp_rows/{klucz}_{nnn} = { k, r: { wiersz: JSON } }, mp_meta/main.
function makeEnv({ setup, db = {} } = {}) {
  const sheets = { Setup: makeSheet(setup || setupRows(['mistrz@x.pl'], ['lista@x.pl'], ['dok@x.pl'])) };
  const store = {}, requests = [];
  const meta = { sheets: {} };
  for (const [key, rows] of Object.entries(db)) {
    for (let i = 0; i < rows.length; i += 300) {
      const r = {}; rows.slice(i, i + 300).forEach((x) => { r[x.row] = JSON.stringify(x.v); });
      store[`mp_rows/${key}_${String(i / 300).padStart(3, '0')}`] = { k: key, r };
    }
    meta.sheets[key] = { rows: rows.length, n: Math.ceil(rows.length / 300) };
  }
  const base = 'projects/p/databases/(default)/documents';
  const res = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj || {}) });
  const UrlFetchApp = { fetch(url, opts) {
    const u = url.replace('https://firestore.googleapis.com/v1/', '');
    requests.push([opts.method, u.split('?')[0]]);
    if (u === base + ':batchGet') {
      return res(200, JSON.parse(opts.payload).documents.map((n) => { const id = n.split(base + '/')[1]; const d = store[id];
        return d ? { found: { name: n, fields: { k: { stringValue: d.k }, r: { mapValue: { fields: Object.fromEntries(Object.entries(d.r).map(([row, j]) => [row, { stringValue: j }])) } } } } } : { missing: n }; }));
    }
    if (u.startsWith(base + '/mp_meta/main') && opts.method === 'GET') {
      return res(200, { fields: { sheets: { mapValue: { fields: Object.fromEntries(Object.entries(meta.sheets).map(([k, v]) => [k, { mapValue: { fields: { rows: { integerValue: String(v.rows) }, n: { integerValue: String(v.n) } } } }])) } } } });
    }
    if (opts.method === 'PATCH') {
      const [path, q] = u.replace(base + '/', '').split('?'); const body = JSON.parse(opts.payload);
      if (path === 'mp_meta/main') { const sh = body.fields.sheets.mapValue.fields; for (const k of Object.keys(sh)) { const f = sh[k].mapValue.fields; meta.sheets[k] = { rows: Number(f.rows.integerValue), n: Number(f.n.integerValue) }; } return res(200); }
      const d = (store[path] = store[path] || { k: '', r: {} }); d.k = body.fields.k.stringValue;
      const fields = body.fields.r.mapValue.fields || {};
      for (const m of q.split('&').map((x) => decodeURIComponent(x.replace('updateMask.fieldPaths=', '')))) { if (m === 'k') continue; const row = m.replace(/^r\.`/, '').replace(/`$/, ''); if (fields[row]) d.r[row] = fields[row].stringValue; else delete d.r[row]; }
      return res(200);
    }
    return res(404);
  } };
  const SpreadsheetApp = {
    openById: () => ({ getSheetByName: (n) => sheets[n] || null, getName: () => 'Mistrz_po', getSpreadsheetTimeZone: () => 'Europe/Warsaw' }),
    flush() {},
  };
  const Utilities = { formatDate: (d, tz, fmt) => (fmt === 'HH:mm' ? '12:34' : fmt === 'yyyy-MM-dd' ? '2026-11-09' : '09.11.2026') };
  const api_error_ = (code, message) => { const e = new Error(message); e.apiCode = code; return e; };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => ({ FIREBASE_PROJECT_ID: 'p', FIREBASE_CLIENT_EMAIL: 'x', FIREBASE_PRIVATE_KEY: 'k' }[k]) }) };
  const CacheService = { getScriptCache: () => ({ get: () => 'tok', put() {} }) };
  const ctx = vm.createContext({ SpreadsheetApp, Utilities, UrlFetchApp, PropertiesService, CacheService, api_b64url_: (x) => x, api_error_, Logger: { log() {} }, console: { log() {}, error() {} }, Date, JSON, String, Number, Array, Object, Math, isFinite, isNaN, parseInt, parseFloat, RegExp, Error });
  vm.runInContext(fs.readFileSync(new URL('../backend/Code_MistrzPO.gs', import.meta.url), 'utf8'), ctx);
  const rows = (key) => { const out = []; for (const [id, d] of Object.entries(store)) if (id.startsWith(`mp_rows/${key}_`)) for (const [row, j] of Object.entries(d.r)) out.push({ row: Number(row), v: JSON.parse(j) }); return out.sort((a, b) => a.row - b.row); };
  return { ctx, sheets, store, meta, requests, rows };
}
// Wynik przechodzi przez JSON, bo obiekty z kontekstu vm mają inne prototypy niż w teście.
const call = (env, fn, ...args) => { const r = vm.runInContext(fn, env.ctx)(...args); return r === undefined ? r : JSON.parse(JSON.stringify(r)); };
const user = (email) => ({ email, name: email });

const OP = (komis, przew, nr, extra = '') => `*${komis}*#${przew}#@${nr}@^Klient^$rys$${extra}`;
const R = (row, v) => ({ row, v });

test('uprawnienia: osobne listy w kolumnach C, D, E zakładki Setup', () => {
  const env = makeEnv();
  assert.deepEqual(call(env, 'mp_getPermissions_', user('Mistrz@X.pl')), { manage: true, details: false, docs: false });
  assert.deepEqual(call(env, 'mp_getPermissions_', user('lista@x.pl')), { manage: false, details: true, docs: false });
  assert.deepEqual(call(env, 'mp_getPermissions_', user('dok@x.pl')), { manage: false, details: false, docs: true });
  assert.deepEqual(call(env, 'mp_getPermissions_', user('ktos@x.pl')), { manage: false, details: false, docs: false });
});

test('detale: zapis w bazie, limit ilości zleconej i wymagane pola', () => {
  const env = makeEnv({ db: { dlist: [R(3, { B: 'K1', D: 'R1', E: 'P1', F: 'KOM', G: 5 })] } });
  const code = '*K1*$R1$⍵P1⍵^KOM^';
  const r = call(env, 'mp_saveDetail_', { productCode: code, extraNotes: '3' }, user('op@x.pl'));
  assert.equal(r.status, 'success'); assert.match(r.message, /w bazie/);
  assert.deepEqual(env.rows('dreg'), [R(3, { A: '2026-11-09', B: '12:34', C: 'K1', D: 'R1', E: 'P1', F: 'KOM', G: '3', H: 'op@x.pl' })]);
  assert.throws(() => call(env, 'mp_saveDetail_', { productCode: code, extraNotes: '3' }, user('op@x.pl')), /dozwolona ilość: 2/);
  call(env, 'mp_saveDetail_', { productCode: code, extraNotes: '2' }, user('op@x.pl'));
  assert.deepEqual(env.rows('dreg').map((x) => [x.row, x.v.G]), [[3, '3'], [4, '2']]);   // drugi wiersz pod pierwszym
  assert.throws(() => call(env, 'mp_saveDetail_', { productCode: code, extraNotes: '0' }, user('op@x.pl')), /większe lub równe 1/);
  assert.throws(() => call(env, 'mp_saveDetail_', { productCode: '*K1*', extraNotes: '1' }, user('op@x.pl')), /kluczowych polach/);
  assert.throws(() => call(env, 'mp_saveDetail_', { productCode: '*K9*$R1$⍵P1⍵^KOM^', extraNotes: '1' }, user('op@x.pl')), /nie zarejestrowany/);
  assert.equal(env.sheets.Setup.copied.length, 0);   // arkusz nie jest zmieniany
  // sztuki zlicza i zapisuje program: Lista detali dostaje „szt zrobione” (kolumna P) = suma zarejestrowanych sztuk
  assert.equal(env.rows('dlist')[0].v.P, 5);                                  // 3 + 2
});

test('detale: numer pozycji z arkusza jako data lub liczba nadal pasuje do kodu ze skanera (luźny klucz)', () => {
  const env = makeEnv({ db: { dlist: [R(3, { B: 'K1', D: 'R1', E: '2002-01-04', F: 'KOM', G: 5 })] } });
  call(env, 'mp_saveDetail_', { productCode: '*K1*$R1$⍵2.1.4⍵^KOM^', extraNotes: '1' }, user('op@x.pl'));
  assert.equal(env.rows('dreg').length, 1);
});

test('przeliczenie sztuk: Lista detali dostaje „szt zrobione” z Rejestru detali (tylko zmienione wiersze, pierwsza pozycja przy duplikacie)', () => {
  const env = makeEnv({ db: {
    dlist: [R(3, { B: 'K1', D: 'R1', E: 'P1', F: 'KOM', G: 5 }), R(4, { B: 'K1', D: 'R2', E: 'P1', F: 'KOM', G: 2, P: 0 }), R(5, { B: 'K1', D: 'R1', E: 'P1', F: 'KOM', G: 5 })],
    dreg: [R(3, { C: 'K1', D: 'R1', E: 'P1', F: 'KOM', G: '3' }), R(4, { C: 'K1', D: 'R1', E: 'P1', F: 'KOM', G: '2' })] } });
  const r = call(env, 'mp_recountDetails_');
  assert.equal(r.checked, 3); assert.equal(r.changed, 2);                    // R1: 5 (pierwsza), duplikat 0; R2 już ma 0
  assert.deepEqual(env.rows('dlist').map((x) => x.v.P), [5, 0, 0]);
  assert.equal(call(env, 'mp_recountDetails_').changed, 0);                  // drugi raz nic do zmiany
});

test('operacje: kolejność statusów Start, W toku, Koniec – zapis w bazie', () => {
  const env = makeEnv();
  const op = user('op@x.pl');
  const code = OP('K1', 'P1', '10');
  assert.throws(() => call(env, 'mp_saveOperation_', { productCode: code, status: 'Koniec' }, op), /brak 'Start'/);
  call(env, 'mp_saveOperation_', { productCode: code, status: 'Start', notes: 'uwaga' }, op);
  assert.deepEqual(env.rows('ops'), [R(3, { A: '2026-11-09', B: '12:34', C: 'K1', D: 'P1', E: '10', F: 'Klient', G: 'rys', H: 'op@x.pl', I: 'Start', J: 'uwaga' })]);
  assert.throws(() => call(env, 'mp_saveOperation_', { productCode: code, status: 'Start' }, op), /już ma status 'Start'/);
  call(env, 'mp_saveOperation_', { productCode: code, status: 'W toku' }, op);
  call(env, 'mp_saveOperation_', { productCode: code, status: 'Koniec' }, op);
  assert.throws(() => call(env, 'mp_saveOperation_', { productCode: code, status: 'W toku' }, op), /zakończona/);
  assert.throws(() => call(env, 'mp_saveOperation_', { productCode: code, status: 'Usunięta' }, op), /Nieprawidłowy status/);
  assert.deepEqual(env.rows('ops').map((x) => x.row), [3, 4, 5]);
});

test('operacje: wyszukiwanie zwraca obiekty posortowane po numerze', () => {
  const env = makeEnv({ db: { ops: [
    R(3, { C: 'K1', D: 'P1', E: 'B', F: 'Kl', H: 'o1', I: 'Start' }),
    R(4, { C: 'K1', D: 'P1', E: 'A', F: 'Kl', H: 'o2', I: 'Start' }), R(5, { C: 'K1', D: 'P1', E: 'A', F: 'Kl', H: 'o2', I: 'Koniec' }),
    R(6, { C: 'K2', D: 'P9', E: 'C', F: 'Kl', H: 'o3', I: 'Start' })] } });
  const pending = call(env, 'mp_pendingOperations_', 'K1');
  assert.deepEqual(pending.map((x) => x.nr), ['B']);                    // A ma stan Koniec
  assert.equal(pending[0].status, 'Start');
  const all = call(env, 'mp_displayOperations_', 'K1', 'P1');
  assert.deepEqual(all.map((x) => x.nr), ['A', 'A', 'B']);
  assert.equal(all[0].operator, 'o2');
});

test('zmiana statusu i usuwanie operacji wymagają uprawnienia, usuwanie jest miękkie', () => {
  const env = makeEnv({ db: { ops: [
    R(3, { C: 'K1', D: 'P1', E: '10', I: 'Koniec' }),
    R(4, { C: 'K1', D: 'P1', E: '20', I: 'Start' })] } });
  const code10 = OP('K1', 'P1', '10');
  assert.throws(() => call(env, 'mp_changeOperationStatus_', { productCode: code10 }, user('ktos@x.pl')), (e) => e.apiCode === 'FORBIDDEN');
  assert.throws(() => call(env, 'mp_deleteOperation_', { productCode: code10 }, user('ktos@x.pl')), (e) => e.apiCode === 'FORBIDDEN');
  assert.equal(env.rows('ops')[0].v.I, 'Koniec');                        // nic nie zmieniono

  call(env, 'mp_changeOperationStatus_', { productCode: code10 }, user('mistrz@x.pl'));
  assert.equal(env.rows('ops')[0].v.I, 'W toku');
  assert.match(env.rows('ops')[0].v.J, /Zmiana statusu na W toku: 09\.11\.2026 12:34 przez mistrz/);

  const r = call(env, 'mp_deleteOperation_', { productCode: OP('K1', 'P1', '20') }, user('mistrz@x.pl'));
  assert.match(r.message, /1 operacji/);
  assert.equal(env.rows('ops')[1].v.I, 'Usunięta');
  assert.throws(() => call(env, 'mp_deleteOperation_', { productCode: OP('K1', 'P1', '20') }, user('mistrz@x.pl')), /Nie znaleziono aktywnych/);
  assert.deepEqual(call(env, 'mp_findOperations_', 'K1', 'P1', '20'), []); // usunięte nie są już „aktywne”
});

test('dokumentacja: zapis w bazie, blokada duplikatu, lista i usuwanie dla uprawnionych', () => {
  const env = makeEnv();
  const code = '*K1*#P1#^Typ^$Nazwa$!R1!~7~@3@';
  const op = user('op@x.pl');
  call(env, 'mp_saveDocument_', { productCode: code }, op);
  assert.deepEqual(env.rows('docs'), [R(3, { A: '2026-11-09', B: '12:34', C: 'K1', D: 'P1', E: 'Typ', F: 'Nazwa', G: 'R1', H: '7', I: '3', J: 'op@x.pl' })]);
  assert.throws(() => call(env, 'mp_saveDocument_', { productCode: code }, op), /już istnieje/);
  assert.throws(() => call(env, 'mp_saveDocument_', { productCode: '*K1*#P2#' }, op), /Nieprawidłowy format/);

  assert.throws(() => call(env, 'mp_listDocuments_', {}, op), (e) => e.apiCode === 'FORBIDDEN');
  const list = call(env, 'mp_listDocuments_', {}, user('dok@x.pl'));
  assert.equal(list.length, 1);
  assert.equal(list[0].row, 3); assert.equal(list[0].komis, 'K1'); assert.equal(list[0].date, '09.11.2026');

  assert.throws(() => call(env, 'mp_deleteDocument_', { row: 3, komis: 'K1', przewodnik: 'P1' }, op), (e) => e.apiCode === 'FORBIDDEN');
  assert.throws(() => call(env, 'mp_deleteDocument_', { row: 3, komis: 'inny', przewodnik: 'P1' }, user('dok@x.pl')), /zmienił się/);
  call(env, 'mp_deleteDocument_', { row: 3, komis: 'K1', przewodnik: 'P1' }, user('dok@x.pl'));
  assert.deepEqual(env.rows('docs'), []);
  assert.deepEqual(call(env, 'mp_listDocuments_', {}, user('dok@x.pl')), []);
});

test('lista detali: dodawanie tylko z uprawnieniem, bez duplikatów, wpis w bazie', () => {
  const env = makeEnv({ db: { dlist: [R(3, { A: 1, B: 'K1', D: 'R1', E: 'P1', F: 'KOM', G: 5 })] } });
  const form = { komis: 'K2', rysunek: 'R2', pozycja: 'P2', komplet: 'KK', ilosc: '4' };
  assert.throws(() => call(env, 'mp_addDetail_', form, user('op@x.pl')), (e) => e.apiCode === 'FORBIDDEN');
  const r = call(env, 'mp_addDetail_', form, user('lista@x.pl'));
  assert.match(r.message, /wiersz 4/);
  assert.deepEqual(env.rows('dlist')[1], R(4, { B: 'K2', D: 'R2', E: 'P2', F: 'KK', G: 4 }));
  assert.throws(() => call(env, 'mp_addDetail_', form, user('lista@x.pl')), /już na liście/);
  assert.throws(() => call(env, 'mp_addDetail_', { ...form, pozycja: 'P3', ilosc: '0' }, user('lista@x.pl')), /całkowitą/);
  assert.throws(() => call(env, 'mp_addDetail_', { ...form, pozycja: '' }, user('lista@x.pl')), /Uzupełnij/);
  assert.equal(call(env, 'mp_listDetails_', user('lista@x.pl')).length, 2);
  assert.throws(() => call(env, 'mp_listDetails_', user('op@x.pl')), (e) => e.apiCode === 'FORBIDDEN');
});

test('paczki po 300 wierszy: dopisywanie przechodzi do nowej paczki, numery wierszy rosną', () => {
  const env = makeEnv();
  const append = vm.runInContext('mp_append_', env.ctx);
  for (let i = 0; i < 302; i++) append('zkom', { B: 'k' + i });
  const rows = env.rows('zkom');
  assert.equal(rows.length, 302); assert.equal(rows[0].row, 2); assert.equal(rows[301].row, 303);
  assert.deepEqual(Object.keys(env.store).filter((x) => x.startsWith('mp_rows/zkom_')).sort(), ['mp_rows/zkom_000', 'mp_rows/zkom_001']);
});

test('biała lista API: wszystkie funkcje mp_ z Api.js istnieją w Code_MistrzPO.js', () => {
  const api = fs.readFileSync(new URL('../backend/Api.gs', import.meta.url), 'utf8');
  const code = fs.readFileSync(new URL('../backend/Code_MistrzPO.gs', import.meta.url), 'utf8');
  const used = [...api.matchAll(/\b(mp_[A-Za-z]+_)\(/g)].map((m) => m[1]);
  assert.ok(used.length >= 13);
  for (const name of new Set(used)) assert.match(code, new RegExp(`function ${name}\\(`), name);
});

test('podgląd Skanera: dokumenty komisu, operacje przewodnika i detale z bazy (wartości liczone jak formuły)', () => {
  const env = makeEnv({ db: {
    docs: [R(3, { A: '2026-03-23', B: '09:25', C: 'E3/25/803', D: '4_2', E: 'KTK', F: 'Obudowa', G: 'R1', H: 'id', I: 5, J: 'Kumala' })],
    ops: [R(3, { A: '2026-03-23', B: '07:00', C: 'e3/25/803', D: '4_2', E: 10, F: 'K', G: 'R', H: 'jan@x', I: 'Start' }),
      R(4, { A: '2026-03-23', B: '08:00', C: 'e3/25/803', D: '4_2', E: 10, F: 'K', G: 'R', H: 'jan@x', I: 'Koniec' }),
      R(5, { A: '2026-03-23', B: '07:00', C: 'E3/25/803', D: '1_1', E: 10, F: 'K', G: 'R', H: 'ola@x', I: 'Start' })],
    dlist: [R(3, { B: '25/803', D: 'R-1', E: '1', F: 1, G: 4 })],
    dreg: [R(3, { A: '2026-03-23', B: '10:00', C: '25/803', D: 'R-1', E: '1', F: 1, G: 3, H: 'op@x' })],
  } });
  const r = call(env, 'mp_scanInfo_', { komis: 'E3/25/803', przewodnik: '4_2', detailKomis: '25/803' });
  assert.equal(r.docs.length, 1); assert.equal(r.docs[0].nr, '4_2'); assert.equal(r.docs[0].status, '1 / 5'); assert.equal(r.docs[0].progress, 0.2);
  assert.equal(r.docs[0].start, '23.03.2026 07:00'); assert.equal(r.docs[0].end, ''); assert.equal(r.docs[0].date, '23.03.2026');
  assert.deepEqual(r.ops.map((o) => [o.nr, o.status, o.operator, o.statusG]), [['10', 'Start', 'jan@x', 'Koniec'], ['10', 'Koniec', 'jan@x', 'Koniec']]);
  assert.equal(r.dreg.length, 1); assert.equal(r.dreg[0].progress, 0.75); assert.equal(r.dreg[0].todo, '4'); assert.equal(r.dreg[0].done, '3');
  assert.deepEqual(call(env, 'mp_scanInfo_', {}), { docs: [], ops: [], dreg: [] });
});

test('import i eksport: tylko jedna zakładka; eksport zapisuje dane z bazy w kolumny wpisywane, formuły K:M tylko w Rejestrze operacji', () => {
  const env = makeEnv({ db: { ops: [R(3, { A: '2026-03-23', B: '07:00', C: 'K1', D: 'P1', E: 10, F: 'Kl', G: 'r', H: 'jan', I: 'Start', J: '' }), R(5, { A: '2026-03-24', C: 'K2' })] } });
  const sheet = makeSheet([[], [], ['stare', '', 'x', '', '', '', '', '', '', '', 'F1', 'F2', 'F3']]);
  sheet.getSpreadsheetTimeZone = () => 'Europe/Warsaw';
  env.sheets['Rejestr operacji'] = sheet;
  const r = call(env, 'mp_exportToSheet_', 'Rejestr operacji');
  assert.equal(r.rows, 2); assert.match(r.message, /Wyeksportowano 2/);
  assert.equal(sheet.grid[2][2], 'K1'); assert.equal(sheet.grid[2][0].getFullYear(), 2026);   // data jako Date
  assert.equal(sheet.grid[2][10], 'F1');                                                        // formuły (kolumny K:M) nietknięte
  assert.equal(sheet.grid[3][2], '');                                                           // wiersz 4 pusty w bazie = wyczyszczony w arkuszu
  assert.equal(sheet.grid[4][2], 'K2');
  assert.equal(sheet.copied.length >= 1, true);                                                 // kopiowanie formuł K:M z wiersza 1
  assert.throws(() => call(env, 'mp_exportToSheet_', 'Nieznana'), /Nieznana zakładka/);
});

test('poziom „Mistrz dostęp”: zmiana statusu i usuwanie od MASTER; bez kolumny – lista z Setup', () => {
  const env = makeEnv();
  // bez kolumny poziomów: jak dotąd – Setup C
  assert.equal(call(env, 'mp_getPermissions_', user('mistrz@x.pl')).manage, true);
  assert.equal(call(env, 'mp_getPermissions_', user('lista@x.pl')).manage, false);
  // kolumna wypełniona: decyduje poziom (min. MASTER), lista z Setup C już nie wystarcza
  env.ctx.api_levelColumn_ = () => ({ 'lista@x.pl': 'master', 'mistrz@x.pl': 'clerik', 'god@x.pl': 'god' });
  const p = (e) => call(env, 'mp_getPermissions_', user(e));
  assert.equal(p('lista@x.pl').manage, true); assert.equal(p('lista@x.pl').level, 'master');
  assert.equal(p('mistrz@x.pl').manage, false); assert.equal(p('god@x.pl').manage, true); assert.equal(p('nikt@x.pl').manage, false);
  assert.equal(p('lista@x.pl').details, true);   // listy detali i dokumentacji – nadal z Setup
});
