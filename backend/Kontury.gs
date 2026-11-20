/**
 * Kontury.gs — edytor konturów narzędzi (Narzędziownia → Kontury w programie PC).
 *
 * Arkusz ND_CACHE (STOCKSHEET, zakres danych w komórce ND_CACHE_RANGE_CELL – Code_Ndobor.js):
 *   kolumna A – kod narzędzia, kolumna T – dawny kontur (pary x_y w 0,1 mm; bez zmian),
 *   kolumna V – nowy kontur z edytora: ścieżka SVG w milimetrach (x = ±promień, y = pozycja wzdłuż osi), np. "M -10 0 L 10 0 … Z".
 * Wiersze ND_CACHE są stałe – kontur trafia do kolumny V wiersza z tym samym kodem (kolumna A sprawdzana przy zapisie).
 *
 * W Api.gs (API_FUNCS):
 *   ndContoursV:    { run: function () { return nd_contoursV_(); } },
 *   ndSaveContourV: { write: true, run: function (a, ctx) { return nd_saveContourV_(a[0], a[1], ctx); } },
 * Zapis: poziom MASTER lub GOD w kolumnie „Grafik dostęp” (Firebase.gs: api_requireGrafikLevel_).
 */

var ND_V_COL = 22; // V

/** Wiersze danych ND_CACHE z zakresu w komórce (np. "A4:U900") → { sheet, first, count }. */
function nd_rows_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(STOCKSHEET);
  if (!sheet) throw new Error('Arkusz o nazwie ' + STOCKSHEET + ' nie istnieje!');
  var rangeText = String(sheet.getRange(ND_CACHE_RANGE_CELL).getDisplayValue() || '').trim();
  var m = /^[A-Z]+(\d+):[A-Z]+(\d+)$/i.exec(rangeText.replace(/\$/g, ''));
  if (!m) throw new Error('Nieprawidłowy zakres danych w komórce ' + ND_CACHE_RANGE_CELL + ': ' + rangeText);
  var first = Number(m[1]), last = Math.min(Number(m[2]), sheet.getLastRow());
  return { sheet: sheet, first: first, count: Math.max(0, last - first + 1) };
}

var nd_norm_ = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };

/** Kontury z kolumny V: { kod (małe litery): ścieżka SVG }. */
function nd_contoursV_() {
  var r = nd_rows_();
  if (!r.count) return {};
  var codes = r.sheet.getRange(r.first, 1, r.count, 1).getDisplayValues();
  var v = r.sheet.getRange(r.first, ND_V_COL, r.count, 1).getDisplayValues();
  var out = {};
  for (var i = 0; i < r.count; i++) {
    var code = nd_norm_(codes[i][0]), path = String(v[i][0] || '').trim();
    if (code && path) out[code] = path;
  }
  return out;
}

/** Zapis konturu [path] (SVG w mm, pusty – usunięcie) do kolumny V wiersza narzędzia [code]. */
function nd_saveContourV_(code, path, ctx) {
  api_requireGrafikLevel_(ctx, 'master');
  var want = nd_norm_(code);
  if (!want) throw new Error('Brak kodu narzędzia.');
  path = String(path || '').trim();
  if (path && !/^M[\s\d\-.,MLAQZ]+$/i.test(path)) throw new Error('Kontur nie jest ścieżką SVG (M, L, A, Q, Z).');
  if (path.length > 45000) throw new Error('Kontur jest za długi (' + path.length + ' znaków).');
  var r = nd_rows_();
  var codes = r.sheet.getRange(r.first, 1, r.count, 1).getDisplayValues();
  for (var i = 0; i < r.count; i++) {
    if (nd_norm_(codes[i][0]) !== want) continue;
    var row = r.first + i;
    if (nd_norm_(r.sheet.getRange(row, 1).getDisplayValue()) !== want) throw new Error('Kod w wierszu ' + row + ' się nie zgadza – spróbuj ponownie.');
    r.sheet.getRange(row, ND_V_COL).setValue(path);
    return { row: row, code: String(codes[i][0]).trim(), length: path.length };
  }
  throw new Error('Nie ma narzędzia ' + code + ' w arkuszu ' + STOCKSHEET + '.');
}

// ---------- generator konturów z danych (zamiast formuły w PSWT!AW) ----------
// Program liczy kontur z kolumn D:N arkusza PSWT i mocowania z zakładki „kontury” (kolumny A:C – wartości z formuł tej zakładki).
//   ndContourData:   { run: function () { return nd_contourData_(); } },
//   ndSaveContoursV: { write: true, run: function (a, ctx) { return nd_saveContoursV_(a[0], ctx); } },

/** Dane do generatora: mocowania { kod: {left, right} } i parametry narzędzi z PSWT { kod (małe litery): {C, D … N} }. */
function nd_contourData_() {
  var ss = SpreadsheetApp.getActive();
  var mounts = {}, params = {};
  var k = ss.getSheetByName('kontury');
  if (k && k.getLastRow() > 1) {
    k.getRange(2, 1, k.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      var code = String(r[0] || '').trim();
      if (code) mounts[code] = { left: String(r[1] || ''), right: String(r[2] || '') };
    });
  }
  var p = ss.getSheetByName('PSWT');
  if (p && p.getLastRow() > 1) {
    var keys = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
    var n = p.getLastRow() - 1;
    var bh = p.getRange(2, ND_PSWT_OK_COL, n, 1).getDisplayValues();   // potwierdzenie poprawności konturu
    p.getRange(2, 2, n, 13).getDisplayValues().forEach(function (r, idx) {
      var code = nd_norm_(r[0]);
      if (!code || !String(r[2] || '').trim()) return;
      var o = {};
      for (var i = 1; i < keys.length; i++) o[keys[i]] = String(r[i] || '').trim();
      o.BH = String(bh[idx][0] || '').trim();
      params[code] = o;
    });
  }
  return { mounts: mounts, params: params };
}

var ND_PSWT_OK_COL = 60; // BH – potwierdzenie poprawności konturu (PSWT)

/**
 * Potwierdzenie poprawności konturu narzędzia [code] w arkuszu PSWT, kolumna BH ([value] – np. „OK 20.11.2026 Kowalski”, pusty – cofnięcie).
 *   ndConfirmContour: { write: true, run: function (a, ctx) { return nd_confirmContour_(a[0], a[1], ctx); } },
 */
function nd_confirmContour_(code, value, ctx) {
  api_requireGrafikLevel_(ctx, 'master');
  var want = nd_norm_(code);
  if (!want) throw new Error('Brak kodu narzędzia.');
  var p = SpreadsheetApp.getActive().getSheetByName('PSWT');
  if (!p) throw new Error('Arkusz PSWT nie istnieje!');
  var n = p.getLastRow() - 1;
  var codes = p.getRange(2, 2, n, 1).getDisplayValues();
  for (var i = 0; i < n; i++) {
    if (nd_norm_(codes[i][0]) !== want) continue;
    var row = i + 2;
    p.getRange(row, ND_PSWT_OK_COL).setValue(String(value || '').slice(0, 200));
    return { row: row, value: String(value || '') };
  }
  throw new Error('Nie ma narzędzia ' + code + ' w kolumnie B arkusza PSWT.');
}

/** Zapis wielu konturów naraz: { kod: ścieżka SVG } do kolumny V (jeden zapis kolumny). Wynik: { saved, missing: [kody] }. */
function nd_saveContoursV_(items, ctx) {
  api_requireGrafikLevel_(ctx, 'master');
  items = items || {};
  var want = {};
  Object.keys(items).forEach(function (c) {
    var path = String(items[c] || '').trim();
    if (path && !/^M[\s\d\-.,MLAQZ]+$/i.test(path)) throw new Error('Kontur ' + c + ' nie jest ścieżką SVG.');
    want[nd_norm_(c)] = path;
  });
  var r = nd_rows_();
  var codes = r.sheet.getRange(r.first, 1, r.count, 1).getDisplayValues();
  var range = r.sheet.getRange(r.first, ND_V_COL, r.count, 1);
  var v = range.getValues(), saved = 0, found = {};
  for (var i = 0; i < r.count; i++) {
    var c = nd_norm_(codes[i][0]);
    if (c && Object.prototype.hasOwnProperty.call(want, c)) { v[i][0] = want[c]; found[c] = true; saved++; }
  }
  range.setValues(v);
  return { saved: saved, missing: Object.keys(want).filter(function (c) { return !found[c]; }) };
}
