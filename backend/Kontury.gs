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
