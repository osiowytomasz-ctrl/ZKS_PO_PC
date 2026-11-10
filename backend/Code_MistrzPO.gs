/**
 * Code_MistrzPO.js – rejestry detali, operacji i dokumentacji z arkusza Mistrz_po (używane przez Skaner w aplikacji).
 *
 * Logika przeniesiona ze skryptu Mistrz_po (osobny arkusz, katalog mistrz-po/): ten sam arkusz,
 * te same zakładki, te same reguły zapisu. Różnice względem oryginału:
 *  - arkusz jest otwierany przez openById (skrypt działa jako właściciel, nie jako użytkownik),
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

function mp_now_() {
  var now = new Date();
  return {
    date: Utilities.formatDate(now, MP_TZ, 'dd.MM.yyyy'),
    time: Utilities.formatDate(now, MP_TZ, 'HH:mm')
  };
}

function mp_shortName_(email) {
  return mp_str_(email).split('@')[0];
}

/** Wartości A..lastCol od firstRow; pusta tablica, gdy w arkuszu nie ma jeszcze takich wierszy. */
function mp_rows_(sheet, firstRow, lastCol) {
  var lastRow = sheet.getLastRow();
  if (lastRow < firstRow) return [];
  return sheet.getRange(firstRow, 1, lastRow - firstRow + 1, lastCol).getValues();
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
  manage: 'Brak uprawnień do zmiany statusu i usuwania operacji.',
  details: 'Brak uprawnień do tworzenia listy detali.',
  docs: 'Brak uprawnień do rejestru dokumentacji (wyświetlanie i usuwanie).'
};

function mp_require_(ctx, key) {
  if (!mp_perms_(ctx.email)[key]) throw api_error_('FORBIDDEN', MP_PERM_LABELS[key]);
}

function mp_getPermissions_(ctx) {
  return mp_perms_(ctx.email);
}

// ---------------------------------------------------------------------------
// Rejestr detali
// ---------------------------------------------------------------------------

function mp_saveDetail_(form, ctx) {
  form = form || {};
  var dataSheet = mp_sheet_(MP_DETAIL_SHEET);
  var listSheet = mp_sheet_(MP_LIST_SHEET);

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

  var listRows = mp_rows_(listSheet, MP_LIST_FIRST_ROW, 7); // A..G
  if (!listRows.length) throw new Error('Błąd: Lista detali jest pusta!');
  var detailMap = {};
  listRows.forEach(function (row) {
    // B komis, D nr rysunku, E nr pozycji, F atrybut, G ilość zlecona
    var key = [mp_str_(row[1]), mp_str_(row[3]), mp_str_(row[4]), mp_str_(row[5])].join('|');
    detailMap[key] = Number(row[6] || 0);
  });
  var detailKey = [colC, colG, colH, colF].join('|');
  if (!(detailKey in detailMap)) throw new Error('Detal nie zarejestrowany na liście detali!');
  var orderedQuantity = detailMap[detailKey];

  var rows = mp_rows_(dataSheet, MP_DETAIL_FIRST_ROW, 10); // A..J
  var newRow = MP_DETAIL_FIRST_ROW + rows.length;
  var registered = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!(row[2] || row[3] || row[4])) { // C, D, E puste = pierwszy wolny wiersz
      newRow = MP_DETAIL_FIRST_ROW + i;
      break;
    }
    if (mp_str_(row[2]) === colC && mp_str_(row[3]) === colG && mp_str_(row[4]) === colH && mp_str_(row[5]) === colF) {
      registered += Number(row[6] || 0);
    }
  }

  if (registered + extraNum > orderedQuantity) {
    var allowed = orderedQuantity - registered;
    throw new Error('Zarejestrowano ' + registered + ' detali, dozwolona ilość: ' + allowed + '. Skontaktuj się z Mistrzem PO.');
  }

  var t = mp_now_();
  dataSheet.getRange(newRow, 1, 1, 8).setValues([[t.date, t.time, colC, colG, colH, colF, extra, ctx.email]]);
  return { status: 'success', message: 'Dane zapisane w wierszu ' + newRow + ' przez ' + mp_shortName_(ctx.email) };
}

// ---------------------------------------------------------------------------
// Rejestr operacji
// ---------------------------------------------------------------------------

function mp_operRows_(sheet) {
  return mp_rows_(sheet, MP_OPER_FIRST_ROW, 13); // A..M
}

/** Kopiuje formuły i formatowanie K:M z wiersza źródłowego (jak w oryginale). */
function mp_copyFormulas_(sheet, targetRow) {
  var src = sheet.getRange(MP_OPER_FORMULA_SOURCE_ROW, 11, 1, 3);
  var dst = sheet.getRange(targetRow, 11, 1, 3);
  src.copyTo(dst, { contentsOnly: false });
  src.copyTo(dst, { formatOnly: true });
}

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

/**
 * Wyszukiwanie operacji. conditions: {indeksKolumny: wartość | funkcja}, columns: indeksy kolumn wyniku
 * [E, C, D, F, H, ostatnia]. Wynik posortowany po pierwszej kolumnie (nr operacji).
 */
function mp_searchOperations_(conditions, columns) {
  var rows = mp_operRows_(mp_sheet_(MP_OPER_SHEET));
  var keys = Object.keys(conditions);
  var found = rows.filter(function (row) {
    return keys.every(function (colIndex) {
      var cond = conditions[colIndex];
      var value = mp_str_(row[parseInt(colIndex, 10)]);
      return typeof cond === 'function' ? cond(value) : value === String(cond);
    });
  }).map(function (row) {
    var out = {};
    ['nr', 'komis', 'przewodnik', 'klient', 'operator', 'status'].forEach(function (name, i) {
      out[name] = mp_str_(row[columns[i]]);
    });
    return out;
  });
  found.sort(function (a, b) { return a.nr.toLowerCase().localeCompare(b.nr.toLowerCase()); });
  return found;
}

/** Zaległe operacje komisu: status Start i kolumna K różna od „Koniec”. */
function mp_pendingOperations_(komis) {
  return mp_searchOperations_({ 2: mp_str_(komis), 8: 'Start', 10: function (v) { return v !== 'Koniec'; } },
    [4, 2, 3, 5, 7, 10]);
}

/** Wszystkie operacje komisu i przewodnika (podgląd); status z kolumny I. */
function mp_displayOperations_(komis, przewodnik) {
  return mp_searchOperations_({ 2: mp_str_(komis), 3: mp_str_(przewodnik) }, [4, 2, 3, 5, 7, 8]);
}

/** Aktywne (nieusunięte) operacje o danym komisie, przewodniku i numerze. */
function mp_findOperations_(komis, przewodnik, nr) {
  return mp_searchOperations_({
    2: mp_str_(komis), 3: mp_str_(przewodnik), 4: mp_str_(nr),
    8: function (v) { return v !== 'Usunięta'; }
  }, [4, 2, 3, 5, 7, 8]);
}

function mp_saveOperation_(form, ctx) {
  form = form || {};
  var sheet = mp_sheet_(MP_OPER_SHEET);
  if (!mp_str_(form.productCode)) throw new Error('Brak operacji!');

  var p = mp_parseOperCode_(form.productCode);
  if (!p.komis || !p.przewodnik || !p.nr) throw new Error('Brak danych w kluczowych polach (Komis, Przewodnik, Nr operacji)!');

  var status = mp_str_(form.status) || 'Start';
  if (MP_OPER_STATUSES.indexOf(status) === -1) throw new Error('Nieprawidłowy status operacji: ' + status);

  var rows = mp_operRows_(sheet);
  var newRow = MP_OPER_FIRST_ROW + rows.length;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].some(function (cell) { return cell; })) { newRow = MP_OPER_FIRST_ROW + i; break; }
  }

  var hasStart = false, hasEnd = false;
  rows.forEach(function (row) {
    if (mp_str_(row[2]) === p.komis && mp_str_(row[3]) === p.przewodnik && mp_str_(row[4]) === p.nr) {
      var s = mp_str_(row[8]);
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
  sheet.getRange(newRow, 1, 1, 10).setValues([[
    t.date, t.time, p.komis, p.przewodnik, p.nr, p.klient, p.rysunek, ctx.email, status, mp_str_(form.notes)
  ]]);
  SpreadsheetApp.flush();
  mp_copyFormulas_(sheet, newRow);
  SpreadsheetApp.flush();

  return { status: 'success', message: 'Dane zapisane w wierszu ' + newRow + ' przez ' + mp_shortName_(ctx.email) };
}

/** Zmiana statusu zakończonej operacji z powrotem na „W toku” (uprawnienie manage). */
function mp_changeOperationStatus_(form, ctx) {
  mp_require_(ctx, 'manage');
  form = form || {};
  var sheet = mp_sheet_(MP_OPER_SHEET);
  var p = mp_parseOperCode_(form.productCode);
  if (!p.komis || !p.przewodnik || !p.nr) throw new Error('Brak danych w kluczowych polach!');

  var rows = mp_operRows_(sheet);
  var targetRow = -1;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (mp_str_(r[2]) === p.komis && mp_str_(r[3]) === p.przewodnik && mp_str_(r[4]) === p.nr && mp_str_(r[8]) === 'Koniec') {
      targetRow = MP_OPER_FIRST_ROW + i;
      if (mp_str_(r[10]) !== 'Koniec') throw new Error('Operacja nie jest zakończona (status K: ' + mp_str_(r[10]) + ')!');
      break;
    }
  }
  if (targetRow === -1) throw new Error("Nie znaleziono operacji ze statusem 'Koniec'!");

  var t = mp_now_();
  var who = mp_shortName_(ctx.email);
  var note = 'Zmiana statusu na W toku: ' + t.date + ' ' + t.time + ' przez ' + who;
  var current = mp_str_(sheet.getRange(targetRow, 10).getValue());
  sheet.getRange(targetRow, 9, 1, 2).setValues([['W toku', current ? current + '; ' + note : note]]);
  SpreadsheetApp.flush();
  mp_copyFormulas_(sheet, targetRow);
  SpreadsheetApp.flush();

  return { status: 'success', message: "Status zmieniony na 'W toku' w wierszu " + targetRow + ' przez ' + who };
}

/** Oznacza wszystkie aktywne wiersze operacji jako „Usunięta” (uprawnienie manage); dane zostają w arkuszu. */
function mp_deleteOperation_(form, ctx) {
  mp_require_(ctx, 'manage');
  form = form || {};
  var sheet = mp_sheet_(MP_OPER_SHEET);
  var p = mp_parseOperCode_(form.productCode);
  if (!p.komis || !p.przewodnik || !p.nr) throw new Error('Brak danych w kluczowych polach!');

  var rows = mp_operRows_(sheet);
  var t = mp_now_();
  var who = mp_shortName_(ctx.email);
  var note = 'Usunięto: ' + t.date + ' ' + t.time + ' przez ' + who;
  var updated = [];
  rows.forEach(function (row, i) {
    if (mp_str_(row[2]) === p.komis && mp_str_(row[3]) === p.przewodnik && mp_str_(row[4]) === p.nr && mp_str_(row[8]) !== 'Usunięta') {
      var current = mp_str_(row[9]);
      updated.push({ row: MP_OPER_FIRST_ROW + i, values: ['Usunięta', current ? current + '; ' + note : note] });
    }
  });
  if (!updated.length) throw new Error('Nie znaleziono aktywnych operacji!');

  updated.forEach(function (u) { sheet.getRange(u.row, 9, 1, 2).setValues([u.values]); });
  SpreadsheetApp.flush();
  updated.forEach(function (u) { mp_copyFormulas_(sheet, u.row); });
  SpreadsheetApp.flush();

  return { status: 'success', message: "Status " + updated.length + " operacji zmieniony na 'Usunięta' przez " + who };
}

// ---------------------------------------------------------------------------
// Rejestr dokumentacji
// ---------------------------------------------------------------------------

function mp_saveDocument_(form, ctx) {
  form = form || {};
  var sheet = mp_sheet_(MP_DOC_SHEET);
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

  var values = mp_rows_(sheet, MP_DOC_FIRST_ROW, 10).map(function (r) { return r.slice(2, 9); }); // C..I
  var duplicate = values.some(function (row) { return mp_str_(row[0]) === colC && mp_str_(row[1]) === colD; });
  if (duplicate) {
    throw new Error("Błąd: Dokument o numerze przewodnika '" + colD + "' i numerze komis '" + colC + "' już istnieje w rejestrze!");
  }

  var newRow = MP_DOC_FIRST_ROW + values.length;
  for (var i = 0; i < values.length; i++) {
    if (values[i].every(function (cell) { return !cell; })) { newRow = MP_DOC_FIRST_ROW + i; break; }
  }

  var t = mp_now_();
  sheet.getRange(newRow, 1, 1, 10).setValues([[t.date, t.time, colC, colD, colE, colF, colG, colH, colI, ctx.email]]);
  return { status: 'success', message: 'Dokument został pomyślnie zapisany w wierszu: ' + newRow + ' przez: ' + mp_shortName_(ctx.email) };
}

/** Wpisy rejestru dokumentacji, najnowsze na górze (uprawnienie docs). filter: {komis, przewodnik} opcjonalnie. */
function mp_listDocuments_(filter, ctx) {
  mp_require_(ctx, 'docs');
  filter = filter || {};
  var komis = mp_str_(filter.komis).trim();
  var przewodnik = mp_str_(filter.przewodnik).trim();
  var rows = mp_rows_(mp_sheet_(MP_DOC_SHEET), MP_DOC_FIRST_ROW, 10);
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < MP_DOC_LIST_LIMIT; i--) {
    var r = rows[i];
    if (r.every(function (cell) { return !cell; })) continue;
    if (komis && mp_str_(r[2]) !== komis) continue;
    if (przewodnik && mp_str_(r[3]) !== przewodnik) continue;
    out.push({
      row: MP_DOC_FIRST_ROW + i,
      date: mp_displayCell_(r[0]), time: mp_displayCell_(r[1]),
      komis: mp_str_(r[2]), przewodnik: mp_str_(r[3]), typ: mp_str_(r[4]), nazwa: mp_str_(r[5]),
      rysunek: mp_str_(r[6]), id: mp_str_(r[7]), ilosc: mp_str_(r[8]), operator: mp_str_(r[9])
    });
  }
  return out;
}

/** Data i godzina z arkusza mogą być obiektami Date; zwracamy czytelny tekst. */
function mp_displayCell_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, MP_TZ, v.getFullYear() < 1950 ? 'HH:mm' : 'dd.MM.yyyy');
  }
  return mp_str_(v);
}

/**
 * Usuwa wpis rejestru dokumentacji (czyści wiersz A:J, formatowanie zostaje) – uprawnienie docs.
 * form: {row, komis, przewodnik}. Numer wiersza jest sprawdzany z komisem i przewodnikiem, więc
 * wiersz przesunięty w arkuszu od ostatniego odczytu nie zostanie usunięty przez pomyłkę.
 */
function mp_deleteDocument_(form, ctx) {
  mp_require_(ctx, 'docs');
  form = form || {};
  var row = Number(form.row);
  if (!isFinite(row) || row < MP_DOC_FIRST_ROW || Math.floor(row) !== row) throw new Error('Nieprawidłowy numer wiersza.');
  var sheet = mp_sheet_(MP_DOC_SHEET);
  if (row > sheet.getLastRow()) throw new Error('Wpis nie istnieje. Odśwież listę.');
  var cur = sheet.getRange(row, 1, 1, 10).getValues()[0];
  if (mp_str_(cur[2]) !== mp_str_(form.komis) || mp_str_(cur[3]) !== mp_str_(form.przewodnik)) {
    throw new Error('Wiersz w arkuszu zmienił się od ostatniego odczytu. Odśwież listę.');
  }
  console.log('[Mistrz PO] Usunięto dokument, wiersz ' + row + ' (' + JSON.stringify(cur) + ') przez ' + ctx.email);
  sheet.getRange(row, 1, 1, 10).clearContent();
  return { status: 'success', message: 'Usunięto wpis z wiersza ' + row + ' przez ' + mp_shortName_(ctx.email) };
}

// ---------------------------------------------------------------------------
// Lista detali (uprawnienie details)
// ---------------------------------------------------------------------------

function mp_listDetails_(ctx) {
  mp_require_(ctx, 'details');
  var rows = mp_rows_(mp_sheet_(MP_LIST_SHEET), MP_LIST_FIRST_ROW, 7); // A..G
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < MP_DETAIL_LIST_LIMIT; i--) {
    var r = rows[i];
    if (!(r[1] || r[3] || r[4])) continue;
    out.push({
      row: MP_LIST_FIRST_ROW + i,
      komis: mp_str_(r[1]), rysunek: mp_str_(r[3]), pozycja: mp_str_(r[4]), komplet: mp_str_(r[5]), ilosc: mp_str_(r[6])
    });
  }
  return out;
}

/**
 * Dodaje pozycję do listy detali. form: {komis, rysunek, pozycja, komplet, ilosc}.
 * Zapisywane są tylko kolumny B (komis) i D:G (rysunek, pozycja, komplet, ilość zlecona); A i C zostają nietknięte.
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

  var sheet = mp_sheet_(MP_LIST_SHEET);
  var rows = mp_rows_(sheet, MP_LIST_FIRST_ROW, 7);
  var key = [komis, rysunek, pozycja, komplet].join('|');
  var newRow = -1;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!(r[1] || r[3] || r[4])) { if (newRow === -1) newRow = MP_LIST_FIRST_ROW + i; continue; }
    if ([mp_str_(r[1]), mp_str_(r[3]), mp_str_(r[4]), mp_str_(r[5])].join('|') === key) {
      throw new Error('Taki detal jest już na liście (wiersz ' + (MP_LIST_FIRST_ROW + i) + ', ilość zlecona ' + mp_str_(r[6]) + ').');
    }
  }
  if (newRow === -1) newRow = MP_LIST_FIRST_ROW + rows.length;

  sheet.getRange(newRow, 2).setValue(komis);
  sheet.getRange(newRow, 4, 1, 4).setValues([[rysunek, pozycja, komplet, ilosc]]);
  return { status: 'success', message: 'Dodano detal do listy w wierszu ' + newRow + ' przez ' + mp_shortName_(ctx.email) };
}

// ---------------------------------------------------------------------------
// Test w edytorze (bez zapisu): sprawdza dostęp do arkusza i zakładek
// ---------------------------------------------------------------------------

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
  var result = problems.length ? 'PROBLEMY:\n- ' + problems.join('\n- ') : 'OK: Mistrz PO gotowy';
  Logger.log(result);
  return result;
}
