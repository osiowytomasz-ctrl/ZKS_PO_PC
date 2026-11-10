import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

// Atrapa arkuszy Google z licznikiem wywołań usługi: sprawdza, że szybkie funkcje dają TE SAME dane co stare, ale z mniejszą liczbą odczytów.
const colToNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const numToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function makeSheet(env, name, cells) {   // cells: { 'r:c': {v, bg, fc} }
  const get = (r, c) => cells[r + ':' + c] || { v: '', bg: '#ffffff', fc: '#000000' };
  const maxOf = (idx) => Math.max(0, ...Object.keys(cells).filter((k) => String(cells[k].v) !== '').map((k) => Number(k.split(':')[idx])));
  const mkRange = (r, c, nr, nc) => {
    const grid = (f) => { env.calls++; return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => f(get(r + i, c + j)))); };
    return {
      getDisplayValues: () => grid((x) => String(x.v)), getValues: () => grid((x) => x.v), getBackgrounds: () => grid((x) => x.bg), getFontColors: () => grid((x) => x.fc),
      getDisplayValue: () => { env.calls++; return String(get(r, c).v); }, getValue: () => { env.calls++; return get(r, c).v; },
      setValue: (v) => { cells[r + ':' + c] = { ...get(r, c), v }; }, getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
      getA1Notation: () => `${numToCol(c)}${r}:${numToCol(c + nc - 1)}${r + nr - 1}`,
    };
  };
  return {
    getLastRow: () => { env.calls++; return maxOf(0); }, getLastColumn: () => { env.calls++; return maxOf(1); },
    getDataRange: () => mkRange(1, 1, maxOf(0), maxOf(1)),
    getRange(a, b, c, d) {
      if (typeof a === 'string') { const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a); const c1 = colToNum(m[1]), r1 = Number(m[2]); const c2 = m[3] ? colToNum(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1; return mkRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1); }
      return mkRange(a, b, c || 1, d || 1);
    },
  };
}

function build() {
  const env = { calls: 0, now: 0 };
  // --- Grafik (arkusz G): A3 = lewy zakres, B3 = prawy zakres, wiersz 4 = daty ---
  const g = {}; const put = (cells, r, c, v, bg = '#ffffff', fc = '#000000') => { cells[r + ':' + c] = { v, bg, fc }; };
  put(g, 3, 1, 'A5:B9'); put(g, 3, 2, 'C5:H9');
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
  dates.forEach((d, i) => put(g, 4, 3 + i, d));
  for (let r = 5; r <= 9; r++) { put(g, r, 1, `Nazwisko${r} Imię`, '#ccffcc'); put(g, r, 2, 'R', '#ffff00', '#ff0000'); dates.forEach((_, i) => put(g, r, 3 + i, ['R', 'W', 'U'][(r + i) % 3], ['#fff', '#ff0', '#0f0'][(r + i) % 3])); }
  const mainSheet = makeSheet(env, 'G', g);
  // --- Harmonogram (osobny plik) ---
  const h = {};
  for (let i = 0; i < 40; i++) {
    const r = 14 + i;
    const set = (c, v) => put(h, r, c, v);
    set(1, String(i + 1)); set(2, i ? String(i) : ''); set(7, `26/${100 + (i % 5)}`); set(8, 'Element ' + i); set(9, `2026-11-${String(1 + (i % 20)).padStart(2, '0')} 08:00`);
    set(11, '20'); set(13, `2026-11-${String(3 + (i % 20)).padStart(2, '0')} 14:00`); set(18, i % 3 ? '' : '2026-11-10 06:00'); set(20, i % 7 ? '' : 'Zak.'); set(24, '2026-11-01 06:00');
    put(h, r, 28, ['3Co', '1Si', '5Śl', '2Kr'][i % 4], ['#6aa84f', '#9fc5e8', '#00b0f0', '#ffd966'][i % 4], '#222222');
  }
  put(h, 14 + 45, 8, ''); // wiersz poza danymi
  const setup = {}; ['2026-11-11', '2026-11-12'].forEach((d, i) => put(setup, 2 + i, 1, d));
  const rap = {}; put(rap, 2, 2, '3Co'); put(rap, 2, 3, '1Si'); put(rap, 4, 1, '26/100'); put(rap, 4, 2, '12,5'); put(rap, 4, 3, '3'); put(rap, 5, 1, '26/100'); put(rap, 5, 2, '2'); put(rap, 6, 1, '26/101'); put(rap, 6, 3, 'x'); put(rap, 1, 1, 'Tytuł');
  const sheetsH = { Harmonogram: makeSheet(env, 'Harmonogram', h), setup: makeSheet(env, 'setup', setup), Rap_m_h: makeSheet(env, 'Rap_m_h', rap) };

  // --- CacheService z limitem 100 KB na wartość i zegarem ---
  const store = new Map();
  const live = (k) => { const e = store.get(k); return e && e.exp > env.now ? e.v : null; };
  const CacheService = { getScriptCache: () => ({
    get: (k) => live(k), put: (k, v, s = 600) => { assert.ok(String(v).length <= 100000, 'wartość w pamięci podręcznej > 100 KB'); store.set(k, { v: String(v), exp: env.now + s }); },
    putAll: (m, s = 600) => Object.entries(m).forEach(([k, v]) => { assert.ok(String(v).length <= 100000); store.set(k, { v: String(v), exp: env.now + s }); }),
    getAll: (keys) => Object.fromEntries(keys.map((k) => [k, live(k)])), remove: (k) => store.delete(k),
  }) };
  const blob = (x) => ({ _buf: typeof x === 'string' ? Buffer.from(x) : Buffer.from(x), getBytes() { return this._buf; }, getDataAsString() { return this._buf.toString('utf8'); } });
  const Utilities = { newBlob: (x) => blob(x), gzip: (b) => blob(zlib.gzipSync(b._buf)), ungzip: (b) => blob(zlib.gunzipSync(b._buf)), base64Encode: (bytes) => Buffer.from(bytes).toString('base64'), base64Decode: (s) => Array.from(Buffer.from(s, 'base64')) };
  const SpreadsheetApp = {
    getActive: () => ({ getSheetByName: (n) => (n === 'G' ? mainSheet : null) }), getActiveSpreadsheet() { return this.getActive(); }, flush() {},
    openById: () => { env.calls++; return { getSheetByName: (n) => sheetsH[n] || null }; },
  };
  const ctx = vm.createContext({ SpreadsheetApp, CacheService, Utilities, Session: { getActiveUser: () => ({ getEmail: () => 'osiowy.tomasz@gmail.com' }) }, Logger: { log() {} }, console, Date, JSON, Math, String, Number, Array, Object, parseFloat, isNaN });
  for (const f of ['test/fixtures/Code_Harm.js', 'test/fixtures/Code_GR.js']) vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../backend/Api.gs', import.meta.url), 'utf8'), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { env, ctx, run, store };
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const measure = (env, f) => { const before = env.calls; const r = f(); return { r, calls: env.calls - before }; };

test('Harmonogram: nowa funkcja zwraca te same dane co stara, z kilkukrotnie mniejszą liczbą odczytów', () => {
  const { env, run } = build();
  const old = measure(env, () => run('getHarmData()'));
  const neu = measure(env, () => run('api_readHarmData_()'));
  // nowa funkcja ma dodatkowe pola danych ręcznych (client, startManual, endManual); reszta identyczna jak w starej
  const extra = ['client', 'startManual', 'endManual'];
  const strip = (rows) => plain(rows).map((r) => { const c = { ...r }; extra.forEach((k) => delete c[k]); return c; });
  assert.deepEqual(strip(neu.r.rows), strip(old.r.rows));
  assert.ok(neu.r.rows.every((r) => extra.every((k) => k in r)));
  assert.deepEqual(plain(neu.r.holidays), plain(old.r.holidays));
  assert.deepEqual(plain(neu.r.rapData), plain(old.r.rapData));
  assert.ok(neu.r.rows.length > 30 && Object.keys(neu.r.rapData).length === 2);
  assert.equal(neu.r.rapData['26/100']['3Co'], 14.5);                       // 12,5 + 2
  assert.ok(old.calls >= 18, 'stara: ' + old.calls);
  assert.ok(neu.calls <= 9, 'nowa: ' + neu.calls);
  console.log(`# Harmonogram: odczyty arkusza stara=${old.calls}, nowa=${neu.calls}`);
});

test('Harmonogram: pamięć podręczna (90 s), pomijanie przez fresh, wygasanie', () => {
  const { env, run } = build();
  const a = measure(env, () => run('api_getHarmData_(false)'));
  assert.ok(a.calls > 0);
  const b = measure(env, () => run('api_getHarmData_(false)'));
  assert.equal(b.calls, 0);                                                  // z pamięci: zero odczytów arkusza
  assert.deepEqual(plain(b.r), plain(a.r));
  const c = measure(env, () => run('api_getHarmData_(true)'));
  assert.ok(c.calls > 0);                                                    // fresh pyta arkusz
  env.now += 91;
  const d = measure(env, () => run('api_getHarmData_(false)'));
  assert.ok(d.calls > 0);                                                    // po wygaśnięciu znów odczyt
});

test('Grafik: nowa funkcja zwraca te same dane co stara (z datami i bez), canEdit z uprawnień', () => {
  const { env, run } = build();
  for (const [s, e] of [['', ''], ['2026-11-03', '2026-11-05']]) {
    const old = run(`getGrData('${s}', '${e}')`);
    const neu = run(`api_readGrData_('${s}', '${e}')`);
    assert.deepEqual(plain(neu.rows), plain(old.rows));
    assert.deepEqual(plain(neu.extraValues), plain(old.extraValues));
    assert.deepEqual(plain(neu.extraBackgrounds), plain(old.extraBackgrounds));
    assert.deepEqual(plain(neu.extraFontColors), plain(old.extraFontColors));
  }
  const r = run(`api_getGrData_('2026-11-03', '2026-11-05', { permissions: { grafik: 'write' } }, false)`);
  assert.equal(r.canEdit, true); assert.equal(r.extraValues[0].length, 3);
  assert.equal(run(`api_getGrData_('2026-11-03', '2026-11-05', { permissions: { grafik: 'read' } }, false)`).canEdit, false);
  assert.throws(() => run(`api_getGrData_('2030-01-01', '2030-01-05', { permissions: {} }, false)`), /Nie znaleziono zakresu dat/);
  const oldCalls = measure(env, () => run(`getGrData('2026-11-03', '2026-11-05')`)).calls;
  const newCalls = measure(env, () => run(`api_readGrData_('2026-11-03', '2026-11-05')`)).calls;
  assert.ok(newCalls < oldCalls, `${newCalls} < ${oldCalls}`);
  console.log(`# Grafik: odczyty arkusza stara=${oldCalls}, nowa=${newCalls}`);
});

test('Grafik: pamięć podręczna 45 s, unieważnienie po zapisie z aplikacji, fresh', () => {
  const { env, run } = build();
  const ctxG = "{ permissions: { grafik: 'write' } }";
  const a = measure(env, () => run(`api_getGrData_('2026-11-03', '2026-11-05', ${ctxG}, false)`));
  const b = measure(env, () => run(`api_getGrData_('2026-11-03', '2026-11-05', ${ctxG}, false)`));
  assert.ok(a.calls > 0); assert.equal(b.calls, 0);
  assert.deepEqual(plain(b.r), plain(a.r));
  assert.ok(measure(env, () => run(`api_getGrData_('2026-11-03', '2026-11-05', ${ctxG}, true)`)).calls > 0);
  // zapis z aplikacji unieważnia pamięć
  env.now += 1;
  run(`api_saveGrData_([{ row: 0, col: 0, value: 'ZMIANA' }], '2026-11-03', '2026-11-05')`);   // prawdziwy zapis z aplikacji
  const c = measure(env, () => run(`api_getGrData_('2026-11-03', '2026-11-05', ${ctxG}, false)`));
  assert.ok(c.calls > 0);                                                    // pamięć unieważniona zapisem
  assert.equal(c.r.extraValues[0][0], 'ZMIANA');                             // i odczyt widzi nową wartość
  env.now += 46;
  assert.ok(measure(env, () => run(`api_getGrData_('2026-11-03', '2026-11-05', ${ctxG}, false)`)).calls > 0);   // wygasło
});

test('Pamięć podręczna: duże dane dzielone na kawałki, kompresja, uszkodzony wpis = brak', () => {
  const { run, store } = build();
  run("api_cachePut_('big', { a: Array.from({ length: 60000 }, (_, i) => 'x' + Math.floor(Math.sin(i) * 1e9)) }, 60)");
  const back = run("api_cacheGet_('big')");
  assert.equal(back.a.length, 60000);
  assert.ok(Number(store.get('big').v) >= 1);
  store.get('big:0').v = 'to nie jest base64 gzip';
  assert.equal(run("api_cacheGet_('big')"), null);
  assert.equal(run("api_cacheGet_('nie ma')"), null);
});

test('Biała lista API: getGrData i getHarmData używają szybkich funkcji', () => {
  const api = fs.readFileSync(new URL('../backend/Api.gs', import.meta.url), 'utf8');
  assert.match(api, /api_getGrData_\(a\[0\], a\[1\], ctx, a\[2\] === 'fresh'\)/);
  assert.match(api, /api_getHarmData_\(a\[0\] === 'fresh'\)/);
  assert.match(api, /api_grBump_\(\);\s+\/\/ następny odczyt Grafiku/);
});
