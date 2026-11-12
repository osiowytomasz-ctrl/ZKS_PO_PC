/**
 * Firebase.gs — wydawanie tokenów logowania do Firebase (Firestore) dla zalogowanych użytkowników API
 * oraz poziom dostępu do Harmonogramu z zakładki `Uzytkownicy`.
 *
 * Wymaga Script Properties (Ustawienia projektu → Właściwości skryptu):
 *   FIREBASE_CLIENT_EMAIL  — client_email z klucza konta usługi
 *   FIREBASE_PRIVATE_KEY   — private_key z klucza konta usługi
 *   FIREBASE_PROJECT_ID    — (opcjonalnie) domyślnie 'harmonohram-zks'
 *
 * Token ważny 1 godzinę; aplikacja odnawia go sama. Claims w tokenie (używane w regułach Firestore):
 *   plan: 'none'|'read'|'write', grafik: 'none'|'read'|'write',
 *   harm: 'god'|'master'|'clerik'|'tourist'|'none' — poziom dostępu do Harmonogramu.
 *
 * Poziomy Harmonogramu (kolumna „Harmonogram” w zakładce Uzytkownicy):
 *   GOD     – przeglądanie, dodawanie, edycja, usuwanie, kolory i czcionki operacji, kolory stanowisk, święta
 *   MASTER  – przeglądanie, dodawanie, edycja
 *   CLERIK  – przeglądanie, dodawanie
 *   TOURIST – przeglądanie
 *   ---     – brak dostępu
 * Pusta komórka (albo brak kolumny): administrator (API_ADMIN_EMAIL) = GOD, „zapis” w Planie lub Grafiku = MASTER,
 * „odczyt” w Planie lub Grafiku = TOURIST, w pozostałych przypadkach brak dostępu.
 *
 * W Api.gs (API_FUNCS) musi być:
 *   firebaseToken: { run: function (a, ctx) { return api_firebaseToken_(ctx); } },
 * Jednorazowo (opcjonalnie) uruchom w edytorze api_setupHarmonogramColumn – doda kolumnę „Harmonogram” z listą wyboru.
 */

var HARM_COLUMN = 'Harmonogram';
var HARM_LEVELS = { 'GOD': 'god', 'MASTER': 'master', 'CLERIK': 'clerik', 'TOURIST': 'tourist', '---': 'none' };
var HARM_CACHE_SECONDS = 300;   // zmiany w zakładce Uzytkownicy działają po max. 5 min (jak pozostałe uprawnienia)

function api_b64url_(input) {
  var s = typeof input === 'string'
    ? Utilities.base64EncodeWebSafe(input, Utilities.Charset.UTF_8)
    : Utilities.base64EncodeWebSafe(input);
  return s.replace(/=+$/, '');
}

/** Tekst z komórki → poziom ('god'…'none'); null = pusta komórka (poziom domyślny). */
function api_parseHarmLevel_(text) {
  var t = String(text || '').trim().toUpperCase();
  if (!t) return null;
  if (/^-+$/.test(t)) return 'none';
  return HARM_LEVELS[t] || 'none';   // nieznany wpis = brak dostępu (bezpieczniej)
}

/** Mapa email → poziom z kolumny „Harmonogram” (tylko wypełnione komórki). Pamięć podręczna 5 min. */
function api_harmLevels_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('harm_levels_v1');
  if (cached) return JSON.parse(cached);
  var map = {};
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (sheet && sheet.getLastRow() >= 2) {
    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var col = header.indexOf(HARM_COLUMN.toLowerCase());
    if (col >= 0) {
      values.slice(1).forEach(function (row) {
        var email = String(row[0] || '').trim().toLowerCase();
        var level = api_parseHarmLevel_(row[col]);
        if (email && level) map[email] = level;
      });
    }
  }
  cache.put('harm_levels_v1', JSON.stringify(map), HARM_CACHE_SECONDS);
  return map;
}

/** Poziom dostępu do Harmonogramu dla użytkownika z ctx (patrz opis na górze pliku). */
function api_harmLevel_(ctx) {
  var email = String((ctx && ctx.email) || '').trim().toLowerCase();
  var level = api_harmLevels_()[email];
  if (level) return level;
  if (typeof API_ADMIN_EMAIL !== 'undefined' && email === String(API_ADMIN_EMAIL).toLowerCase()) return 'god';
  var p = (ctx && ctx.permissions) || {};
  if (p.plan === 'write' || p.grafik === 'write') return 'master';
  if (p.plan === 'read' || p.grafik === 'read') return 'tourist';
  return 'none';
}

function api_firebaseToken_(ctx) {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('FIREBASE_CLIENT_EMAIL');
  var key = props.getProperty('FIREBASE_PRIVATE_KEY');
  var projectId = props.getProperty('FIREBASE_PROJECT_ID') || 'harmonohram-zks';
  if (!email || !key) throw new Error('Brak FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY w Script Properties.');
  key = key.replace(/\\n/g, '\n');

  var now = Math.floor(Date.now() / 1000);
  var perms = (ctx && ctx.permissions) || {};
  var harm = api_harmLevel_(ctx);
  var uid = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(ctx.email || ctx.name || 'user'))
  ).replace(/=+$/, '').slice(0, 28);

  var header = api_b64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var payload = api_b64url_(JSON.stringify({
    iss: email,
    sub: email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid: uid,
    claims: { plan: perms.plan || 'none', grafik: perms.grafik || 'none', harm: harm, name: ctx.name || '' }
  }));
  var unsigned = header + '.' + payload;
  var sig = api_b64url_(Utilities.computeRsaSha256Signature(unsigned, key));
  return { token: unsigned + '.' + sig, projectId: projectId, expiresAt: (now + 3600) * 1000, uid: uid, harm: harm };
}

/**
 * Jednorazowo (z edytora): dodaje w zakładce Uzytkownicy kolumnę „Harmonogram” (jeśli jej nie ma) z listą wyboru
 * GOD / MASTER / CLERIK / TOURIST / ---. Nie wypełnia komórek – pusta komórka = poziom domyślny (opis na górze pliku).
 */
function api_setupHarmonogramColumn() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (!sheet) throw new Error('Brak zakładki ' + API_USERS_SHEET);
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = header.indexOf(HARM_COLUMN.toLowerCase()) + 1;
  if (!col) { col = lastCol + 1; sheet.getRange(1, col).setValue(HARM_COLUMN).setFontWeight('bold'); }
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(['GOD', 'MASTER', 'CLERIK', 'TOURIST', '---'], true).setAllowInvalid(false).build();
  sheet.getRange(2, col, rows, 1).setDataValidation(rule);
  CacheService.getScriptCache().remove('harm_levels_v1');
  return 'Kolumna „' + HARM_COLUMN + '” w kolumnie ' + col + ' zakładki ' + API_USERS_SHEET;
}
