/**
 * Api.js – backend dla aplikacji Android (ZKS_PO).
 *
 * Aplikacja wysyła POST (Content-Type: text/plain) z ciałem JSON:
 *   { "key": "...", "fn": "getProductCodes", "args": [] }
 * Odpowiedź (JSON):
 *   { "ok": true,  "user": "adres@...", "data": ... }
 *   { "ok": false, "error": "komunikat", "code": "BAD_KEY" }
 * Kody błędów: NO_KEY, BAD_KEY, UNKNOWN_FN, FORBIDDEN, ERROR.
 *
 * Wdrożenie musi działać jako WŁAŚCICIEL skryptu (Wykonaj jako: Ja), a tożsamość
 * użytkownika pochodzi z klucza zapisanego w zakładce `Uzytkownicy`.
 * Opis całości: docs/ANDROID_MIGRATION.md.
 *
 * Zasady:
 *  - doPost wywołuje WYŁĄCZNIE funkcje z białej listy API_FUNCS (nigdy this[fn]).
 *  - Istniejące funkcje (*.js) nie są zmieniane poza podmianą adresu e-mail
 *    na currentUserEmail_(), dzięki czemu wersja webowa działa jak dotychczas.
 */

// ---------------------------------------------------------------------------
// Konfiguracja
// ---------------------------------------------------------------------------

var API_USERS_SHEET = 'Uzytkownicy';
var API_USERS_CACHE_KEY = 'api_users_v2';
var API_USERS_CACHE_SECONDS = 300; // zmiany w zakładce Uzytkownicy działają po max. 5 min
var API_LOCK_WAIT_MS = 20000;

// Uprawnienia do modułów są w zakładce `Uzytkownicy`: jedna kolumna na moduł, nagłówek w wierszu 1
// = nazwa modułu (poniżej). Wartość w komórce:
//   zapis i odczyt  – może czytać i zmieniać dane,
//   odczyt          – tylko czytanie,
//   brak            – bez dostępu do modułu.
// Pusta komórka = wartość domyślna z API_PERM_DEFAULTS (tak jak działało to dotąd).
var API_PERM_MODULES = { grafik: 'Grafik', plan: 'Plan', zakupy: 'Zakupy' };
var API_PERM_DEFAULTS = { grafik: 'read', plan: 'read', zakupy: 'none' };
var API_PERM_LABELS = { read: 'odczyt', write: 'zapis i odczyt', none: 'brak' };
var API_PERM_RANK = { none: 0, read: 1, write: 2 };

// Tryb zgodności: dopóki w `Uzytkownicy` nie ma żadnej kolumny uprawnień (nie uruchomiono jeszcze
// api_setupPermissions), prawo zapisu mają tylko ci użytkownicy, jak w dotychczasowym kodzie
// (ALLOWED_EDITORS w Code_Plan.js, GR_ALLOWED_EDITORS w Code_GR.js, lista Zakupów w Index.html).
// Służy też jako wartości początkowe dla api_setupPermissions.
var API_LEGACY_WRITERS = ['osiowy.tomasz@gmail.com', 'skupnikadam@gmail.com'];

// Administrator: jedyna osoba, która może przez API dodawać użytkowników i generować klucze (flaga `admin` w API_FUNCS).
// Sprawdzane po stronie serwera na podstawie adresu z klucza, więc ukrycie przycisku w aplikacji nie jest jedynym zabezpieczeniem.
var API_ADMIN_EMAIL = 'osiowy.tomasz@gmail.com';

// Tożsamość i uprawnienia bieżącego wywołania. Ustawiane w doPost; w wersji webowej puste.
var API_USER_EMAIL = '';
var API_USER_NAME = '';
var API_PERMS = {};

/**
 * Adres e-mail użytkownika. W API pochodzi z klucza, w wersji webowej z sesji Google.
 * Używana zamiast Session.getActiveUser().getEmail() w istniejących funkcjach.
 */
function currentUserEmail_() {
  return API_USER_EMAIL || Session.getActiveUser().getEmail() || '';
}

// ---------------------------------------------------------------------------
// Biała lista funkcji
// ---------------------------------------------------------------------------
// run(a, ctx): a = tablica argumentów z żądania, ctx = {email, name, permissions, roles}.
// perm: [moduł, poziom], np. ['grafik', 'write']: wymagane uprawnienie z zakładki Uzytkownicy
//   (poziom 'read' = odczyt lub zapis, 'write' = zapis i odczyt); brak = każdy zalogowany.
// write: true = zapis do arkusza, wykonywany pod blokadą (LockService).
// admin: true = tylko API_ADMIN_EMAIL.

var API_FUNCS = {
  api_whoami: {
    run: function (a, ctx) {
      return api_whoami_(ctx);
    }
  },

  // --- Workflow (karta Z) ---
  api_getWorkflow: {
    run: function () { return api_getWorkflow_(); }
  },
  api_saveWorkflow: {
    write: true,
    run: function (a, ctx) { return api_saveWorkflow_(a[0], ctx); }
  },

  // --- Administrator: użytkownicy i klucze (klucze nigdy nie wracają w liście) ---
  api_listUsers: {
    admin: true,
    run: function () { return api_listUsers_(); }
  },
  api_addUser: {
    admin: true,
    write: true,
    run: function (a) { return api_addUser_(a[0]); }
  },
  api_newUserKey: {
    admin: true,
    write: true,
    run: function (a) { return api_newUserKey_(a[0]); }
  },
  // Bieżący klucz użytkownika (do ponownego przekazania); tylko administrator, osobno od listy.
  api_userKey: {
    admin: true,
    run: function (a) { return api_userKey_(a[0]); }
  },

  // --- Ekran startowy ---
  getHomeMissingPartsFromNdCacheV2: {
    run: function () { return getHomeMissingPartsFromNdCacheV2(); }
  },

  // --- Mistrz PO (Code_MistrzPO.js): dostęp dla każdego z kluczem, uprawnienia szczegółowe z zakładki Setup arkusza Mistrz_po ---
  mp_getPermissions: {
    run: function (a, ctx) { return mp_getPermissions_(ctx); }
  },
  mp_saveDetail: {
    write: true,
    run: function (a, ctx) { return mp_saveDetail_(a[0], ctx); }
  },
  mp_saveOperation: {
    write: true,
    run: function (a, ctx) { return mp_saveOperation_(a[0], ctx); }
  },
  mp_pendingOperations: {
    run: function (a) { return mp_pendingOperations_(a[0]); }
  },
  mp_displayOperations: {
    run: function (a) { return mp_displayOperations_(a[0], a[1]); }
  },
  mp_findOperations: {
    run: function (a) { return mp_findOperations_(a[0], a[1], a[2]); }
  },
  mp_changeOperationStatus: {
    write: true,
    run: function (a, ctx) { return mp_changeOperationStatus_(a[0], ctx); }
  },
  mp_deleteOperation: {
    write: true,
    run: function (a, ctx) { return mp_deleteOperation_(a[0], ctx); }
  },
  mp_saveDocument: {
    write: true,
    run: function (a, ctx) { return mp_saveDocument_(a[0], ctx); }
  },
  mp_listDocuments: {
    run: function (a, ctx) { return mp_listDocuments_(a[0], ctx); }
  },
  mp_deleteDocument: {
    write: true,
    run: function (a, ctx) { return mp_deleteDocument_(a[0], ctx); }
  },
  mp_listDetails: {
    run: function (a, ctx) { return mp_listDetails_(ctx); }
  },
  mp_addDetail: {
    write: true,
    run: function (a, ctx) { return mp_addDetail_(a[0], ctx); }
  },

  // --- Skaner ---
  getProductCodes: {
    run: function () { return getProductCodes(); }
  },
  processForm: {
    write: true,
    run: function (a) { return processForm(a[0]); }
  },

  // --- Grafik ---
  getGrData: {
    perm: ['grafik', 'read'],
    // Szybka wersja z pamięcią podręczną (api_getGrData_); trzeci argument 'fresh' pomija pamięć. Prawo edycji wynika
    // z uprawnień w zakładce Uzytkownicy, a nie z listy w kodzie.
    run: function (a, ctx) { return api_getGrData_(a[0], a[1], ctx, a[2] === 'fresh'); }
  },
  saveGrData: {
    perm: ['grafik', 'write'],
    write: true,
    // Własna implementacja: oryginalne saveGrData liczy kolumny od B3, a getGrData
    // przy filtrze dat zwraca zakres od kolumny pierwszej daty (patrz api_saveGrData_).
    run: function (a) { return api_saveGrData_(a[0], a[1], a[2]); }
  },

  // --- Plan ---
  api_getPlanGrid: {
    perm: ['plan', 'read'],
    run: function (a, ctx) { return api_getPlanGrid(ctx); }
  },
  savePlanData: {
    perm: ['plan', 'write'],
    write: true,
    run: function (a) { return savePlanData(a[0]); }
  },

  // --- ToolBuilder ---
  getToolOptions: {
    run: function () { return getToolOptions(); }
  },
  getAllToolDetailsMap: {
    run: function () { return getAllToolDetailsMap(); }
  },
  saveToolDataToBN: {
    write: true,
    run: function (a) { return saveToolDataToBN(a[0]) || { success: true }; }
  },

  // --- Assembled Tool Viewer (BN) ---
  getBNbaseData: {
    run: function () {
      var result = getBNbaseData();
      if (result && typeof result === 'object') delete result.debugLogs; // bardzo duże
      return result;
    }
  },
  getBnPartsForTeamV2: {
    run: function (a) { return getBnPartsForTeamV2(a[0]); }
  },
  getBn2dDataForTeamV2: {
    run: function (a) { return getBn2dDataForTeamV2(a[0]); }
  },

  // --- ToolTrack ---
  getStToolOptions: {
    run: function () { return getStToolOptions(); }
  },
  getStAllowedLocations: {
    run: function () { return getStAllowedLocations(); }
  },
  getStBasicToolMap: {
    run: function () { return getStBasicToolMap(); }
  },
  saveStSelectedToolsToN: {
    write: true,
    run: function (a, ctx) { return api_saveStSelectedTools_(a[0], ctx); }
  },
  saveScannedToolToN: {
    write: true,
    run: function (a, ctx) {
      var data = a[0] || {};
      // „kto” zawsze z klucza, nigdy od klienta
      return saveScannedToolToN({ code: data.code, location: data.location, who: ctx.email });
    }
  },

  // --- Harmonogram ---
  firebaseToken: {
    // Token logowania do Firestore (patrz Firebase.gs); claims z uprawnień użytkownika.
    run: function (a, ctx) { return api_firebaseToken_(ctx); }
  },
  getGrafNorm: {
    // Pełny grafik (karta graf_norm w pliku Harmonogramu) do liczenia terminów w programie; argument 'fresh' pomija pamięć.
    run: function (a) { return api_getGrafNorm_(a[0] === 'fresh'); }
  },
  getHarmData: {
    // Szybka wersja z pamięcią podręczną (api_getHarmData_); argument 'fresh' pomija pamięć.
    run: function (a) { return api_getHarmData_(a[0] === 'fresh'); }
  },

  // --- Zakupy ---
  // Odczyt z prawdziwymi numerami wierszy (patrz api_zakupyRows_) zamiast getZakupyData z wersji webowej.
  getZakupyData: {
    perm: ['zakupy', 'read'],
    run: function () { return api_zakupyRows_('Zakupy'); }
  },
  getZakupyArchiveData: {
    perm: ['zakupy', 'read'],
    run: function () { return api_zakupyRows_('Zakupy_ar'); }
  },
  getZakupyProductCodes: {
    perm: ['zakupy', 'read'],
    run: function () { return getZakupyProductCodes(); }
  },
  addZakupyItem: {
    perm: ['zakupy', 'write'],
    write: true,
    run: function (a) { return addZakupyItem(a[0]); }
  },
  updateZakupyItem: {
    perm: ['zakupy', 'write'],
    write: true,
    run: function (a) { return api_updateZakup_(a[0]); }
  },

  // --- Pomiary: karta pomiaru płaszcza (Code_Karta.js) ---
  // Bez osobnego uprawnienia, tak jak w wersji webowej: każdy użytkownik z aktywnym kluczem.
  karta_zapiszPomiar: {
    write: true,
    run: function (a) {
      if (!a[0] || typeof a[0] !== 'object') throw api_error_('ERROR', 'Brak danych pomiaru');
      return karta_zapiszPomiar(a[0]);
    }
  },
  karta_szukajPomiarow: {
    run: function (a) { return karta_szukajPomiarow(a[0], a[1], a[2]); }
  },
  karta_wczytajPomiar: {
    run: function (a) {
      var row = Number(a[0]);
      if (!isFinite(row) || row < 2 || Math.floor(row) !== row) throw api_error_('ERROR', 'Nieprawidłowy numer wiersza');
      return karta_wczytajPomiar(row);
    }
  },
  karta_listaPomiarow: {
    run: function () { return karta_listaPomiarow(); }
  },
  karta_getCurrentUserEmail: {
    run: function (a, ctx) { return String(ctx.email || '').toLowerCase(); }
  },
  karta_cacheSave: {
    write: true,
    run: function (a) { return karta_cacheSave(a[0]); }
  },
  karta_cacheLoad: {
    run: function () { return karta_cacheLoad(); }
  }
};

// ---------------------------------------------------------------------------
// Punkt wejścia
// ---------------------------------------------------------------------------

function doPost(e) {
  var user = null;
  try {
    var req = api_parseRequest_(e);

    user = api_authenticate_(req.key);
    API_USER_EMAIL = user.email;
    API_USER_NAME = user.name;
    API_PERMS = user.perms;

    if (!Object.prototype.hasOwnProperty.call(API_FUNCS, req.fn)) {
      throw api_error_('UNKNOWN_FN', 'Nieznana funkcja: ' + req.fn);
    }
    var def = API_FUNCS[req.fn];

    if (def.admin && user.email !== API_ADMIN_EMAIL) {
      throw api_error_('FORBIDDEN', 'Tylko administrator');
    }
    if (def.perm && !api_allowed_(user.perms, def.perm[0], def.perm[1])) {
      throw api_error_('FORBIDDEN', 'Brak uprawnień');
    }

    var ctx = {
      email: user.email,
      name: user.name,
      permissions: user.perms,
      roles: api_writeModules_(user.perms)
    };
    var data = def.write
      ? api_withLock_(function () { return def.run(req.args, ctx); })
      : def.run(req.args, ctx);

    return api_json_({ ok: true, user: user.email, data: data === undefined ? null : data });
  } catch (err) {
    var code = err && err.apiCode ? err.apiCode : 'ERROR';
    if (code === 'ERROR') {
      console.error('[API] ' + (err && err.stack ? err.stack : err));
    }
    return api_json_({
      ok: false,
      error: String(err && err.message ? err.message : err),
      code: code
    });
  }
}

function api_parseRequest_(e) {
  var raw = e && e.postData && e.postData.contents;
  var req;
  try {
    req = JSON.parse(raw || '{}');
  } catch (parseErr) {
    throw api_error_('ERROR', 'Nieprawidłowy JSON w żądaniu');
  }
  if (!req || typeof req !== 'object') {
    throw api_error_('ERROR', 'Nieprawidłowe żądanie');
  }
  var key = String(req.key || '').trim();
  if (!key) throw api_error_('NO_KEY', 'Brak klucza');
  return {
    key: key,
    fn: String(req.fn || ''),
    args: Array.isArray(req.args) ? req.args : []
  };
}

function api_error_(code, message) {
  var err = new Error(message);
  err.apiCode = code;
  return err;
}

function api_json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function api_withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(API_LOCK_WAIT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Użytkownicy i klucze
// ---------------------------------------------------------------------------

function api_hashKey_(key) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(key),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

/**
 * Mapa sha256(klucz) → {email, name, perms}. Tylko aktywni użytkownicy. Cache 5 min.
 * perms = {grafik|plan|zakupy: 'none' | 'read' | 'write'} z kolumn uprawnień w `Uzytkownicy`.
 */
function api_loadUsers_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(API_USERS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (!sheet) {
    throw api_error_('ERROR', 'Brak zakładki ' + API_USERS_SHEET);
  }

  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var values = sheet.getRange(1, 1, lastRow, Math.max(sheet.getLastColumn(), 4)).getValues();
    var permCols = api_permColumns_(values[0]);
    values.slice(1).forEach(function (row) {
      var email = String(row[0] || '').trim().toLowerCase();
      var key = String(row[1] || '').trim();
      var active = String(row[2] || '').trim().toUpperCase() === 'TAK';
      var name = String(row[3] || '').trim();
      if (!email || key.length < 20 || !active) return;
      map[api_hashKey_(key)] = {
        email: email,
        name: name || email,
        perms: api_permsFromRow_(row, permCols, email)
      };
    });
  }

  cache.put(API_USERS_CACHE_KEY, JSON.stringify(map), API_USERS_CACHE_SECONDS);
  return map;
}

/** Numery kolumn uprawnień (od 0) wg nagłówków w wierszu 1; -1 = brak takiej kolumny. */
function api_permColumns_(headerRow) {
  var names = headerRow.map(function (h) { return String(h || '').trim().toLowerCase(); });
  var cols = {};
  Object.keys(API_PERM_MODULES).forEach(function (module) {
    cols[module] = names.indexOf(API_PERM_MODULES[module].toLowerCase());
  });
  return cols;
}

function api_permissionKnown_(text) {
  var t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return t === '' || ['zapis i odczyt', 'odczyt i zapis', 'zapis', 'odczyt', 'brak'].indexOf(t) !== -1;
}

/**
 * Tekst z komórki → 'write' | 'read' | 'none'. Pusta komórka = [fallback].
 * Nierozpoznana wartość (literówka) = 'none', czyli odmowa dostępu jest bezpieczniejsza niż nadanie go.
 */
function api_parsePermission_(text, fallback) {
  var t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return fallback;
  if (t === 'zapis i odczyt' || t === 'odczyt i zapis' || t === 'zapis') return 'write';
  if (t === 'odczyt') return 'read';
  return 'none';
}

function api_permsFromRow_(row, permCols, email) {
  // Tryb zgodności: żadnej kolumny uprawnień w arkuszu (jeszcze nie uruchomiono api_setupPermissions).
  var legacy = Object.keys(permCols).every(function (m) { return permCols[m] === -1; });
  var perms = {};
  Object.keys(API_PERM_MODULES).forEach(function (module) {
    if (legacy) {
      perms[module] = API_LEGACY_WRITERS.indexOf(email) !== -1 ? 'write' : API_PERM_DEFAULTS[module];
    } else {
      var text = permCols[module] >= 0 ? row[permCols[module]] : '';
      perms[module] = api_parsePermission_(text, API_PERM_DEFAULTS[module]);
    }
  });
  return perms;
}

/** Czy [perms] daje w [module] co najmniej poziom [level] ('read' lub 'write'). */
function api_allowed_(perms, module, level) {
  var have = API_PERM_RANK[(perms && perms[module]) || 'none'] || 0;
  return have >= API_PERM_RANK[level];
}

/** Moduły, w których użytkownik może zapisywać (dla zgodności z polem `roles`). */
function api_writeModules_(perms) {
  return Object.keys(API_PERM_MODULES).filter(function (module) {
    return perms && perms[module] === 'write';
  });
}

/** Czy bieżący użytkownik może zmieniać PLAN. W API decydują uprawnienia z arkusza, w wersji webowej lista w kodzie. */
function canEditPlan_(email) {
  if (API_USER_EMAIL) return API_PERMS.plan === 'write';
  return ALLOWED_EDITORS.indexOf(email) !== -1;
}

function api_authenticate_(key) {
  var user = api_loadUsers_()[api_hashKey_(key)];
  if (!user) throw api_error_('BAD_KEY', 'Nieprawidłowy lub nieaktywny klucz');
  return user;
}

/** Odpowiedź api_whoami: `permissions` = poziom w każdym module, `roles` = moduły z prawem zapisu. */
function api_whoami_(ctx) {
  return {
    email: ctx.email,
    name: ctx.name,
    roles: ctx.roles,
    permissions: ctx.permissions
  };
}

/** Lista wartości do rozwijanej listy w komórkach uprawnień. */
function api_permissionChoices_() {
  return [API_PERM_LABELS.read, API_PERM_LABELS.write, API_PERM_LABELS.none];
}

function api_applyPermissionValidation_(sheet, cols) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(api_permissionChoices_(), true)
    .setAllowInvalid(false)
    .setHelpText('Wybierz: ' + api_permissionChoices_().join(', '))
    .build();
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  Object.keys(cols).forEach(function (module) {
    sheet.getRange(2, cols[module] + 1, rows, 1).setDataValidation(rule);
  });
}

/** Do uruchomienia w edytorze: tworzy zakładkę Uzytkownicy z wierszem właściciela. */
function api_setupUsers() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(API_USERS_SHEET);
  if (sheet) {
    Logger.log('Zakładka ' + API_USERS_SHEET + ' już istnieje, nic nie zmieniono. ' +
      'Uprawnienia do modułów dodasz funkcją api_setupPermissions.');
    return;
  }
  sheet = ss.insertSheet(API_USERS_SHEET);
  var modules = Object.keys(API_PERM_MODULES);
  var header = ['email', 'klucz', 'aktywny', 'nazwa'].concat(modules.map(function (m) { return API_PERM_MODULES[m]; }));
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  var owner = Session.getEffectiveUser().getEmail();
  var row = [owner, api_newKey_(), 'TAK', owner].concat(modules.map(function () { return API_PERM_LABELS.write; }));
  sheet.getRange(2, 1, 1, row.length).setValues([row]);
  sheet.setFrozenRows(1);
  var cols = {};
  modules.forEach(function (m, i) { cols[m] = 4 + i; });
  api_applyPermissionValidation_(sheet, cols);
  Logger.log('Utworzono ' + API_USERS_SHEET + '. Klucz właściciela jest w komórce B2.');
}

/**
 * Do uruchomienia w edytorze (raz): dodaje do `Uzytkownicy` kolumny uprawnień (Grafik, Plan, Zakupy),
 * wypełnia puste komórki obecnymi uprawnieniami (API_LEGACY_WRITERS = zapis i odczyt, pozostali = odczyt,
 * a w Zakupach brak) i dodaje rozwijaną listę. Nie nadpisuje komórek, które już coś zawierają.
 */
function api_setupPermissions() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (!sheet) throw new Error('Brak zakładki ' + API_USERS_SHEET + '. Najpierw uruchom api_setupUsers.');

  var lastCol = Math.max(sheet.getLastColumn(), 4);
  var cols = api_permColumns_(sheet.getRange(1, 1, 1, lastCol).getValues()[0]);
  var nextCol = lastCol; // indeks (od 0) pierwszej wolnej kolumny
  Object.keys(API_PERM_MODULES).forEach(function (module) {
    if (cols[module] === -1) {
      sheet.getRange(1, nextCol + 1).setValue(API_PERM_MODULES[module]);
      cols[module] = nextCol;
      nextCol++;
    }
  });

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var emails = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    Object.keys(cols).forEach(function (module) {
      var range = sheet.getRange(2, cols[module] + 1, lastRow - 1, 1);
      var filled = range.getValues().map(function (cell, i) {
        if (String(cell[0]).trim() !== '') return [cell[0]];
        var email = String(emails[i][0] || '').trim().toLowerCase();
        if (!email) return [''];
        var level = API_LEGACY_WRITERS.indexOf(email) !== -1 ? 'write' : API_PERM_DEFAULTS[module];
        return [API_PERM_LABELS[level]];
      });
      range.setValues(filled);
    });
  }

  api_applyPermissionValidation_(sheet, cols);
  api_clearCache();
  Logger.log('Uprawnienia gotowe. Zmieniaj je w kolumnach Grafik, Plan, Zakupy zakładki ' + API_USERS_SHEET + '.');
}

/** Sprawdza wartości w kolumnach uprawnień i zwraca listę problemów (nierozpoznane wpisy). */
function api_checkPermissionValues_() {
  var problems = [];
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return problems;
  var values = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), 4)).getValues();
  var cols = api_permColumns_(values[0]);
  Object.keys(cols).forEach(function (module) {
    if (cols[module] === -1) return;
    values.slice(1).forEach(function (row, i) {
      var text = row[cols[module]];
      if (!api_permissionKnown_(text)) {
        problems.push(API_USERS_SHEET + ': wiersz ' + (i + 2) + ', ' + API_PERM_MODULES[module] +
          ': nieznana wartość „' + text + '” (dozwolone: ' + api_permissionChoices_().join(', ') + '); traktowana jak brak dostępu');
      }
    });
  });
  return problems;
}

function api_newKey_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/** Do uruchomienia w edytorze: wypisuje nowy klucz do wklejenia w kolumnie B. */
function api_generateKey() {
  var key = api_newKey_();
  Logger.log('Nowy klucz: ' + key);
  return key;
}

// ---------------------------------------------------------------------------
// Administrator: lista użytkowników, dodawanie, nowy klucz
// ---------------------------------------------------------------------------

function api_usersSheet_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(API_USERS_SHEET);
  if (!sheet) throw new Error('Brak zakładki ' + API_USERS_SHEET);
  return sheet;
}

function api_normEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

/** Uprawnienie z aplikacji ('none' | 'read' | 'write') → tekst do komórki; brak lub nieznane = wartość domyślna modułu. */
function api_permissionCell_(module, level) {
  var l = API_PERM_RANK.hasOwnProperty(level) ? level : API_PERM_DEFAULTS[module];
  return API_PERM_LABELS[l];
}

/** Użytkownicy z zakładki (bez kluczy): email, nazwa, aktywny, uprawnienia do modułów. */
function api_listUsers_() {
  var sheet = api_usersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(1, 1, lastRow, Math.max(sheet.getLastColumn(), 4)).getValues();
  var permCols = api_permColumns_(values[0]);
  var users = [];
  values.slice(1).forEach(function (row) {
    var email = api_normEmail_(row[0]);
    if (!email) return;
    users.push({
      email: email,
      name: String(row[3] || '').trim(),
      active: String(row[2] || '').trim().toUpperCase() === 'TAK',
      hasKey: String(row[1] || '').trim().length >= 20,
      permissions: api_permsFromRow_(row, permCols, email)
    });
  });
  return users;
}

/**
 * Dodaje użytkownika: nowy wiersz z aktywnym kontem, wygenerowanym kluczem i uprawnieniami.
 * data: {email, name, permissions: {grafik|plan|zakupy: 'none'|'read'|'write'}}. Zwraca {email, key}:
 * klucz widać tylko w tej odpowiedzi (w liście go nie ma).
 */
function api_addUser_(data) {
  data = data || {};
  var email = api_normEmail_(data.email);
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) throw new Error('Nieprawidłowy adres e-mail');
  var sheet = api_usersSheet_();
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 4);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (lastRow >= 2) {
    var emails = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < emails.length; i++) {
      if (api_normEmail_(emails[i][0]) === email) throw new Error('Użytkownik ' + email + ' już istnieje');
    }
  }
  var key = api_newKey_();
  var row = [];
  for (var c = 0; c < lastCol; c++) row.push('');
  row[0] = email;
  row[1] = key;
  row[2] = 'TAK';
  row[3] = String(data.name || '').trim() || email;
  var permCols = api_permColumns_(header);
  var perms = data.permissions || {};
  Object.keys(permCols).forEach(function (module) {
    if (permCols[module] >= 0) row[permCols[module]] = api_permissionCell_(module, perms[module]);
  });
  sheet.getRange(Math.max(lastRow, 1) + 1, 1, 1, lastCol).setValues([row]);
  api_clearCache();
  return { email: email, key: key };
}

/**
 * Nowy klucz istniejącego użytkownika (stary przestaje działać). Zwraca {email, key, active}; `active` = false oznacza, że
 * konto jest wyłączone w kolumnie „aktywny” i klucz zadziała dopiero po jego włączeniu.
 */
function api_newUserKey_(emailArg) {
  var email = api_normEmail_(emailArg);
  if (!email) throw new Error('Brak adresu e-mail');
  var sheet = api_usersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (api_normEmail_(rows[i][0]) === email) {
        var key = api_newKey_();
        sheet.getRange(i + 2, 2).setValue(key);
        api_clearCache();
        return { email: email, key: key, active: String(rows[i][2] || '').trim().toUpperCase() === 'TAK' };
      }
    }
  }
  throw new Error('Nie ma użytkownika ' + email);
}

/** Bieżący klucz użytkownika z zakładki: {email, key, active}. Błąd, gdy użytkownika nie ma albo nie ma klucza. */
function api_userKey_(emailArg) {
  var email = api_normEmail_(emailArg);
  if (!email) throw new Error('Brak adresu e-mail');
  var sheet = api_usersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (api_normEmail_(rows[i][0]) === email) {
        var key = String(rows[i][1] || '').trim();
        if (!key) throw new Error('Użytkownik ' + email + ' nie ma klucza. Wygeneruj nowy.');
        return { email: email, key: key, active: String(rows[i][2] || '').trim().toUpperCase() === 'TAK' };
      }
    }
  }
  throw new Error('Nie ma użytkownika ' + email);
}

/** Po ręcznej zmianie w zakładce Uzytkownicy, jeśli nie chcesz czekać 5 min. */
function api_clearCache() {
  CacheService.getScriptCache().remove(API_USERS_CACHE_KEY);
}

// ---------------------------------------------------------------------------
// ToolTrack: zapis wielu narzędzi
// ---------------------------------------------------------------------------

function api_saveStSelectedTools_(items, ctx) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Brak narzędzi do zapisu.');
  }
  var clean = items.map(function (item) {
    var code = normalizeSt_(item && item.code);
    var location = normalizeSt_(item && item.location);
    if (!code) throw new Error('Brak kodu narzędzia.');
    if (!isAllowedStLocation_(location)) {
      throw new Error('Nieprawidłowa lokalizacja: ' + location);
    }
    return { code: code, location: location, who: ctx.email };
  });
  return saveStSelectedToolsToN(clean);
}

// ---------------------------------------------------------------------------
// Zakupy: prawdziwe numery wierszy i kontrola przed zapisem
// ---------------------------------------------------------------------------

/**
 * Wiersze zakładki `Zakupy` albo `Zakupy_ar`. getZakupyData z wersji webowej liczy `rowNumber` z indeksu
 * PO odfiltrowaniu pustych wierszy, więc przy pustym wierszu w arkuszu numer wskazuje zły wiersz, a
 * updateZakupyItem zapisałby realizację w cudzej pozycji. Tu `rowNumber` to rzeczywisty numer wiersza.
 * `exactRows: true` mówi aplikacji, że serwer ma tę poprawkę (bez niej aplikacja nie pozwala zapisywać).
 */
function api_zakupyRows_(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Nie znaleziono karty: ' + sheetName);

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { rows: [], exactRows: true };

  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
  var rows = [];
  values.forEach(function (row, i) {
    var empty = row.every(function (cell) { return String(cell || '').trim() === ''; });
    if (empty) return;
    var item = { rowNumber: i + 2 };
    'ABCDEFGHIJKL'.split('').forEach(function (letter, c) {
      item['column' + letter] = row[c] || '';
    });
    rows.push(item);
  });
  return { rows: rows, exactRows: true };
}

/**
 * Zapis realizacji zakupu (updateZakupyItem) z kontrolą: pozycja musi nadal być tym, co aplikacja pokazała
 * (kod w kolumnie C zgodny z `expectKod`) i nie może być już oznaczona jako zakupiona (kolumna J = x).
 * Chroni przed zapisem w złym wierszu, gdy ktoś w międzyczasie zmienił arkusz.
 */
function api_updateZakup_(data) {
  data = data || {};
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Zakupy');
  if (!sheet) throw new Error('Nie znaleziono karty: Zakupy');

  var rowNumber = Number(data.rowNumber);
  if (!rowNumber || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw new Error('Nieprawidłowy numer wiersza.');
  }

  var expected = String(data.expectKod === undefined ? '' : data.expectKod).trim().toLowerCase();
  var current = String(sheet.getRange(rowNumber, 3).getDisplayValue() || '').trim().toLowerCase();
  if (expected !== current) {
    throw new Error('Pozycja w arkuszu zmieniła się od ostatniego odświeżenia. Odśwież listę i spróbuj ponownie.');
  }
  // Pozycja z wpisanym PZ jest zrealizowana; pozycje bez PZ (także z x i datą zakupu) można uzupełnić/skorygować.
  var hasPz = String(sheet.getRange(rowNumber, 5).getDisplayValue() || '').trim() !== '';
  if (hasPz) throw new Error('Ta pozycja ma już wpisany PZ. Odśwież listę.');

  return updateZakupyItem(data);
}

// ---------------------------------------------------------------------------
// Grafik: zapis z poprawnym przesunięciem kolumn
// ---------------------------------------------------------------------------

function api_dateToNumber_(value) {
  var text = String(value || '').trim();

  var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return Number(iso[1] + iso[2] + iso[3]);

  var pl = text.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (pl) {
    var day = String(pl[1]).padStart(2, '0');
    var month = String(pl[2]).padStart(2, '0');
    var year = Number(pl[3]);
    if (year < 100) year += 2000;
    return Number(String(year) + month + day);
  }
  return null;
}

/**
 * Zapisuje zmiany grafiku. `col` w zmianach to indeks kolumny względem zakresu
 * zwróconego przez getGrData(startDate, endDate) (a nie względem początku B3).
 * Jeśli podano daty, zakres jest wyznaczany tak samo jak w getGrData.
 */
function api_saveGrData_(changes, startDate, endDate) {
  if (!Array.isArray(changes)) throw new Error('Brak zmian do zapisu.');

  var sheet = SpreadsheetApp.getActive().getSheetByName('G');
  if (!sheet) throw new Error('Arkusz G nie istnieje!');

  var b3 = String(sheet.getRange('B3').getDisplayValue()).trim();
  if (!b3) throw new Error('Brak adresu zakresu grafiku w komórce B3!');

  var b3Range = sheet.getRange(b3);
  var startRow = b3Range.getRow();
  var startCol = b3Range.getColumn();

  if (startDate && endDate) {
    var startNumber = api_dateToNumber_(startDate);
    var headers = sheet
      .getRange(4, 1, 1, sheet.getLastColumn())
      .getDisplayValues()[0];

    var found = null;
    headers.forEach(function (header, index) {
      var n = api_dateToNumber_(header);
      if (n && found === null && n >= startNumber) found = index + 1;
    });
    if (!found) throw new Error('Nie znaleziono zakresu dat w wierszu 4 arkusza G.');
    startCol = found;
  }

  changes.forEach(function (change) {
    var row = Number(change && change.row);
    var col = Number(change && change.col);
    if (isNaN(row) || isNaN(col) || row < 0 || col < 0) return;
    sheet.getRange(startRow + row, startCol + col).setValue(change.value || '');
  });

  SpreadsheetApp.flush();
  api_grBump_();   // następny odczyt Grafiku nie bierze danych z pamięci podręcznej
  return { status: 'success', message: 'Grafik zapisany.' };
}

// ---------------------------------------------------------------------------
// Plan: dane strukturalne zamiast HTML (logika 1:1 z getPlanData w Code_Plan.js)
// ---------------------------------------------------------------------------

/** Lista pracowników z zakładki G (B5:B), skrócona jak w getPlanData. */
function api_planWorkers_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('G');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 5) return [];

  return sheet
    .getRange(5, 2, lastRow - 4, 1)
    .getValues()
    .flat()
    .map(function (v) { return String(v || '').trim(); })
    .filter(Boolean)
    .map(function (name) {
      var parts = name.split(' ').filter(Boolean);
      if (parts.length < 2) return name;
      var second = parts[1].charAt(0).toUpperCase() + parts[1].slice(1, 3).toLowerCase();
      return parts[0] + ' ' + second;
    });
}

/**
 * Zwraca siatkę arkusza PLAN. Indeksy wierszy i kolumn są liczone od 0 jak w arkuszu
 * (kolumna 0 = A, jest ukryta; pierwsza widoczna to `firstVisibleCol`). Dokładnie te
 * indeksy przyjmuje savePlanData w `changes` ({row, col, value}).
 *
 * kinds[r][c]:
 *   'hidden' – kolumna A, nie pokazywać
 *   'header' – wiersz 0, tylko do odczytu
 *   'date'   – komórka daty zmiany (wartość w dateCells, format yyyy-MM-dd)
 *   'worker' – wybór pracownika z listy `workers`
 *   'edit'   – edytowalny tekst; formatowanie w runs[r][c] = [{text, color}]
 *   'static' – pozostałe komórki, tylko do odczytu
 * blocks: bloki „Zmiana N - KARTA PRACY”: wiersz nagłówka i ostatni wiersz bloku.
 * Wiersze bloku między headerRow+1 a lastRow web domyślnie zwija.
 */
function api_getPlanGrid(ctx) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(PLANSHEET);
  if (!sheet) throw new Error('Arkusz o nazwie ' + PLANSHEET + ' nie istnieje!');

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2) throw new Error('Brak danych w arkuszu ' + PLANSHEET + '!');

  var range = sheet.getRange(1, 1, lastRow, lastColumn);
  var raw = range.getValues();
  var backgrounds = range.getBackgrounds();
  var fontColors = range.getFontColors();
  var richTexts = range.getRichTextValues();
  var tz = Session.getScriptTimeZone();

  var shiftRe = /Zmiana\s*([123])\s*-\s*KARTA PRACY/i;

  function plain(cell) {
    return cell instanceof Date
      ? Utilities.formatDate(cell, tz, 'dd-MM-yyyy')
      : String(cell || '');
  }

  var values = [];
  var bgs = [];
  var colors = [];
  var kinds = [];
  var runs = [];
  var dateCells = [];
  var workerCells = [];
  var blocks = [];
  var current = null;

  raw.forEach(function (row, r) {
    var rowText = row.map(function (v) { return String(v || ''); }).join(' ');
    var shiftMatch = rowText.match(shiftRe);
    if (shiftMatch) {
      current = {
        id: 'shiftBlock_' + (blocks.length + 1),
        shift: shiftMatch[1],
        headerRow: r,
        lastRow: r
      };
      blocks.push(current);
    } else if (current) {
      current.lastRow = r;
    }

    var vRow = [], bRow = [], cRow = [], kRow = [], runRow = [];
    var hasOperationNumber = /^\d+/.test(String(row[0] || '').trim());

    row.forEach(function (cell, c) {
      var bg = backgrounds[r][c] || '#ffffff';
      var color = fontColors[r][c] || '#000000';
      bRow.push(bg);
      cRow.push(color);
      runRow.push(null);

      if (c === 0) {
        vRow.push(plain(cell));
        kRow.push('hidden');
        return;
      }

      var isDateForShift = shiftRe.test(String(row[c + 1] || ''));
      if (isDateForShift) {
        vRow.push(plain(cell));
        kRow.push('date');
        dateCells.push({
          row: r,
          col: c,
          value: cell instanceof Date ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd') : ''
        });
        return;
      }

      if (r > 1 && c === 1 && hasOperationNumber) {
        vRow.push(plain(cell));
        kRow.push('worker');
        workerCells.push({ row: r, col: c });
        return;
      }

      if (r > 0) {
        var rt = richTexts[r][c];
        var cellRuns = [];
        var text = '';
        if (rt) {
          text = rt.getText();
          var rtRuns = rt.getRuns();
          if (rtRuns && rtRuns.length) {
            cellRuns = rtRuns.map(function (run) {
              return {
                text: run.getText(),
                color: run.getTextStyle().getForegroundColor() || color
              };
            });
          } else {
            cellRuns = [{ text: text, color: color }];
          }
        }
        vRow.push(text);
        kRow.push('edit');
        runRow[c] = cellRuns;
        return;
      }

      vRow.push(plain(cell));
      kRow.push('header');
    });

    values.push(vRow);
    bgs.push(bRow);
    colors.push(cRow);
    kinds.push(kRow);
    runs.push(runRow);
  });

  var email = currentUserEmail_();
  return {
    firstVisibleCol: 1,
    values: values,
    backgrounds: bgs,
    fontColors: colors,
    kinds: kinds,
    runs: runs,
    dateCells: dateCells,
    workerCells: workerCells,
    blocks: blocks,
    workers: api_planWorkers_(),
    // Prawo edycji z uprawnień w zakładce Uzytkownicy (kolumna Plan), a nie z listy w kodzie.
    canEdit: !!(ctx && ctx.permissions && ctx.permissions.plan === 'write'),
    userColor: PLAN_USER_FONT_COLORS[email] || '#000000'
  };
}


// ---------------------------------------------------------------------------
// Szybkość: pamięć podręczna odpowiedzi i mniej odczytów arkusza (Grafik, Harmonogram)
// Wersje webowe (getGrData, getHarmData w Code_GR.js i Code_Harm.js) zostają bez zmian; API używa poniższych.
// ---------------------------------------------------------------------------

var API_CACHE_CHUNK = 90000;   // limit CacheService to 100 KB na wartość
var API_GR_TTL = 45;           // sekundy: zmiany ręcznie w arkuszu widać w aplikacji po tym czasie; zapis z aplikacji unieważnia od razu
var API_HARM_TTL = 90;         // sekundy; plik Harmonogramu jest osobny, więc nie ma jak go unieważnić z edycji

/** Zapis obiektu w pamięci podręcznej skryptu: JSON → gzip → base64, w kawałkach po 90 KB. Błąd (np. za duży) oznacza brak pamięci, nie błąd odczytu. */
function api_cachePut_(key, obj, seconds) {
  try {
    var json = JSON.stringify(obj);
    var b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, 'application/octet-stream', 'data')).getBytes());
    var parts = Math.max(1, Math.ceil(b64.length / API_CACHE_CHUNK));
    var map = {};
    for (var i = 0; i < parts; i++) map[key + ':' + i] = b64.substr(i * API_CACHE_CHUNK, API_CACHE_CHUNK);
    map[key] = String(parts);
    CacheService.getScriptCache().putAll(map, seconds);
  } catch (e) {
    // bez pamięci podręcznej działamy dalej
  }
}

/** Obiekt z pamięci podręcznej albo null (brak, wygasł, uszkodzony). */
function api_cacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var parts = Number(cache.get(key));
    if (!parts) return null;
    var keys = [];
    for (var i = 0; i < parts; i++) keys.push(key + ':' + i);
    var got = cache.getAll(keys);
    var b64 = '';
    for (var j = 0; j < keys.length; j++) {
      if (got[keys[j]] == null) return null;
      b64 += got[keys[j]];
    }
    var bytes = Utilities.base64Decode(b64);
    var json = Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip', 'data.gz')).getDataAsString();
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// ---- Harmonogram: jeden odczyt bloku A14:AB zamiast ok. 20 osobnych odczytów, bez logów ----

function api_getHarmData_(fresh) {
  if (!fresh) {
    var cached = api_cacheGet_('harm:v2');
    if (cached) return cached;
  }
  var data = api_readHarmData_();
  api_cachePut_('harm:v2', data, API_HARM_TTL);
  return data;
}

function api_readHarmData_() {
  var ss = SpreadsheetApp.openById(HARM_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(HARM_SHEET_NAME);
  if (!sheet) throw new Error('Nie znaleziono karty: ' + HARM_SHEET_NAME);

  var startRow = 14;
  var lastRow = sheet.getLastRow();
  var holidaySheet = ss.getSheetByName('setup');
  var holidays = holidaySheet ? holidaySheet.getRange('A2:A30').getDisplayValues().map(function (r) { return r[0]; }).filter(String) : [];
  if (lastRow < startRow) return { rows: [], holidays: holidays, rapData: {} };

  var rowCount = lastRow - startRow + 1;
  // Kolumny: A=0 lp, B..E=1..4 Z1..Z4, G=6 komis, H=7 element, I=8 start, K=10 godziny, M=12 koniec,
  // R=17 wysyłka, T=19 zak, X=23 dostawa, AB=27 stanowisko (tło i kolor czcionki osobno).
  var block = sheet.getRange(startRow, 1, rowCount, 28).getDisplayValues();
  var stationRange = sheet.getRange(startRow, 28, rowCount, 1);
  var bgs = stationRange.getBackgrounds();
  var fonts = stationRange.getFontColors();

  var rows = [];
  for (var i = 0; i < rowCount; i++) {
    var r = block[i];
    var row = {
      rowIndex: startRow + i,
      lp: r[0], z1: r[1], z2: r[2], z3: r[3], z4: r[4],
      client: r[5], komis: r[6], element: r[7], start: r[8], startManual: r[9], godziny: r[10], endManual: r[11], koniec: r[12],
      wysylka: r[17], dostawa: r[23],
      stanowisko: r[27], stanowiskoBg: bgs[i][0], stanowiskoColor: fonts[i][0],
      zak: String(r[19] || '').trim().toLowerCase()
    };
    if (row.komis || row.element || row.start || row.koniec || row.stanowisko) rows.push(row);
  }

  // Realizacja z Rap_m_h: jeden odczyt całego arkusza; stanowiska w wierszu 2 (od kolumny B), dane od wiersza 4.
  var rapData = {};
  var rapSheet = ss.getSheetByName('Rap_m_h');
  if (rapSheet) {
    var all = rapSheet.getDataRange().getDisplayValues();
    if (all.length >= 4) {
      var stations = (all[1] || []).slice(1);
      for (var k = 3; k < all.length; k++) {
        var komis = String(all[k][0] || '').trim();
        if (!komis) continue;
        rapData[komis] = rapData[komis] || {};
        for (var s = 0; s < stations.length; s++) {
          var st = String(stations[s] || '').trim();
          if (!st) continue;
          var val = parseFloat(String(all[k][s + 1] || '').replace(',', '.'));
          if (!isNaN(val) && val > 0) rapData[komis][st] = (rapData[komis][st] || 0) + val;
        }
      }
    }
  }
  return { rows: rows, holidays: holidays, rapData: rapData };
}

// ---- Pełny grafik do liczenia w programie: karta graf_norm pliku Harmonogramu ----
// Zwraca { header: [...], rows: [[...]] }: kolumny od H (data DD-MM-RRRR) w prawo; wiersz 1 = nagłówki miejsc pracy (np. 1Si1), potem dzień po dniu.
function api_getGrafNorm_(fresh) {
  if (!fresh) {
    var cached = api_cacheGet_('grafnorm:v1');
    if (cached) return cached;
  }
  var ss = SpreadsheetApp.openById(HARM_SPREADSHEET_ID);
  var sheet = ss.getSheetByName('graf_norm');
  if (!sheet) throw new Error('Nie znaleziono karty: graf_norm');
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  var out = { header: [], rows: [], stations: [] };
  if (lastRow < 2 || lastCol < 8) return out;
  out.stations = sheet.getRange(1, 2, 1, 6).getDisplayValues()[0];   // B1:G1 = nazwy stanowisk
  var block = sheet.getRange(1, 8, lastRow, lastCol - 7).getDisplayValues();
  out.header = block[0];
  for (var i = 1; i < block.length; i++) {
    var r = block[i];
    if (!String(r[0]).trim()) continue;
    while (r.length && !String(r[r.length - 1]).trim()) r.pop();   // obcięcie pustych kolumn z prawej
    out.rows.push(r);
  }
  api_cachePut_('grafnorm:v1', out, 15);
  return out;
}

// ---- Grafik: odczyt z pamięcią podręczną (45 s), unieważnianą zapisem z aplikacji ----

function api_grVersion_() { return CacheService.getScriptCache().get('gr_ver') || '0'; }
function api_grBump_() { CacheService.getScriptCache().put('gr_ver', String(new Date().getTime()), 21600); }

function api_getGrData_(startDate, endDate, ctx, fresh) {
  var key = 'gr:' + api_grVersion_() + ':' + (startDate || '') + '|' + (endDate || '');
  var data = fresh ? null : api_cacheGet_(key);
  if (!data) {
    data = api_readGrData_(startDate, endDate);
    api_cachePut_(key, data, API_GR_TTL);
  }
  // Prawo edycji z uprawnień w zakładce Uzytkownicy; nie jest częścią pamięci podręcznej (zależy od użytkownika).
  return {
    rows: data.rows,
    extraValues: data.extraValues,
    extraBackgrounds: data.extraBackgrounds,
    extraFontColors: data.extraFontColors,
    canEdit: !!(ctx && ctx.permissions && ctx.permissions.grafik === 'write')
  };
}

function api_readGrData_(startDate, endDate) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('G');
  if (!sheet) throw new Error('Arkusz G nie istnieje!');

  var addr = sheet.getRange('A3:B3').getDisplayValues()[0];   // jeden odczyt zamiast dwóch
  var leftAddress = String(addr[0]).trim();
  var extraAddress = String(addr[1]).trim();

  if (startDate && endDate) {
    var headers = sheet.getRange(4, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    var startNumber = api_dateToNumber_(startDate);
    var endNumber = api_dateToNumber_(endDate);
    var startCol = null, endCol = null;
    headers.forEach(function (header, index) {
      var n = api_dateToNumber_(header);
      if (!n) return;
      if (startCol === null && n >= startNumber) startCol = index + 1;
      if (n <= endNumber) endCol = index + 1;
    });
    if (!startCol || !endCol || endCol < startCol) throw new Error('Nie znaleziono zakresu dat w wierszu 4 arkusza G.');
    var b3 = sheet.getRange(extraAddress);
    extraAddress = sheet.getRange(b3.getRow(), startCol, b3.getNumRows(), endCol - startCol + 1).getA1Notation();
  }

  var left = sheet.getRange(leftAddress);
  var extra = sheet.getRange(extraAddress);
  var values = left.getDisplayValues();
  var backgrounds = left.getBackgrounds();
  var fontColors = left.getFontColors();
  var rows = values.map(function (row, index) {
    return {
      rowIndex: index, name: row[0], value: row[1],
      nameBg: backgrounds[index][0], valueBg: backgrounds[index][1],
      nameColor: fontColors[index][0], valueColor: fontColors[index][1]
    };
  });
  return {
    rows: rows,
    extraValues: extra.getDisplayValues(),
    extraBackgrounds: extra.getBackgrounds(),
    extraFontColors: extra.getFontColors()
  };
}

// ---------------------------------------------------------------------------
// Test po wdrożeniu (uruchom w edytorze)
// ---------------------------------------------------------------------------

function api_selfTest() {
  var problems = [];
  var ss = SpreadsheetApp.getActive();

  ['I', 'ZP', 'ND_CACHE', 'PL_kontur', 'BN', 'N', 'G', 'PLAN',
   'Zakupy', 'Zakupy_ar', 'PSWT', API_USERS_SHEET].forEach(function (name) {
    if (!ss.getSheetByName(name)) problems.push('Brak zakładki: ' + name);
  });

  try {
    var users = api_loadUsers_();
    var n = Object.keys(users).length;
    if (!n) problems.push('Brak aktywnych użytkowników w ' + API_USERS_SHEET);
    Logger.log('Aktywnych użytkowników: ' + n);
  } catch (e) {
    problems.push('Użytkownicy: ' + e.message);
  }

  try {
    var usersSheet = ss.getSheetByName(API_USERS_SHEET);
    if (usersSheet) {
      var cols = api_permColumns_(usersSheet.getRange(1, 1, 1, Math.max(usersSheet.getLastColumn(), 4)).getValues()[0]);
      var missing = Object.keys(cols).filter(function (m) { return cols[m] === -1; })
        .map(function (m) { return API_PERM_MODULES[m]; });
      if (missing.length) {
        problems.push('W ' + API_USERS_SHEET + ' brak kolumn uprawnień: ' + missing.join(', ') +
          ' (uruchom api_setupPermissions; do tego czasu działa tryb zgodności ze starymi listami)');
      }
    }
    api_checkPermissionValues_().forEach(function (p) { problems.push(p); });
  } catch (e) {
    problems.push('Uprawnienia: ' + e.message);
  }

  try {
    SpreadsheetApp.openById(HARM_SPREADSHEET_ID).getName();
  } catch (e) {
    problems.push('Brak dostępu do arkusza Harmonogramu: ' + e.message);
  }

  // Funkcje tylko do odczytu wywołujemy naprawdę; funkcje zapisujące sprawdzamy niżej
  // jedynie przez typeof, żeby test nie zmieniał arkusza.
  ['getProductCodes', 'getHomeMissingPartsFromNdCacheV2', 'getStAllowedLocations', 'api_getPlanGrid']
    .forEach(function (name) {
      try {
        API_FUNCS[name].run([], { email: 'selftest', name: 'selftest', roles: [], permissions: {} });
      } catch (e) {
        problems.push(name + ': ' + e.message);
      }
    });

  var missing = [];
  ['processForm', 'getGrData', 'savePlanData', 'getToolOptions', 'getAllToolDetailsMap',
   'saveToolDataToBN', 'getBNbaseData', 'getBnPartsForTeamV2', 'getBn2dDataForTeamV2',
   'getStToolOptions', 'getStBasicToolMap', 'saveStSelectedToolsToN', 'saveScannedToolToN',
   'getHarmData', 'getZakupyData', 'getZakupyArchiveData', 'getZakupyProductCodes',
   'addZakupyItem', 'updateZakupyItem'].forEach(function (name) {
    if (typeof globalThis[name] !== 'function') missing.push(name);
  });
  if (missing.length) problems.push('Brak funkcji: ' + missing.join(', '));

  var result = problems.length ? 'PROBLEMY:\n- ' + problems.join('\n- ') : 'OK: wszystko gotowe';
  Logger.log(result);
  return result;
}

// ---------------------------------------------------------------------------
// Workflow (karta Z): odczyt i zapis (statusy A/B/C, data, tekst z formatowaniem E/F, zlecający)
// Karta: A zakończone, B w trakcie, C wstrzymane (znak „x”), D data, E komis, F zadanie, G zlecający, H kategoria (formuła).
// ---------------------------------------------------------------------------

var API_WORKFLOW_SHEET = 'Z';          // <- nazwa karty z workflow
var WF_STATUS_COLS = ['A', 'B', 'C'];  // tylko jedna z nich może mieć „x”
var WF_TEXT_COLS = ['E', 'F'];         // kolumny tekstowe z formatowaniem
var WF_DATE_FORMAT = 'yyyy.mm.dd hh:mm';
var WF_MAX_ITEMS = 100;
var WF_MAX_TEXT = 20000;

function wf_sheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(API_WORKFLOW_SHEET);
  if (!sheet) throw new Error('Nie znaleziono karty: ' + API_WORKFLOW_SHEET);
  return sheet;
}

function wf_colIdx_(letter) { return letter.charCodeAt(0) - 65; }

/** Fragmenty tekstu z formatowaniem albo null, gdy komórka nie ma żadnego formatowania. */
function wf_runsOf_(rt) {
  var runs = rt ? rt.getRuns() : [];
  var out = [], styled = false;
  runs.forEach(function (run) {
    var st = run.getTextStyle();
    var o = {
      text: run.getText(), bold: !!st.isBold(), italic: !!st.isItalic(),
      underline: !!st.isUnderline(), strike: !!st.isStrikethrough(), color: st.getForegroundColor() || null
    };
    if (o.color && String(o.color).toLowerCase() === '#000000') o.color = null;
    if (o.bold || o.italic || o.underline || o.strike || o.color) styled = true;
    out.push(o);
  });
  return styled ? out : null;
}

/** Odczyt: surowe wartości A–H od wiersza 2 jednym zapytaniem, plus formatowanie tekstu kolumn E i F. */
function api_getWorkflow_() {
  var sheet = wf_sheet_();
  var last = sheet.getLastRow();
  var headers = sheet.getRange(1, 1, 1, 8).getDisplayValues()[0];
  if (last < 2) return { headers: headers, rows: [] };
  var range = sheet.getRange(2, 1, last - 1, 8);
  var values = range.getDisplayValues();
  var rich = range.getRichTextValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var cells = values[i];
    if (cells.join('') === '') continue;
    var runs = {};
    WF_TEXT_COLS.forEach(function (col) {
      var r = wf_runsOf_(rich[i][wf_colIdx_(col)]);
      if (r) runs[col] = r;
    });
    rows.push({ row: i + 2, cells: cells, runs: runs });
  }
  return { headers: headers, rows: rows };
}

/** Tekst z formatowaniem → RichTextValue. cell = {text, runs:[{text,bold,italic,underline,strike,color}]}. */
function wf_buildRich_(cell) {
  var runs = cell && Array.isArray(cell.runs) && cell.runs.length ? cell.runs : [{ text: String((cell && cell.text) || '') }];
  var text = runs.map(function (r) { return String(r.text == null ? '' : r.text); }).join('');
  if (text.length > WF_MAX_TEXT) throw new Error('Tekst jest za długi.');
  var builder = SpreadsheetApp.newRichTextValue().setText(text);
  var pos = 0;
  runs.forEach(function (r) {
    var len = String(r.text == null ? '' : r.text).length;
    var start = pos, end = pos + len;
    pos = end;
    if (end <= start) return;
    var color = /^#[0-9a-fA-F]{6}$/.test(String(r.color || '')) ? r.color : null;
    if (!(r.bold || r.italic || r.underline || r.strike || color)) return;
    var ts = SpreadsheetApp.newTextStyle()
      .setBold(!!r.bold).setItalic(!!r.italic).setUnderline(!!r.underline).setStrikethrough(!!r.strike);
    if (color) ts.setForegroundColor(color);
    builder.setTextStyle(start, end, ts.build());
  });
  return { text: text, rich: builder.build() };
}

/** Pierwsze [count] wierszy bez żadnej wartości w A–G (kolumna H z formułą się nie liczy). */
function wf_freeRows_(sheet, count) {
  var max = sheet.getMaxRows();
  var vals = sheet.getRange(2, 1, max - 1, 7).getDisplayValues();
  var rows = [];
  for (var i = 0; i < vals.length && rows.length < count; i++) {
    if (vals[i].join('') === '') rows.push(i + 2);
  }
  if (rows.length < count) throw new Error('Brak wolnych wierszy w karcie ' + API_WORKFLOW_SHEET + '.');
  return rows;
}

/** Data (tylko gdy pusta), zlecający (tylko gdy pusty) i formuła kategorii (tylko gdy brak) w wierszu. */
function wf_fillAuto_(sheet, row, ctx) {
  var d = sheet.getRange(row, 4);
  if (String(d.getDisplayValue()).trim() === '') {
    d.setNumberFormat(WF_DATE_FORMAT);
    d.setValue(new Date());
  }
  var g = sheet.getRange(row, 7);
  if (String(g.getDisplayValue()).trim() === '') g.setValue((ctx && (ctx.name || ctx.email)) || '');
  var h = sheet.getRange(row, 8);
  if (row > 2 && String(h.getFormula()) === '' && String(h.getDisplayValue()) === '') {
    var src = sheet.getRange(row - 1, 8);
    if (String(src.getFormula()) !== '') src.copyTo(h, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
  }
}

/**
 * Zapis. items = [{ row: numer wiersza albo null dla nowego,
 *   status: 'A'|'B'|'C'|'' (pominięte = bez zmiany),
 *   cells: { E: {text, runs}, F: {text, runs} },
 *   expect: { E: 'poprzedni tekst', F: '...' } }]  – gdy tekst w arkuszu jest inny, zapis jest odrzucany.
 */
function api_saveWorkflow_(items, ctx) {
  if (!Array.isArray(items) || !items.length) throw new Error('Brak zmian do zapisu.');
  if (items.length > WF_MAX_ITEMS) throw new Error('Za dużo zmian naraz.');
  var sheet = wf_sheet_();
  var max = sheet.getMaxRows();
  var newCount = 0;

  // 1. Walidacja wszystkiego przed pierwszym zapisem (bez częściowych zapisów).
  items.forEach(function (it) {
    if (!it || typeof it !== 'object') throw new Error('Nieprawidłowa zmiana.');
    var isNew = !it.row;
    if (isNew) {
      newCount++;
      var has = WF_TEXT_COLS.some(function (c) { return it.cells && it.cells[c] && wf_buildRich_(it.cells[c]).text.trim() !== ''; });
      if (!has) throw new Error('Wpisz komis albo treść zadania.');
    } else {
      var row = Number(it.row);
      if (!(row >= 2 && row <= max)) throw new Error('Nieprawidłowy numer wiersza: ' + it.row);
    }
    if (it.status !== undefined && ['', 'A', 'B', 'C'].indexOf(it.status) === -1) throw new Error('Nieprawidłowy status.');
    Object.keys(it.cells || {}).forEach(function (c) {
      if (WF_TEXT_COLS.indexOf(c) === -1) throw new Error('Kolumna ' + c + ' nie jest edytowalna.');
      wf_buildRich_(it.cells[c]);
    });
    if (!isNew) {
      Object.keys(it.expect || {}).forEach(function (c) {
        if (WF_TEXT_COLS.indexOf(c) === -1) return;
        var current = String(sheet.getRange(Number(it.row), wf_colIdx_(c) + 1).getDisplayValue()).trim();
        if (current !== String(it.expect[c]).trim()) {
          throw new Error('Wiersz ' + it.row + ' zmienił się od ostatniego odświeżenia. Odśwież listę i spróbuj ponownie.');
        }
      });
    }
  });

  // 2. Zapis.
  var free = newCount ? wf_freeRows_(sheet, newCount) : [];
  var written = [];
  items.forEach(function (it) {
    var row = it.row ? Number(it.row) : free.shift();
    if (it.status !== undefined) {
      sheet.getRange(row, 1, 1, 3).setValues([WF_STATUS_COLS.map(function (c) { return c === it.status ? 'x' : ''; })]);
    }
    Object.keys(it.cells || {}).forEach(function (c) {
      var built = wf_buildRich_(it.cells[c]);
      sheet.getRange(row, wf_colIdx_(c) + 1).setRichTextValue(built.rich);
    });
    wf_fillAuto_(sheet, row, ctx);
    written.push(row);
  });
  SpreadsheetApp.flush();
  return { message: 'Zapisano zmiany: ' + written.length + '.', rows: written };
}

/** Test w edytorze (Uruchom → api_testWorkflow → Dziennik wykonywania). Niczego nie zapisuje. */
function api_testWorkflow() {
  var r = api_getWorkflow_();
  Logger.log('Wiersze: ' + r.rows.length);
  Logger.log('Nagłówki: ' + r.headers.join(' | '));
  Logger.log(JSON.stringify(r.rows.slice(0, 3)));
}
