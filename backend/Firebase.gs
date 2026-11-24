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
 *   grl:  'god'|'master'|'clerik'|'tourist'|'none' — poziom Grafiku i Kompetencji (kolumna „Grafik dostęp”, opis niżej).
 *   tl:   'god'|'master'|'clerik'|'tourist'|'none' — poziom w Narzędziowni (kolumna „Narzędziownia”; pusta komórka = jak „Grafik dostęp”).
 *
 * Poziomy Harmonogramu (kolumna „Harmonogram” w zakładce Uzytkownicy):
 *   GOD     – przeglądanie, dodawanie, edycja, usuwanie, kolory i czcionki operacji, kolory stanowisk, święta
 *   MASTER  – przeglądanie, dodawanie, edycja
 *   CLERIK  – przeglądanie, dodawanie
 *   TOURIST – przeglądanie
 *   ---     – brak dostępu
 * Pusta komórka (albo brak kolumny): administrator (API_ADMIN_EMAIL) = GOD, „zapis” w Planie lub Grafiku = MASTER,
 * „odczyt” w Planie lub Grafiku = TOURIST, w pozostałych przypadkach brak dostępu.
 * Poziom jest czytany z karty przy KAŻDYM wydaniu tokenu (bez pamięci podręcznej) – aplikacje pobierają nowy token
 * przy każdym wejściu w Harmonogram, więc zmiana w karcie działa od razu.
 *
 * W Api.gs (API_FUNCS) musi być:
 *   firebaseToken: { run: function (a, ctx) { return api_firebaseToken_(ctx); } },
 * Jednorazowo (opcjonalnie) uruchom w edytorze api_setupHarmonogramColumn – doda kolumnę „Harmonogram” z listą wyboru.
 */

var HARM_COLUMN = 'Harmonogram';
var HARM_LEVELS = { 'GOD': 'god', 'MASTER': 'master', 'CLERIK': 'clerik', 'TOURIST': 'tourist', '---': 'none' };

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

/** Mapa email → poziom z kolumny „Harmonogram” (tylko wypełnione komórki), czytana z karty za każdym razem. */
function api_harmLevels_() { return api_levelColumn_(HARM_COLUMN); }

/** Mapa email → poziom z kolumny poziomów [name] zakładki Uzytkownicy (tylko wypełnione komórki). */
function api_levelColumn_(name) {
  var map = {};
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (sheet && sheet.getLastRow() >= 2) {
    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var col = header.indexOf(String(name).toLowerCase());
    if (col >= 0) {
      values.slice(1).forEach(function (row) {
        var email = String(row[0] || '').trim().toLowerCase();
        var level = api_parseHarmLevel_(row[col]);
        if (email && level) map[email] = level;
      });
    }
  }
  return map;
}

/** Poziom dostępu do Harmonogramu dla użytkownika z ctx (patrz opis na górze pliku). */
function api_harmLevel_(ctx) {
  var email = String((ctx && ctx.email) || '').trim().toLowerCase();
  var level = api_harmLevels_()[email];
  if (level) return level;
  return api_harmDefault_(ctx, email);
}

/** Poziom dla pustej komórki „Harmonogram”. */
function api_harmDefault_(ctx, email) {
  if (typeof API_ADMIN_EMAIL !== 'undefined' && email === String(API_ADMIN_EMAIL).toLowerCase()) return 'god';
  var p = (ctx && ctx.permissions) || {};
  if (p.plan === 'write' || p.grafik === 'write') return 'master';
  if (p.plan === 'read' || p.grafik === 'read') return 'tourist';
  return 'none';
}

// ---------------------------------------------------------------------------------------------------------------------
// Poziomy Grafiku i Kompetencji (kolumna „Grafik dostęp” → claim `grl` w tokenie, pole `grafikLevel` w api_whoami):
//   GOD     – wszystko (także import z karty G)
//   MASTER  – wszystko poza importem z karty G: edycja wpisów, pracownicy, urlopy, podsumowania, widok z arkusza, Kompetencje
//   CLERIK  – Grafik: wpisy zmian i komentarze; bez kolumn Urlopy / Godziny / Absencje, bez importu i widoku z arkusza; bez Kompetencji
//   TOURIST – Grafik: tylko przeglądanie, bez podsumowań; bez Kompetencji
//   ---     – brak dostępu
// Pusta komórka: administrator = GOD, „zapis” w kolumnie Grafik = MASTER, „odczyt” = TOURIST, inaczej brak dostępu.
// ---------------------------------------------------------------------------------------------------------------------
var GRAFIK_LEVEL_COLUMN = 'Grafik dostęp';

function api_grafikLevel_(ctx) {
  var email = String((ctx && ctx.email) || '').trim().toLowerCase();
  var level = api_levelColumn_(GRAFIK_LEVEL_COLUMN)[email];
  if (level) return level;
  if (typeof API_ADMIN_EMAIL !== 'undefined' && email === String(API_ADMIN_EMAIL).toLowerCase()) return 'god';
  var p = (ctx && ctx.permissions) || {};
  if (p.grafik === 'write') return 'master';
  if (p.grafik === 'read') return 'tourist';
  return 'none';
}

/** Wymagany poziom Grafiku (ranga: tourist < clerik < master < god); inaczej błąd. */
function api_requireGrafikLevel_(ctx, min) {
  var order = ['none', 'tourist', 'clerik', 'master', 'god'];
  var lv = api_grafikLevel_(ctx);
  if (order.indexOf(lv) < order.indexOf(min)) throw new Error('Brak uprawnień w Grafiku (wymagany poziom ' + min.toUpperCase() + ', masz ' + lv.toUpperCase() + ').');
  return lv;
}

// ---------------------------------------------------------------------------------------------------------------------
// Poziom w Narzędziowni (kolumna „Narzędziownia” → claim `tl` w tokenie, pole `toolroomLevel` w api_whoami). Osobny od Grafiku: narzędziowiec ma
// tu np. GOD, a inne uprawnienia gdzie indziej. Uprawnienia będą rozwijane szczegółowo (na razie opis w src/renderer/js/logic/toolroomAccess.js):
//   GOD – wszystko w Narzędziowni, w tym edycja konturów i układu płytek; MASTER – przegląda wszystko, składa narzędzia, pożycza (ToolTrack), Zakupy;
//   CLERIK – ToolBuilder, Assem.Tool, ToolTrack, Części; TOURIST i brak – bez Narzędziowni i Zakupów.
// Pusta komórka (albo brak kolumny): poziom jest taki jak w „Grafik dostęp” (żeby nic się nie zmieniło, dopóki kolumna nie jest wypełniona).
// ---------------------------------------------------------------------------------------------------------------------
var TOOLROOM_LEVEL_COLUMN = 'Narzędziownia';

function api_toolroomLevel_(ctx) {
  var email = String((ctx && ctx.email) || '').trim().toLowerCase();
  var level = api_levelColumn_(TOOLROOM_LEVEL_COLUMN)[email];
  if (level) return level;
  return api_grafikLevel_(ctx);
}

/** Jednorazowo (z edytora): kolumna „Narzędziownia” z listą wyboru GOD / MASTER / CLERIK / TOURIST / ---. Pusta komórka = poziom z „Grafik dostęp”. */
function api_setupToolroomLevelColumn() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (!sheet) throw new Error('Brak zakładki ' + API_USERS_SHEET);
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = header.indexOf(TOOLROOM_LEVEL_COLUMN.toLowerCase()) + 1;
  if (!col) { col = lastCol + 1; sheet.getRange(1, col).setValue(TOOLROOM_LEVEL_COLUMN).setFontWeight('bold'); }
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(['GOD', 'MASTER', 'CLERIK', 'TOURIST', '---'], true).setAllowInvalid(false).build();
  sheet.getRange(2, col, rows, 1).setDataValidation(rule);
  return 'Kolumna „' + TOOLROOM_LEVEL_COLUMN + '” w kolumnie ' + col + ' zakładki ' + API_USERS_SHEET;
}

/** Jednorazowo (z edytora): kolumna „Grafik dostęp” z listą wyboru GOD / MASTER / CLERIK / TOURIST / ---. */
function api_setupGrafikLevelColumn() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (!sheet) throw new Error('Brak zakładki ' + API_USERS_SHEET);
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = header.indexOf(GRAFIK_LEVEL_COLUMN.toLowerCase()) + 1;
  if (!col) { col = lastCol + 1; sheet.getRange(1, col).setValue(GRAFIK_LEVEL_COLUMN).setFontWeight('bold'); }
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(['GOD', 'MASTER', 'CLERIK', 'TOURIST', '---'], true).setAllowInvalid(false).build();
  sheet.getRange(2, col, rows, 1).setDataValidation(rule);
  return 'Kolumna „' + GRAFIK_LEVEL_COLUMN + '” w kolumnie ' + col + ' zakładki ' + API_USERS_SHEET;
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
  var grl = api_grafikLevel_(ctx);
  var tl = api_toolroomLevel_(ctx);
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
    claims: { plan: perms.plan || 'none', grafik: perms.grafik || 'none', harm: harm, grl: grl, tl: tl, name: ctx.name || '' }
  }));
  var unsigned = header + '.' + payload;
  var sig = api_b64url_(Utilities.computeRsaSha256Signature(unsigned, key));
  return { token: unsigned + '.' + sig, projectId: projectId, expiresAt: (now + 3600) * 1000, uid: uid, harm: harm, grl: grl, tl: tl };
}

/** Test z edytora: wpisz e-mail i uruchom – w dzienniku poziom, jaki dostanie ta osoba. */
function testHarmonogramLevel() {
  var email = 'wpisz@email.pl';
  Logger.log(email + ' → ' + api_harmLevel_({ email: email, permissions: {} }) + ' (dla pustej komórki liczą się jeszcze uprawnienia Plan/Grafik)');
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
  return 'Kolumna „' + HARM_COLUMN + '” w kolumnie ' + col + ' zakładki ' + API_USERS_SHEET;
}
