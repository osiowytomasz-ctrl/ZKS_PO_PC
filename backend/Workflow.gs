/**
 * Workflow (karta Z) – backend dla aplikacji.
 * Wklej do Api.gs (albo osobny plik projektu) i dopisz do API_FUNCS dwa wpisy z komentarza na końcu pliku.
 * Karta ma kolumny: A zakończone, B w trakcie, C wstrzymane (znak „x”), D data, E komis, F zadanie, G zlecający, H kategoria (formuła).
 */
var API_WORKFLOW_SHEET = 'Z';          // <- nazwa karty z workflow
var WF_STATUS_COLS = ['A', 'B', 'C'];  // tylko jedna z nich może mieć „x”
var WF_TEXT_COLS = ['E', 'F'];         // kolumny tekstowe z formatowaniem
var WF_DATE_FORMAT = 'yyyy-mm-dd hh:mm';
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

/*
 * Wpisy do API_FUNCS w Api.gs (zastąp stary wpis api_getWorkflow):
 *
 *   api_getWorkflow: {
 *     run: function () { return api_getWorkflow_(); }
 *   },
 *   api_saveWorkflow: {
 *     write: true,
 *     run: function (a, ctx) { return api_saveWorkflow_(a[0], ctx); }
 *   },
 */
