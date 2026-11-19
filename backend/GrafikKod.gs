/**
 * GrafikKod.gs — Grafik do wglądu w przeglądarce telefonu (iPhone, Android) z dostępem na osobisty kod pracownika.
 *
 * Strona: adres wdrożenia API (to samo, co w Ustawieniach programu PC / Androida) + "?p=grafik".
 * Pracownik wpisuje swój kod (8 cyfr); serwer sprawdza go i zwraca TYLKO kody zmian i komentarze z bazy Firebase
 * (gr_meta/main – nazwiska i miejsca pracy, gr_days – wpisy), bez urlopów, godzin i absencji. Strona niczego nie zmienia.
 *
 * Kody nadaje i usuwa MASTER / GOD w programie PC (Grafik → „Kody iPhone”). W bazie jest tylko skrót kodu (SHA-256):
 *   gr_codes/main: { codes: { <skrót>: { pid, name, by, at, last } } }
 *
 * Wdrożenie (robi właściciel skryptu):
 *  1. Dodaj ten plik (GrafikKod.gs) i plik HTML „GrafikKod” (GrafikKod.html) do projektu Apps Script.
 *  2. W Code.js na początku funkcji doGet(e) dodaj jedną linię (opis w PODSUMOWANIE / wiadomości):
 *       if (e && e.parameter && e.parameter.p === 'grafik') return grk_page_();
 *  3. Wdróż nową wersję (Zarządzaj wdrożeniami → Edytuj → Nowa wersja) wdrożenia API (dostęp: każdy, wykonaj jako: ja).
 *  4. Opublikuj reguły Firestore (gr_codes).
 * Wymaga tych samych Script Properties co Firebase.gs (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) – konto usługi
 * czyta bazę przez REST (z pominięciem reguł), więc do przeglądarki nie trafia żaden token bazy.
 */

var GRK_SALT = 'zks-grk:';
var GRK_MAX_DAYS = 62;
var GRK_FAIL_LIMIT = 20;      // błędnych kodów w ciągu 10 minut (wszyscy razem) – potem przerwa
var GRK_FAIL_SECONDS = 600;

/** Strona Grafiku do wglądu (doGet z ?p=grafik). */
function grk_page_() {
  return HtmlService.createHtmlOutputFromFile('GrafikKod')
    .setTitle('Grafik ZKS PO')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Wywoływane ze strony (google.script.run): [code] – kod pracownika, [from], [to] – rrrr-mm-dd (najwyżej GRK_MAX_DAYS dni).
 * Wynik: { who, pid, from, to, days, people: [{id, name, place, sep}], codes: {pid: {iso: kod}}, notes: {pid: {iso: tekst}}, holidays }.
 */
function grk_view(code, from, to) {
  var c = String(code || '').replace(/\D/g, '');
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('grk_fail') || 0);
  if (fails >= GRK_FAIL_LIMIT) throw new Error('Za dużo błędnych prób. Spróbuj ponownie za kilka minut.');
  var hash = grk_hash_(c);
  var codes = (grk_doc_('gr_codes/main') || {}).codes || {};
  var me = c.length >= 8 ? codes[hash] : null;
  if (!me) {
    cache.put('grk_fail', String(fails + 1), GRK_FAIL_SECONDS);
    throw new Error('Nieprawidłowy kod.');
  }
  try { grk_touch_(hash); } catch (e) { console.warn('grk_touch_ ' + e); }

  var re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(from)) || !re.test(String(to)) || from > to) throw new Error('Zły zakres dat.');
  var days = [];
  for (var d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to && days.length < GRK_MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  var meta = grk_doc_('gr_meta/main') || {};
  var cfg = grk_doc_('config/main') || {};
  var people = (meta.people || []).map(function (p) {
    return { id: String(p.id || ''), name: String(p.name || ''), place: String(p.place || ''), sep: p.sep === true };
  }).filter(function (p) { return p.id && p.name; });
  var codesOut = {}, notesOut = {};
  var months = {};
  days.forEach(function (iso) { months[iso.slice(0, 7)] = true; });
  Object.keys(months).forEach(function (mk) {
    var doc = grk_doc_('gr_days/' + mk) || {};
    ['c', 'n'].forEach(function (k) {
      var out = k === 'c' ? codesOut : notesOut;
      var m = doc[k] || {};
      Object.keys(m).forEach(function (pid) {
        Object.keys(m[pid] || {}).forEach(function (dd) {
          var iso = mk + '-' + dd;
          if (iso < days[0] || iso > days[days.length - 1]) return;
          (out[pid] = out[pid] || {})[iso] = String(m[pid][dd]);
        });
      });
    });
  });
  var holidays = (meta.holidays || []).concat((cfg.holidays || []).map(function (x) { return typeof x === 'string' ? x : (x && x.date) || ''; }))
    .filter(function (x) { return x; });
  return { who: me.name || '', pid: me.pid || '', from: days[0], to: days[days.length - 1], days: days, people: people, codes: codesOut, notes: notesOut, holidays: holidays };
}

function grk_hash_(code) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, GRK_SALT + code, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}

// ---------- Firestore REST (konto usługi, zakres datastore) ----------

function grk_token_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get('grk_token');
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
  cache.put('grk_token', j.access_token, 3000);
  return j.access_token;
}

function grk_base_() {
  var projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID') || 'harmonohram-zks';
  return 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/';
}

/** Dokument Firestore jako zwykły obiekt (null – brak). */
function grk_doc_(path) {
  var r = UrlFetchApp.fetch(grk_base_() + path, { headers: { Authorization: 'Bearer ' + grk_token_() }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('Błąd bazy (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 200));
  return grk_fields_(JSON.parse(r.getContentText()).fields || {});
}

function grk_fields_(f) {
  var o = {};
  Object.keys(f).forEach(function (k) { o[k] = grk_value_(f[k]); });
  return o;
}
function grk_value_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return grk_fields_(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(grk_value_);
  return null;
}

/** Zapis ostatniego użycia kodu (codes.<skrót>.last). */
function grk_touch_(hash) {
  var path = 'codes.`' + hash + '`.last';
  var body = { fields: { codes: { mapValue: { fields: {} } } } };
  body.fields.codes.mapValue.fields[hash] = { mapValue: { fields: { last: { integerValue: String(Date.now()) } } } };
  UrlFetchApp.fetch(grk_base_() + 'gr_codes/main?updateMask.fieldPaths=' + encodeURIComponent(path), {
    method: 'patch', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { Authorization: 'Bearer ' + grk_token_() }, muteHttpExceptions: true
  });
}

/** Test z edytora: czy konto usługi czyta bazę (liczba pracowników i nadanych kodów). */
function grk_test() {
  var meta = grk_doc_('gr_meta/main') || {};
  var codes = (grk_doc_('gr_codes/main') || {}).codes || {};
  Logger.log('Pracowników: ' + (meta.people || []).length + ', nadanych kodów: ' + Object.keys(codes).length);
}
