/**
 * Code_MistrzPO.js – rejestry detali, operacji i dokumentacji z arkusza Mistrz_po (używane przez Skaner w aplikacji).
 *
 * ZAPIS TYLKO W BAZIE: rejestry (detali, operacji, dokumentacji), Lista detali i archiwa są w bazie Firebase (Firestore, mp_rows),
 * a nie w arkuszu Google. Skaner (PC i Android) zapisuje wyłącznie do bazy. Arkusz Mistrz_po jest używany tylko na wyraźne polecenie:
 *  - mp_export (import arkusz → baza, tylko GOD) oraz mp_exportToSheet (eksport baza → arkusz, MASTER i GOD).
 * Logika rejestrów (reguły zapisu) jest ta sama co w skrypcie Mistrz_po. Różnice względem oryginału:
 *  - dostęp do bazy przez konto usługi (Firestore REST), arkusz (import/eksport) przez openById,
 *  - operator to e-mail z klucza API (ctx.email), a nie Session.getActiveUser(),
 *  - wszystkie nazwy mają prefiks mp_, żeby nie kolidować z resztą projektu,
 *  - zapisy idą pod blokadą (api_withLock_ przez flagę `write` w API_FUNCS).
 *
 * Uprawnienia: zakładka `Setup` arkusza Mistrz_po, wiersze 3..MP_SETUP_LAST_ROW, jedna kolumna z e-mailami na uprawnienie:
 *   C = „zmień status” i „usuń operację” (jak w oryginale),
 *   D = tworzenie listy detali (zakładka `Lista detali`),
 *   E = rejestr dokumentacji: wyświetlanie i usuwanie wpisów.
 * Zapis detali, operacji i dokumentacji oraz wyświetlanie operacji jest dla wszystkich z kluczem.
 * Uprawnienia są sprawdzane po stronie serwera (FORBIDDEN), przyciski w aplikacji tylko je odzwierciedlają.
 */

var MP_SPREADSHEET_ID = '1IAfvqX05Qf72bpCxAhgqSdutiqduKK7Mi-fP9mozJaM';
var MP_TZ = 'Europe/Warsaw';

var MP_SETUP_SHEET = 'Setup';
var MP_SETUP_FIRST_ROW = 3;
var MP_SETUP_LAST_ROW = 30;
var MP_SETUP_COLS = { manage: 3, details: 4, docs: 5 }; // C, D, E (numery 1-based)

var MP_DETAIL_SHEET = 'Rejestr detali';
var MP_LIST_SHEET = 'Lista detali';
var MP_DETAIL_FIRST_ROW = 1;
var MP_LIST_FIRST_ROW = 2;

var MP_OPER_SHEET = 'Rejestr operacji';
var MP_OPER_FIRST_ROW = 3;
var MP_OPER_FORMULA_SOURCE_ROW = 1; // z tego wiersza kopiowane są formuły K:M
var MP_OPER_STATUSES = ['Start', 'W toku', 'Koniec'];

var MP_DOC_SHEET = 'Rejestr dokumentacji';
var MP_DOC_FIRST_ROW = 3;
var MP_DOC_LIST_LIMIT = 300;
var MP_DETAIL_LIST_LIMIT = 500;

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

function mp_ss_() {
  return SpreadsheetApp.openById(MP_SPREADSHEET_ID);
}

function mp_sheet_(name) {
  var sheet = mp_ss_().getSheetByName(name);
  if (!sheet) throw new Error('Arkusz "' + name + '" nie istnieje!');
  return sheet;
}

/** Tekst między pierwszym wystąpieniem ogranicznika a następnym; '' gdy brak. */
function mp_between_(str, startChar, endChar) {
  str = String(str === undefined || str === null ? '' : str);
  var start = str.indexOf(startChar);
  if (start === -1) return '';
  var end = str.indexOf(endChar, start + 1);
  if (end === -1) return '';
  return str.substring(start + 1, end);
}

function mp_str_(v) {
  return v === undefined || v === null ? '' : String(v);
}




// ---------------------------------------------------------------------------
// Uprawnienia
// ---------------------------------------------------------------------------

function mp_perms_(email) {
  var wanted = mp_str_(email).toLowerCase().trim();
  var perms = { manage: false, details: false, docs: false };
  if (!wanted) return perms;
  var sheet = mp_ss_().getSheetByName(MP_SETUP_SHEET);
  if (!sheet) throw new Error('Arkusz Setup nie istnieje!');
  var rows = MP_SETUP_LAST_ROW - MP_SETUP_FIRST_ROW + 1;
  Object.keys(MP_SETUP_COLS).forEach(function (key) {
    var emails = sheet.getRange(MP_SETUP_FIRST_ROW, MP_SETUP_COLS[key], rows, 1).getValues()
      .map(function (r) { return mp_str_(r[0]).toLowerCase().trim(); })
      .filter(function (e) { return e; });
    perms[key] = emails.indexOf(wanted) !== -1;
  });
  return perms;
}

var MP_PERM_LABELS = {
  manage: 'Brak uprawnień do zmiany statusu i usuwania operacji (wymagany poziom MASTER w kolumnie „Mistrz dostęp”).',
  details: 'Brak uprawnień do tworzenia listy detali.',
  docs: 'Brak uprawnień do rejestru dokumentacji (wyświetlanie i usuwanie).'
};

// Poziom w module Mistrz PO: kolumna „Mistrz dostęp” zakładki Uzytkownicy (GOD / MASTER / CLERIK / TOURIST / ---).
// Zmiana statusu i usuwanie operacji – co najmniej MASTER. Gdy kolumna nie jest jeszcze wypełniona (nikt nie ma poziomu),
// obowiązuje dawna lista z zakładki Setup (kolumna C).
var MP_LEVEL_COLUMN = 'Mistrz dostęp';
var MP_LEVELS = ['none', 'tourist', 'clerik', 'master', 'god'];

/** Poziomy z kolumny „Mistrz dostęp” (e-mail → poziom); puste, gdy kolumny nie ma albo nikt nie ma wpisu. */
function mp_levels_() {
  return typeof api_levelColumn_ === 'function' ? api_levelColumn_(MP_LEVEL_COLUMN) : {};
}

/** Uprawnienia użytkownika: listy z Setup (detale, dokumentacja) i zarządzanie operacjami wg poziomu (min. MASTER). */
function mp_permsFor_(ctx) {
  var perms = mp_perms_(ctx.email);
  var levels = mp_levels_();
  if (Object.keys(levels).length) {
    var lv = levels[mp_str_(ctx.email).toLowerCase().trim()] || 'none';
    perms.level = lv;
    perms.manage = MP_LEVELS.indexOf(lv) >= MP_LEVELS.indexOf('master');
  }
  return perms;
}

function mp_require_(ctx, key) {
  if (!mp_permsFor_(ctx)[key]) throw api_error_('FORBIDDEN', MP_PERM_LABELS[key]);
}

function mp_getPermissions_(ctx) {
  return mp_permsFor_(ctx);
}

/** Jednorazowo (z edytora): kolumna „Mistrz dostęp” z listą wyboru GOD / MASTER / CLERIK / TOURIST / ---. */
function mp_setupLevelColumn() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (!sheet) throw new Error('Brak zakładki ' + API_USERS_SHEET);
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = header.indexOf(MP_LEVEL_COLUMN.toLowerCase()) + 1;
  if (!col) { col = lastCol + 1; sheet.getRange(1, col).setValue(MP_LEVEL_COLUMN).setFontWeight('bold'); }
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(['GOD', 'MASTER', 'CLERIK', 'TOURIST', '---'], true).setAllowInvalid(false).build();
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  return 'Kolumna „' + MP_LEVEL_COLUMN + '” w kolumnie ' + col + ' zakładki ' + API_USERS_SHEET;
}

// ---------------------------------------------------------------------------
// Baza Firebase (Firestore REST, konto usługi): mp_meta/main i mp_rows/{klucz}_{nnn} = { k, r: { "<wiersz>": "<JSON {A:…, B:…}>" } }
// Wiersz = numer wiersza arkusza Mistrz_po; w bazie tylko kolumny wpisywane (kolumny liczone liczy program). Daty: rrrr-mm-dd, godziny: gg:mm.
// ---------------------------------------------------------------------------

var MP_CHUNK = 300;

/** Zakładki modułu: klucz → nazwa zakładki arkusza, pierwszy wiersz danych, ostatnia kolumna, kolumny wpisywane (jak SHEETS w logic/mistrz.js). */
var MP_DEF = {
  ops:       { name: 'Rejestr operacji',       first: 3, cols: 10, input: 'ABCDEFGHIJ' },
  docs:      { name: 'Rejestr dokumentacji',   first: 3, cols: 10, input: 'ABCDEFGHIJ' },
  dreg:      { name: 'Rejestr detali',         first: 3, cols: 8,  input: 'ABCDEFGH' },
  dlist:     { name: 'Lista detali',           first: 3, cols: 16, input: 'ABCDEFGOP' },   // P – „szt zrobione” (liczy i zapisuje program)
  zkom:      { name: 'Z.kom',                  first: 2, cols: 9,  input: 'ABCDEFGHI' },
  opsArch:   { name: 'Archiwum operacji',      first: 3, cols: 10, input: 'ABCDEFGHIJ' },
  docsArch:  { name: 'Ar. dok',                first: 3, cols: 10, input: 'ABCDEFGHIJ' },
  dlistArch: { name: 'Archiwum Lista detali',  first: 3, cols: 16, input: 'ABCDEFGOP' }
};

function mp_keyOfSheet_(name) {
  var found = null;
  Object.keys(MP_DEF).forEach(function (k) { if (MP_DEF[k].name === name || k === name) found = k; });
  return found;
}

function mp_colIndex_(letter) { return letter.charCodeAt(0) - 65; }   // A → 0 (kolumny do Z wystarczą)

function mp_fsBase_() {
  var projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID') || 'harmonohram-zks';
  return 'projects/' + projectId + '/databases/(default)/documents';
}

/** Token konta usługi (zakres datastore), pamiętany w CacheService. */
function mp_fsToken_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get('mp_fs_token');
  if (t) return t;
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('FIREBASE_CLIENT_EMAIL');
  var key = (props.getProperty('FIREBASE_PRIVATE_KEY') || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Brak FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY w Script Properties.');
  var now = Math.floor(Date.now() / 1000);
  var unsigned = api_b64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + api_b64url_(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  var jwt = unsigned + '.' + api_b64url_(Utilities.computeRsaSha256Signature(unsigned, key));
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }, muteHttpExceptions: true
  });
  var j = JSON.parse(r.getContentText() || '{}');
  if (!j.access_token) throw new Error('Brak dostępu do bazy (token konta usługi): ' + r.getContentText().slice(0, 200));
  cache.put('mp_fs_token', j.access_token, 3000);
  return j.access_token;
}

function mp_fsFetch_(method, url, body) {
  var opts = { method: method, headers: { Authorization: 'Bearer ' + mp_fsToken_() }, muteHttpExceptions: true };
  if (body !== undefined) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/' + url, opts);
  var code = r.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error('Błąd bazy (' + code + '): ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText() || '{}');
}

function mp_fsStr_(f) { return f && typeof f.stringValue === 'string' ? f.stringValue : ''; }

/** mp_meta/main → { sheets: { klucz: { rows, n, name } } } (puste, gdy brak). */
function mp_meta_() {
  var d = mp_fsFetch_('GET', mp_fsBase_() + '/mp_meta/main');
  var out = { sheets: {} };
  var sh = d && d.fields && d.fields.sheets && d.fields.sheets.mapValue && d.fields.sheets.mapValue.fields;
  Object.keys(sh || {}).forEach(function (k) {
    var f = (sh[k].mapValue && sh[k].mapValue.fields) || {};
    out.sheets[k] = { rows: Number(f.rows && (f.rows.integerValue || f.rows.doubleValue)) || 0, n: Number(f.n && (f.n.integerValue || f.n.doubleValue)) || 0 };
  });
  return out;
}

function mp_pad3_(n) { return ('00' + n).slice(-3); }

/**
 * Wszystkie wiersze zakładki [key] z bazy: { rows: [{ row, v, chunk }] posortowane po numerze wiersza, chunks: [{ id, idx, count }] }.
 * Paczki mają kolejne numery od 000; czytamy je jednym batchGet (o jedną więcej niż wynika z meta – na wypadek dopisanej).
 */
function mp_loadKey_(key, meta) {
  meta = meta || mp_meta_();
  var m = meta.sheets[key] || { rows: 0, n: 0 };
  var n = Math.max(Math.ceil(m.rows / MP_CHUNK), m.n, 1) + 1;
  var names = [];
  for (var i = 0; i < n; i++) names.push(mp_fsBase_() + '/mp_rows/' + key + '_' + mp_pad3_(i));
  var res = mp_fsFetch_('POST', mp_fsBase_() + ':batchGet', { documents: names }) || [];
  var rows = [], chunks = [];
  res.forEach(function (x) {
    if (!x.found) return;
    var id = x.found.name.split('/').pop(), idx = Number(id.split('_').pop());
    var r = (x.found.fields && x.found.fields.r && x.found.fields.r.mapValue && x.found.fields.r.mapValue.fields) || {};
    var count = 0;
    Object.keys(r).forEach(function (row) {
      var v = {};
      try { v = JSON.parse(mp_fsStr_(r[row])) || {}; } catch (e) { v = {}; }
      rows.push({ row: Number(row), v: v, chunk: id });
      count++;
    });
    chunks.push({ id: id, idx: idx, count: count });
  });
  rows.sort(function (a, b) { return a.row - b.row; });
  chunks.sort(function (a, b) { return a.idx - b.idx; });
  return { rows: rows, chunks: chunks };
}

/** Zapis zmian wierszy jednej paczki: changes = { "<wiersz>": obiekt v | null (usunięcie) }. */
function mp_fsPatchChunk_(key, chunkId, changes) {
  var fields = {}, mask = ['k'];
  Object.keys(changes).forEach(function (row) {
    mask.push('r.`' + row + '`');
    if (changes[row] !== null) fields[row] = { stringValue: JSON.stringify(changes[row]) };
  });
  var url = mp_fsBase_() + '/mp_rows/' + chunkId + '?' + mask.map(function (p) { return 'updateMask.fieldPaths=' + encodeURIComponent(p); }).join('&');
  mp_fsFetch_('PATCH', url, { fields: { k: { stringValue: key }, r: { mapValue: { fields: fields } } } });
}

/** Zapis liczników zakładki w mp_meta/main (rows, n, at) – dane dopisane z programów (np. skaner), bez zmiany źródła importu. */
function mp_fsPatchMeta_(key, rows, n) {
  var f = {};
  f.rows = { integerValue: String(rows) }; f.n = { integerValue: String(n) }; f.at = { integerValue: String(new Date().getTime()) }; f.name = { stringValue: MP_DEF[key].name };
  var url = mp_fsBase_() + '/mp_meta/main?' + ['rows', 'n', 'at', 'name'].map(function (p) { return 'updateMask.fieldPaths=' + encodeURIComponent('sheets.`' + key + '`.' + p); }).join('&');
  mp_fsFetch_('PATCH', url, { fields: { sheets: { mapValue: { fields: (function () { var o = {}; o[key] = { mapValue: { fields: f } }; return o; })() } } } });
}

/** Dopisuje wiersz na końcu zakładki (numer = największy + 1, nie mniejszy niż pierwszy wiersz danych). Zwraca numer wiersza. */
function mp_append_(key, v, loaded) {
  var d = loaded || mp_loadKey_(key);
  var row = MP_DEF[key].first;
  d.rows.forEach(function (r) { if (r.row >= row) row = r.row + 1; });
  var last = d.chunks.length ? d.chunks[d.chunks.length - 1] : null;
  var chunkId, idx;
  if (last && last.count < MP_CHUNK) { chunkId = last.id; idx = last.idx; }
  else { idx = last ? last.idx + 1 : 0; chunkId = key + '_' + mp_pad3_(idx); }
  var ch = {}; ch[row] = v;
  mp_fsPatchChunk_(key, chunkId, ch);
  mp_fsPatchMeta_(key, d.rows.length + 1, Math.max(idx + 1, d.chunks.length));
  d.rows.push({ row: row, v: v, chunk: chunkId });
  if (last && last.id === chunkId) last.count++; else d.chunks.push({ id: chunkId, idx: idx, count: 1 });
  return row;
}

/** Zmienia wartości kolumn istniejącego wiersza (rowObj z mp_loadKey_) – scala [patch] z dotychczasowymi. */
function mp_update_(key, rowObj, patch) {
  var v = {};
  Object.keys(rowObj.v).forEach(function (c) { v[c] = rowObj.v[c]; });
  Object.keys(patch).forEach(function (c) { v[c] = patch[c]; });
  var ch = {}; ch[rowObj.row] = v;
  mp_fsPatchChunk_(key, rowObj.chunk, ch);
  rowObj.v = v;
}

/** Usuwa wiersz z bazy (dane wiersza znikają; numer może zostać użyty ponownie po imporcie). */
function mp_remove_(key, rowObj) {
  var ch = {}; ch[rowObj.row] = null;
  mp_fsPatchChunk_(key, rowObj.chunk, ch);
}

// ---------------------------------------------------------------------------
// Wartości i porównania
// ---------------------------------------------------------------------------

function mp_cell_(rowObj, col) { return mp_str_(rowObj.v[col]); }
function mp_eqv_(a, b) { return mp_str_(a).trim().toLowerCase() === mp_str_(b).trim().toLowerCase(); }

/**
 * Luźny klucz numeru detalu (jak looseKey w logic/mistrz.js): arkusz zamienia niektóre wpisy na daty / liczby, a formuły i tak je łączą –
 * data r-m-d, „m-d” i liczba zapisana tekstem dają ten sam klucz.
 */
function mp_loose_(x) {
  var t = mp_str_(x).trim().toLowerCase();
  var p2 = function (v) { return ('0' + Number(v)).slice(-2); };
  var md = function (m, d) { return (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) ? 'md:' + p2(m) + '-' + p2(d) : null; };
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return md(m[2], m[3]) || t;
  m = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(t);
  if (m) return md(m[2], m[3]) || t;
  m = /^(\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) return md(m[1], m[2]) || t;
  var n = t.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(n) && n.length < 16 ? String(Number(n)) : t;
}
function mp_dkey_(parts) { return parts.map(mp_loose_).join('\u0001'); }
function mp_num_(x) { var t = mp_str_(x).trim().replace(',', '.'); if (t === '') return NaN; return Number(t); }

/** Data (rrrr-mm-dd) → dd.mm.rrrr; godzina z sekundami → gg:mm; inne wartości bez zmian. */
function mp_display_(v) {
  var t = mp_str_(v);
  var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2})(?::\d{2})?)?$/.exec(t);
  if (m) return m[3] + '.' + m[2] + '.' + m[1] + (m[4] ? ' ' + m[4] : '');
  var h = /^(\d{2}:\d{2}):\d{2}$/.exec(t);
  return h ? h[1] : t;
}

function mp_now_() {
  var now = new Date();
  return {
    date: Utilities.formatDate(now, MP_TZ, 'yyyy-MM-dd'),
    time: Utilities.formatDate(now, MP_TZ, 'HH:mm')
  };
}

function mp_shortName_(email) {
  return mp_str_(email).split('@')[0];
}

// ---------------------------------------------------------------------------
// Rejestr detali
// ---------------------------------------------------------------------------

function mp_saveDetail_(form, ctx) {
  form = form || {};
  var code = mp_str_(form.productCode);
  if (!code) throw new Error('Błąd: Brak kodu produktu!');

  var colC = mp_between_(code, '*', '*');   // Komis
  var colG = mp_between_(code, '$', '$');   // Nr rysunku
  var colH = mp_between_(code, '⍵', '⍵');   // Nr pozycji
  var colF = mp_between_(code, '^', '^');   // Nr kompletu
  if (!colC || !colG || !colH || !colF) {
    throw new Error('Błąd: Brak danych w kluczowych polach (Komis, Nr rysunku, Nr pozycji, Wartość F)!');
  }

  var extra = mp_str_(form.extraNotes).trim();
  var extraNum = Number(extra.replace(',', '.'));
  if (extra === '' || isNaN(extraNum) || extraNum < 1) {
    throw new Error("Błąd: Pole 'Ilość sztuk' musi być większe lub równe 1!");
  }

  var meta = mp_meta_();
  var list = mp_loadKey_('dlist', meta).rows;
  if (!list.length) throw new Error('Błąd: Lista detali jest pusta!');
  var detailKey = mp_dkey_([colC, colG, colH, colF]);
  var ordered = null;
  list.forEach(function (r) {   // B komis, D nr rysunku, E nr pozycji, F atrybut, G ilość zlecona
    if (mp_dkey_([r.v.B, r.v.D, r.v.E, r.v.F]) === detailKey) ordered = (ordered || 0) + (Number(mp_str_(r.v.G).replace(',', '.')) || 0);
  });
  if (ordered === null) throw new Error('Detal nie zarejestrowany na liście detali!');

  var reg = mp_loadKey_('dreg', meta);
  var registered = 0;
  reg.rows.forEach(function (r) {
    if (mp_dkey_([r.v.C, r.v.D, r.v.E, r.v.F]) === detailKey) registered += Number(mp_str_(r.v.G).replace(',', '.')) || 0;
  });
  if (registered + extraNum > ordered) {
    throw new Error('Zarejestrowano ' + registered + ' detali, dozwolona ilość: ' + (ordered - registered) + '. Skontaktuj się z Mistrzem PO.');
  }

  var t = mp_now_();
  var newRow = mp_append_('dreg', { A: t.date, B: t.time, C: colC, D: colG, E: colH, F: colF, G: extra, H: ctx.email }, reg);
  // sztuki zlicza i zapisuje program: w wierszu Listy detali kolumna P „szt zrobione” = suma zarejestrowanych sztuk tego detalu
  var total = registered + extraNum, listRow = null;
  list.forEach(function (r) { if (!listRow && mp_dkey_([r.v.B, r.v.D, r.v.E, r.v.F]) === detailKey) listRow = r; });
  if (listRow) mp_update_('dlist', listRow, { P: total });
  return { status: 'success', message: 'Dane zapisane w bazie (wiersz ' + newRow + ', zrobiono ' + total + ' z ' + ordered + ') przez ' + mp_shortName_(ctx.email) };
}

// ---------------------------------------------------------------------------
// Rejestr operacji
// ---------------------------------------------------------------------------

function mp_parseOperCode_(code) {
  code = mp_str_(code);
  return {
    komis: mp_between_(code, '*', '*'),
    przewodnik: mp_between_(code, '#', '#'),
    nr: mp_between_(code, '@', '@'),
    klient: mp_between_(code, '^', '^'),
    rysunek: mp_between_(code, '$', '$')
  };
}

/** Stan operacji (komis, przewodnik, nr): Koniec > W toku > Start (jak kolumna K Rejestru operacji); wpis „Usunięta” ma pusty stan. */
function mp_opStates_(rows) {
  var rank = {};
  rows.forEach(function (r) {
    var st = mp_str_(r.v.I).trim().toLowerCase();
    var k = mp_dkey_([r.v.C, r.v.D, r.v.E]);
    var x = st === 'koniec' ? 3 : st === 'w toku' ? 2 : st === 'start' ? 1 : 0;
    if (x > (rank[k] || 0)) rank[k] = x;
  });
  return function (r) {
    if (mp_str_(r.v.I).trim().toLowerCase() === 'usunięta') return '';
    return ['', 'Start', 'W toku', 'Koniec'][rank[mp_dkey_([r.v.C, r.v.D, r.v.E])] || 0];
  };
}

function mp_opsOut_(rows, statusFn) {
  var out = rows.map(function (r) {
    return { nr: mp_cell_(r, 'E'), komis: mp_cell_(r, 'C'), przewodnik: mp_cell_(r, 'D'), klient: mp_cell_(r, 'F'), operator: mp_cell_(r, 'H'), status: statusFn(r) };
  });
  out.sort(function (a, b) { return a.nr.toLowerCase().localeCompare(b.nr.toLowerCase()); });
  return out;
}

/** Zaległe operacje komisu: status Start i stan operacji (kolumna K) różny od „Koniec”. */
function mp_pendingOperations_(komis) {
  var rows = mp_loadKey_('ops').rows, stateOf = mp_opStates_(rows);
  var k = mp_str_(komis);
  return mp_opsOut_(rows.filter(function (r) { return mp_cell_(r, 'C') === k && mp_cell_(r, 'I') === 'Start' && stateOf(r) !== 'Koniec'; }), stateOf);
}

/** Wszystkie operacje komisu i przewodnika (podgląd); status z kolumny I. */
function mp_displayOperations_(komis, przewodnik) {
  var rows = mp_loadKey_('ops').rows;
  return mp_opsOut_(rows.filter(function (r) { return mp_cell_(r, 'C') === mp_str_(komis) && mp_cell_(r, 'D') === mp_str_(przewodnik); }), function (r) { return mp_cell_(r, 'I'); });
}

/** Aktywne (nieusunięte) operacje o danym komisie, przewodniku i numerze. */
function mp_findOperations_(komis, przewodnik, nr) {
  var rows = mp_loadKey_('ops').rows;
  return mp_opsOut_(rows.filter(function (r) {
    return mp_cell_(r, 'C') === mp_str_(komis) && mp_cell_(r, 'D') === mp_str_(przewodnik) && mp_cell_(r, 'E') === mp_str_(nr) && mp_cell_(r, 'I') !== 'Usunięta';
  }), function (r) { return mp_cell_(r, 'I'); });
}

function mp_saveOperation_(form, ctx) {
  form = form || {};
  if (!mp_str_(form.productCode)) throw new Error('Brak operacji!');

  var p = mp_parseOperCode_(form.productCode);
  if (!p.komis || !p.przewodnik || !p.nr) throw new Error('Brak danych w kluczowych polach (Komis, Przewodnik, Nr operacji)!');

  var status = mp_str_(form.status) || 'Start';
  if (MP_OPER_STATUSES.indexOf(status) === -1) throw new Error('Nieprawidłowy status operacji: ' + status);

  var d = mp_loadKey_('ops');
  var hasStart = false, hasEnd = false;
  d.rows.forEach(function (r) {
    if (mp_cell_(r, 'C') === p.komis && mp_cell_(r, 'D') === p.przewodnik && mp_cell_(r, 'E') === p.nr) {
      var s = mp_cell_(r, 'I');
      if (s === 'Start') hasStart = true;
      if (s === 'Koniec') hasEnd = true;
    }
  });
  if (status === 'Start' && (hasStart || hasEnd)) {
    throw new Error("Operacja (Komis: " + p.komis + ", Przewodnik: " + p.przewodnik + ", Nr operacji: " + p.nr + ") już ma status 'Start' lub jest zakończona!");
  } else if (status === 'W toku' && (!hasStart || hasEnd)) {
    throw new Error("Nie można ustawić 'W toku' - brak 'Start' lub operacja zakończona!");
  } else if (status === 'Koniec' && (!hasStart || hasEnd)) {
    throw new Error("Nie można ustawić 'Koniec' - brak 'Start' lub operacja zakończona!");
  }

  var t = mp_now_();
  var newRow = mp_append_('ops', { A: t.date, B: t.time, C: p.komis, D: p.przewodnik, E: p.nr, F: p.klient, G: p.rysunek, H: ctx.email, I: status, J: mp_str_(form.notes) }, d);
  return { status: 'success', message: 'Dane zapisane w bazie (wiersz ' + newRow + ') przez ' + mp_shortName_(ctx.email) };
}

/** Zmiana statusu zakończonej operacji z powrotem na „W toku” (uprawnienie manage). */
function mp_changeOperationStatus_(form, ctx) {
  mp_require_(ctx, 'manage');
  form = form || {};
  var p = mp_parseOperCode_(form.productCode);
  if (!p.komis || !p.przewodnik || !p.nr) throw new Error('Brak danych w kluczowych polach!');

  var rows = mp_loadKey_('ops').rows, stateOf = mp_opStates_(rows), target = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (mp_cell_(r, 'C') === p.komis && mp_cell_(r, 'D') === p.przewodnik && mp_cell_(r, 'E') === p.nr && mp_cell_(r, 'I') === 'Koniec') {
      if (stateOf(r) !== 'Koniec') throw new Error('Operacja nie jest zakończona (status K: ' + stateOf(r) + ')!');
      target = r;
      break;
    }
  }
  if (!target) throw new Error("Nie znaleziono operacji ze statusem 'Koniec'!");

  var t = mp_now_(), who = mp_shortName_(ctx.email);
  var note = 'Zmiana statusu na W toku: ' + mp_display_(t.date) + ' ' + t.time + ' przez ' + who;
  var current = mp_cell_(target, 'J');
  mp_update_('ops', target, { I: 'W toku', J: current ? current + '; ' + note : note });
  return { status: 'success', message: "Status zmieniony na 'W toku' w wierszu " + target.row + ' przez ' + who };
}

/** Oznacza wszystkie aktywne wiersze operacji jako „Usunięta” (uprawnienie manage); dane zostają w bazie. */
function mp_deleteOperation_(form, ctx) {
  mp_require_(ctx, 'manage');
  form = form || {};
  var p = mp_parseOperCode_(form.productCode);
  if (!p.komis || !p.przewodnik || !p.nr) throw new Error('Brak danych w kluczowych polach!');

  var rows = mp_loadKey_('ops').rows;
  var t = mp_now_(), who = mp_shortName_(ctx.email);
  var note = 'Usunięto: ' + mp_display_(t.date) + ' ' + t.time + ' przez ' + who;
  var hits = rows.filter(function (r) {
    return mp_cell_(r, 'C') === p.komis && mp_cell_(r, 'D') === p.przewodnik && mp_cell_(r, 'E') === p.nr && mp_cell_(r, 'I') !== 'Usunięta';
  });
  if (!hits.length) throw new Error('Nie znaleziono aktywnych operacji!');
  hits.forEach(function (r) { var cur = mp_cell_(r, 'J'); mp_update_('ops', r, { I: 'Usunięta', J: cur ? cur + '; ' + note : note }); });
  return { status: 'success', message: 'Status ' + hits.length + " operacji zmieniony na 'Usunięta' przez " + who };
}

// ---------------------------------------------------------------------------
// Rejestr dokumentacji
// ---------------------------------------------------------------------------

function mp_saveDocument_(form, ctx) {
  form = form || {};
  var code = mp_str_(form.productCode);
  if (!code) throw new Error('Błąd: Brak danych!');

  var colC = mp_between_(code, '*', '*'); // Komis
  var colD = mp_between_(code, '#', '#'); // Nr przewodnika
  var colE = mp_between_(code, '^', '^'); // Typ dokumentu
  var colF = mp_between_(code, '$', '$'); // Nazwa
  var colG = mp_between_(code, '!', '!'); // Nr rysunku
  var colH = mp_between_(code, '~', '~'); // Nr id
  var colI = mp_between_(code, '@', '@'); // Ilość operacji
  if (!colC || !colD || !colE || !colF || !colG || !colH || !colI) {
    throw new Error('Błąd: Nieprawidłowy format kodu. Brak danych w kluczowych polach (Komis, Nr przewodnika, Typ dokumentu, Nazwa, Nr rysunku, Nr id, Ilość operacji). Skanowanie zablokowane!');
  }

  var d = mp_loadKey_('docs');
  var duplicate = d.rows.some(function (r) { return mp_cell_(r, 'C') === colC && mp_cell_(r, 'D') === colD; });
  if (duplicate) {
    throw new Error("Błąd: Dokument o numerze przewodnika '" + colD + "' i numerze komis '" + colC + "' już istnieje w rejestrze!");
  }

  var t = mp_now_();
  var newRow = mp_append_('docs', { A: t.date, B: t.time, C: colC, D: colD, E: colE, F: colF, G: colG, H: colH, I: colI, J: ctx.email }, d);
  return { status: 'success', message: 'Dokument został pomyślnie zapisany w bazie (wiersz: ' + newRow + ') przez: ' + mp_shortName_(ctx.email) };
}

/** Wpisy rejestru dokumentacji, najnowsze na górze (uprawnienie docs). filter: {komis, przewodnik} opcjonalnie. */
function mp_listDocuments_(filter, ctx) {
  mp_require_(ctx, 'docs');
  filter = filter || {};
  var komis = mp_str_(filter.komis).trim();
  var przewodnik = mp_str_(filter.przewodnik).trim();
  var rows = mp_loadKey_('docs').rows;
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < MP_DOC_LIST_LIMIT; i--) {
    var r = rows[i];
    if (komis && mp_cell_(r, 'C') !== komis) continue;
    if (przewodnik && mp_cell_(r, 'D') !== przewodnik) continue;
    out.push({
      row: r.row,
      date: mp_display_(r.v.A), time: mp_display_(r.v.B),
      komis: mp_cell_(r, 'C'), przewodnik: mp_cell_(r, 'D'), typ: mp_cell_(r, 'E'), nazwa: mp_cell_(r, 'F'),
      rysunek: mp_cell_(r, 'G'), id: mp_cell_(r, 'H'), ilosc: mp_cell_(r, 'I'), operator: mp_cell_(r, 'J')
    });
  }
  return out;
}

/**
 * Usuwa wpis rejestru dokumentacji z bazy – uprawnienie docs. form: {row, komis, przewodnik}.
 * Numer wiersza jest sprawdzany z komisem i przewodnikiem, więc wiersz zmieniony od ostatniego odczytu nie zostanie usunięty przez pomyłkę.
 */
function mp_deleteDocument_(form, ctx) {
  mp_require_(ctx, 'docs');
  form = form || {};
  var row = Number(form.row);
  if (!isFinite(row) || row < MP_DOC_FIRST_ROW || Math.floor(row) !== row) throw new Error('Nieprawidłowy numer wiersza.');
  var target = null;
  mp_loadKey_('docs').rows.forEach(function (r) { if (r.row === row) target = r; });
  if (!target) throw new Error('Wpis nie istnieje. Odśwież listę.');
  if (mp_cell_(target, 'C') !== mp_str_(form.komis) || mp_cell_(target, 'D') !== mp_str_(form.przewodnik)) {
    throw new Error('Wiersz w bazie zmienił się od ostatniego odczytu. Odśwież listę.');
  }
  console.log('[Mistrz PO] Usunięto dokument, wiersz ' + row + ' (' + JSON.stringify(target.v) + ') przez ' + ctx.email);
  mp_remove_('docs', target);
  return { status: 'success', message: 'Usunięto wpis z wiersza ' + row + ' przez ' + mp_shortName_(ctx.email) };
}

// ---------------------------------------------------------------------------
// Lista detali (uprawnienie details)
// ---------------------------------------------------------------------------

function mp_listDetails_(ctx) {
  mp_require_(ctx, 'details');
  var rows = mp_loadKey_('dlist').rows;
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < MP_DETAIL_LIST_LIMIT; i--) {
    var r = rows[i];
    if (!(mp_cell_(r, 'B') || mp_cell_(r, 'D') || mp_cell_(r, 'E'))) continue;
    out.push({ row: r.row, komis: mp_cell_(r, 'B'), rysunek: mp_cell_(r, 'D'), pozycja: mp_cell_(r, 'E'), komplet: mp_cell_(r, 'F'), ilosc: mp_cell_(r, 'G') });
  }
  return out;
}

/**
 * Dodaje pozycję do listy detali (baza). form: {komis, rysunek, pozycja, komplet, ilosc}.
 * Zapisywane są kolumny B (komis) i D:G (rysunek, pozycja, komplet, ilość zlecona).
 */
function mp_addDetail_(form, ctx) {
  mp_require_(ctx, 'details');
  form = form || {};
  var komis = mp_str_(form.komis).trim();
  var rysunek = mp_str_(form.rysunek).trim();
  var pozycja = mp_str_(form.pozycja).trim();
  var komplet = mp_str_(form.komplet).trim();
  var iloscText = mp_str_(form.ilosc).trim().replace(',', '.');
  var ilosc = Number(iloscText);
  if (!komis || !rysunek || !pozycja || !komplet) throw new Error('Uzupełnij komis, nr rysunku, nr pozycji i nr kompletu.');
  if (iloscText === '' || isNaN(ilosc) || ilosc < 1 || Math.floor(ilosc) !== ilosc) {
    throw new Error('Ilość zlecona musi być liczbą całkowitą większą lub równą 1.');
  }

  var d = mp_loadKey_('dlist');
  var key = [komis, rysunek, pozycja, komplet].join('|');
  var dup = null;
  d.rows.forEach(function (r) {
    if (!dup && [mp_cell_(r, 'B'), mp_cell_(r, 'D'), mp_cell_(r, 'E'), mp_cell_(r, 'F')].join('|') === key) dup = r;
  });
  if (dup) throw new Error('Taki detal jest już na liście (wiersz ' + dup.row + ', ilość zlecona ' + mp_cell_(dup, 'G') + ').');

  var newRow = mp_append_('dlist', { B: komis, D: rysunek, E: pozycja, F: komplet, G: ilosc }, d);
  return { status: 'success', message: 'Dodano detal do listy w bazie (wiersz ' + newRow + ') przez ' + mp_shortName_(ctx.email) };
}

/**
 * Przeliczenie „szt zrobione” (kolumna P Listy detali) dla wszystkich pozycji: suma kolumny G Rejestru detali wg komisu, rysunku, pozycji i kompletu.
 * Zapisuje tylko zmienione wiersze (jedno zapisanie na paczkę). Zwraca { checked, changed }. Poziom MASTER lub GOD (sprawdza Api.gs).
 */
function mp_recountDetails_() {
  var meta = mp_meta_();
  var list = mp_loadKey_('dlist', meta).rows, reg = mp_loadKey_('dreg', meta).rows;
  var done = {};
  reg.forEach(function (r) {
    var g = mp_num_(r.v.G);
    if (isFinite(g)) { var k = mp_dkey_([r.v.C, r.v.D, r.v.E, r.v.F]); done[k] = (done[k] || 0) + g; }
  });
  var byChunk = {}, changed = 0, seen = {};
  list.forEach(function (r) {
    if (!(mp_cell_(r, 'B') || mp_cell_(r, 'D') || mp_cell_(r, 'E'))) return;
    var k = mp_dkey_([r.v.B, r.v.D, r.v.E, r.v.F]);
    var total = seen[k] ? 0 : (done[k] || 0);   // przy zdublowanej pozycji sztuki liczy tylko pierwsza
    seen[k] = true;
    if (mp_str_(r.v.P) === String(total)) return;
    var v = {}; Object.keys(r.v).forEach(function (c) { v[c] = r.v[c]; }); v.P = total;
    (byChunk[r.chunk] = byChunk[r.chunk] || {})[r.row] = v;
    changed++;
  });
  Object.keys(byChunk).forEach(function (id) { mp_fsPatchChunk_('dlist', id, byChunk[id]); });
  return { checked: list.length, changed: changed, message: 'Przeliczono sztuki zrobione: zmieniono ' + changed + ' z ' + list.length + ' pozycji Listy detali.' };
}

// ---------------------------------------------------------------------------
// Import arkusz → baza (tylko GOD) i eksport baza → arkusz (MASTER, GOD)
// ---------------------------------------------------------------------------

/** Wartość komórki do bazy: data → rrrr-mm-dd, sama godzina → gg:mm(:ss), data z godziną → „rrrr-mm-dd gg:mm”. */
function mp_exportValue_(v, tz) {
  if (!(v instanceof Date)) return v;
  var hms = Utilities.formatDate(v, tz, 'HH:mm:ss').replace(/:00$/, '');
  if (Utilities.formatDate(v, tz, 'yyyy') === '1899') return hms;
  var d = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return hms === '00:00' ? d : d + ' ' + hms;
}

/**
 * Import: { sheets: { nazwa zakładki: [[wartości wiersza od kolumny A], …] od wiersza 1 } } – formuły i tak pomija program.
 * [only] – klucz albo nazwa jednej zakładki (import jednego rejestru / listy); bez parametru – wszystkie zakładki modułu.
 */
function mp_export_(only) {
  var ss = mp_ss_(), tz = ss.getSpreadsheetTimeZone(), out = {};
  var want = only ? mp_keyOfSheet_(only) : null;
  if (only && !want) throw new Error('Nieznana zakładka: ' + only);
  Object.keys(MP_DEF).forEach(function (k) {
    if (want && k !== want) return;
    var x = MP_DEF[k], sh = ss.getSheetByName(x.name);
    if (!sh || sh.getLastRow() < 1) return;
    var w = Math.min(x.cols, sh.getMaxColumns());   // zakładka może nie mieć jeszcze kolumny P („szt zrobione”)
    out[x.name] = sh.getRange(1, 1, sh.getLastRow(), w).getValues().map(function (row) {
      return row.map(function (v) { return mp_exportValue_(v, tz); });
    });
  });
  return { sheets: out, exportedAt: new Date().getTime() };
}

/** Komórka z bazy → wartość do arkusza: daty ISO jako Date (format komórki zostaje), reszta bez zmian. */
function mp_sheetValue_(v) {
  if (v === undefined || v === null) return '';
  var t = String(v);
  var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  return typeof v === 'number' ? v : t;
}

/**
 * Eksport baza → arkusz dla jednej zakładki ([only] – klucz albo nazwa): czyści kolumny wpisywane (od pierwszego wiersza danych)
 * i wpisuje wiersze z bazy pod tymi samymi numerami wierszy; kolumny liczone (formuły) zostają. Dla Rejestru operacji kopiuje formuły K:M
 * z wiersza 1 na wszystkie wiersze danych (jak robił skaner). Poziom MASTER lub GOD (sprawdza Api.gs).
 */
function mp_exportToSheet_(only) {
  var key = mp_keyOfSheet_(only);
  if (!key) throw new Error('Nieznana zakładka: ' + only);
  var def = MP_DEF[key];
  var sheet = mp_sheet_(def.name);
  var rows = mp_loadKey_(key).rows;
  var maxRow = def.first - 1;
  rows.forEach(function (r) { if (r.row > maxRow) maxRow = r.row; });
  var lastRow = Math.max(sheet.getLastRow(), maxRow);
  var n = lastRow - def.first + 1;
  if (n < 1) return { sheet: def.name, rows: 0, message: 'Brak danych do eksportu.' };

  // zakładka Listy detali dostaje kolumnę P „szt zrobione”, jeśli jej nie ma
  if (sheet.getMaxColumns() < def.cols) sheet.insertColumnsAfter(sheet.getMaxColumns(), def.cols - sheet.getMaxColumns());
  if ((key === 'dlist' || key === 'dlistArch') && !mp_str_(sheet.getRange(def.first - 1, 16).getValue())) sheet.getRange(def.first - 1, 16).setValue('szt zrobione');
  // grupy kolumn wpisywanych (ciągłe zakresy): np. ABCDEFGOP → A–G i O–P
  var groups = [], cur = null;
  def.input.split('').forEach(function (L) {
    var c = L.charCodeAt(0) - 64;
    if (cur && c === cur.to + 1) cur.to = c; else { cur = { from: c, to: c }; groups.push(cur); }
  });
  var byRow = {};
  rows.forEach(function (r) { byRow[r.row] = r.v; });
  groups.forEach(function (g) {
    var width = g.to - g.from + 1;
    var grid = [];
    for (var i = 0; i < n; i++) {
      var v = byRow[def.first + i] || {}, line = [];
      for (var c = 0; c < width; c++) line.push(mp_sheetValue_(v[String.fromCharCode(64 + g.from + c)]));
      grid.push(line);
    }
    var rg = sheet.getRange(def.first, g.from, n, width);
    rg.clearContent();
    rg.setValues(grid);
  });
  SpreadsheetApp.flush();
  if (key === 'ops') {   // formuły K:M z wiersza 1 na wszystkie wiersze danych (jak przy dopisywaniu przez skaner)
    var src = sheet.getRange(MP_OPER_FORMULA_SOURCE_ROW, 11, 1, 3);
    src.copyTo(sheet.getRange(def.first, 11, n, 3), { contentsOnly: false });
    SpreadsheetApp.flush();
  }
  return { sheet: def.name, rows: rows.length, message: 'Wyeksportowano ' + rows.length + ' wierszy do zakładki „' + def.name + '”.' };
}

function mp_selfTest() {
  var problems = [];
  var ss;
  try {
    ss = mp_ss_();
    Logger.log('Arkusz: ' + ss.getName());
  } catch (e) {
    return 'PROBLEMY: brak dostępu do arkusza Mistrz_po: ' + e.message;
  }
  [MP_SETUP_SHEET, MP_DETAIL_SHEET, MP_LIST_SHEET, MP_OPER_SHEET, MP_DOC_SHEET].forEach(function (name) {
    if (!ss.getSheetByName(name)) problems.push('Brak zakładki: ' + name);
  });
  try {
    Logger.log('Uprawnienia ' + Session.getEffectiveUser().getEmail() + ': ' + JSON.stringify(mp_perms_(Session.getEffectiveUser().getEmail())));
  } catch (e) {
    problems.push('Setup: ' + e.message);
  }
  try {
    var d = mp_loadKey_('ops');
    Logger.log('Baza: Rejestr operacji – wierszy: ' + d.rows.length + ', paczek: ' + d.chunks.length);
  } catch (e) {
    problems.push('Baza Firebase (mp_rows): ' + e.message);
  }
  var result = problems.length ? 'PROBLEMY:\n- ' + problems.join('\n- ') : 'OK: Mistrz PO gotowy (zapis w bazie)';
  Logger.log(result);
  return result;
}

// ---------------------------------------------------------------------------
// Skaner: podgląd rejestrów z bazy (wartości liczone jak formuły arkusza – status, postęp, start i koniec obróbki)
// ---------------------------------------------------------------------------

function mp_eq_(a, b) { return mp_str_(a).toLowerCase() === mp_str_(b).toLowerCase(); }

/** Czas z kolumn A (rrrr-mm-dd) i B (gg:mm) → ms UTC albo null (jak stamp w logic/mistrz.js). */
function mp_stamp_(a, b) {
  var d = /^(\d{4})-(\d{2})-(\d{2})/.exec(mp_str_(a)); if (!d) return null;
  var t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(mp_str_(b)) || /\s(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(mp_str_(a));
  return Date.UTC(+d[1], +d[2] - 1, +d[3], t ? +t[1] : 0, t ? +t[2] : 0, t && t[3] ? +t[3] : 0);
}
function mp_fmtStamp_(ms) {
  if (ms === null || ms === undefined || ms === '') return '';
  var d = new Date(ms), p = function (n) { return ('0' + n).slice(-2); };
  return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

/** Indeks operacji dla dokumentów: zakończone (oper. 10), start oper. 10, koniec każdej oper. – na (komis, przewodnik). */
function mp_docIndex_(list) {
  var done = {}, start = {}, end = {}, cnt = {};
  list.forEach(function (r) { if (mp_eq_(r.v.I, 'koniec')) { var k = mp_dkey_([r.v.C, r.v.D]); cnt[k] = (cnt[k] || 0) + 1; } });
  list.forEach(function (r) {
    var k = mp_dkey_([r.v.C, r.v.D]), e = mp_num_(r.v.E), st = mp_str_(r.v.I).trim().toLowerCase();
    if (e === 10 && st === 'koniec') (done[k] = done[k] || []).push(cnt[k] || 0);
    if (e === 10 && st === 'start' && !(k in start)) start[k] = mp_stamp_(r.v.A, r.v.B);
    if (st === 'koniec') { var ek = k + '\u0001' + e; if (!(ek in end)) end[ek] = mp_stamp_(r.v.A, r.v.B); }
  });
  return { done: done, start: start, end: end };
}

/** Wartości liczone dokumentu (jak computeDocs): status „x / ilość”, postęp, start, godziny, koniec. */
function mp_docCalc_(r, a, b) {
  var k = mp_dkey_([r.v.C, r.v.D]), ok = mp_str_(r.v.C).trim() && mp_str_(r.v.D).trim() && mp_str_(r.v.I).trim(), n = mp_num_(r.v.I);
  var K = '', M = null;
  if (ok) {
    if (a.done[k]) { K = a.done[k].join('') + ' / ' + mp_str_(r.v.I); M = isFinite(n) && n ? a.done[k][0] / n : 0; }
    else if (b.done[k]) { K = 'Ar :' + b.done[k].join('') + ' / ' + mp_str_(r.v.I); M = isFinite(n) && n ? b.done[k][0] / n : 0; }
    else { K = '0 / ' + mp_str_(r.v.I); M = 0; }
  }
  var N = (k in a.start) ? a.start[k] : (k in b.start) ? b.start[k] : null;
  var ek = k + '\u0001' + (isFinite(n) ? n * 10 : NaN);
  var P = (ek in a.end) ? a.end[ek] : (ek in b.end) ? b.end[ek] : null;
  var O = (P === null || N === null) ? '' : (P - N) / 3600000;
  return { K: K, M: M, N: N, O: O, P: P };
}

/**
 * q = { komis, przewodnik, detailKomis }. Wynik (jak dawniej z arkusza, teraz z bazy):
 *  docs  – dokumenty komisu z Rejestru dokumentacji i Ar. dok (data, godz, nr, rodzaj, nazwa, ilość oper, kto, status, postęp, start, koniec, godziny),
 *  ops   – wpisy operacji przewodnika z Rejestru operacji i Archiwum operacji (data, godz, nr, operator, status I, stan operacji),
 *  dreg  – wpisy Rejestru detali komisu detalu (data, godz, rysunek, poz., kpl, szt, operator, postęp, do zrobienia, zrobione).
 */
function mp_scanInfo_(q) {
  var komis = mp_str_(q.komis), prz = mp_str_(q.przewodnik), dk = mp_str_(q.detailKomis);
  var out = { docs: [], ops: [], dreg: [] };
  var meta = mp_meta_();
  var need = {};
  if (komis) { need.docs = 1; need.docsArch = 1; need.ops = 1; need.opsArch = 1; }
  if (komis && prz) { need.ops = 1; need.opsArch = 1; }
  if (dk) { need.dreg = 1; need.dlist = 1; }
  var data = {};
  Object.keys(need).forEach(function (k) { data[k] = mp_loadKey_(k, meta).rows; });
  if (komis) {
    var a = mp_docIndex_(data.ops), b = mp_docIndex_(data.opsArch);
    [['docs', false], ['docsArch', true]].forEach(function (x) {
      data[x[0]].forEach(function (r) {
        if (!mp_eq_(r.v.C, komis)) return;
        var c = mp_docCalc_(r, a, b);
        out.docs.push({ archive: x[1], row: r.row, date: mp_display_(r.v.A), time: mp_display_(r.v.B), komis: mp_str_(r.v.C), nr: mp_str_(r.v.D), typ: mp_str_(r.v.E), nazwa: mp_str_(r.v.F),
          ilosc: mp_str_(r.v.I), kto: mp_str_(r.v.J), status: c.K, progress: typeof c.M === 'number' ? c.M : null, start: mp_fmtStamp_(c.N),
          hours: c.O === '' ? '' : String(Math.round(c.O * 100) / 100).replace('.', ','), end: mp_fmtStamp_(c.P) });
      });
    });
  }
  if (komis && prz) {
    var stateOf = mp_opStates_(data.ops);
    [['ops', false], ['opsArch', true]].forEach(function (x) {
      data[x[0]].forEach(function (r) {
        if (!mp_eq_(r.v.C, komis) || !mp_eq_(r.v.D, prz)) return;
        out.ops.push({ archive: x[1], row: r.row, date: mp_display_(r.v.A), time: mp_display_(r.v.B), nr: mp_str_(r.v.E), operator: mp_str_(r.v.H), status: mp_str_(r.v.I), statusG: x[1] ? '' : stateOf(r) });
      });
    });
  }
  if (dk) {
    var todo = {}, done = {};
    data.dlist.forEach(function (r) { var g = mp_num_(r.v.G); if (isFinite(g)) { var k = mp_dkey_([r.v.D, r.v.E, r.v.F]); todo[k] = (todo[k] || 0) + g; } });
    data.dreg.forEach(function (r) { var g = mp_num_(r.v.G); if (isFinite(g)) { var k = mp_dkey_([r.v.C, r.v.D, r.v.E, r.v.F]); done[k] = (done[k] || 0) + g; } });
    data.dreg.forEach(function (r) {
      if (!mp_eq_(r.v.C, dk)) return;
      var J = mp_str_(r.v.D).trim() === '' ? '' : (todo[mp_dkey_([r.v.D, r.v.E, r.v.F])] || 0);
      var K = mp_str_(r.v.C).trim() === '' ? '' : (done[mp_dkey_([r.v.C, r.v.D, r.v.E, r.v.F])] || 0);
      out.dreg.push({ row: r.row, date: mp_display_(r.v.A), time: mp_display_(r.v.B), rysunek: mp_str_(r.v.D), poz: mp_str_(r.v.E), kpl: mp_str_(r.v.F), szt: mp_str_(r.v.G), operator: mp_str_(r.v.H),
        progress: typeof J === 'number' && typeof K === 'number' && J ? K / J : null, todo: String(J), done: String(K) });
    });
  }
  return out;
}
