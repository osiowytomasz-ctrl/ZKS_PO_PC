/**
 * GrafikAudit.gs – analiza Grafiku przed przeniesieniem do Firebase (TYLKO ODCZYT arkuszy).
 *
 * Uruchom w edytorze Apps Script funkcję `grafikAudit` (raz). Skrypt niczego nie zmienia w arkuszach – czyta strukturę karty G
 * (formuły, formatowanie warunkowe, listy wyboru, kolory, scalenia, nazwane zakresy, ochronę), odwołania innych kart do G,
 * użycie funkcji countColoredCells / sumColoredCells oraz kartę graf_norm w pliku Harmonogramu, i zapisuje raport
 * jako plik JSON na Twoim Dysku Google (link w dzienniku wykonania). Nazwiska pracowników NIE trafiają do raportu
 * (tylko liczby wierszy, kody z komórek, kolory i formuły).
 *
 * Plik raportu prześlij w rozmowie – na jego podstawie powstanie Grafik w Firebase z tymi samymi wyliczeniami co arkusz.
 */
var GA_MAX_FORMULA_SAMPLES = 40;     // ile różnych formuł (w zapisie R1C1) pokazać na zakres
var GA_MAX_SCAN_CELLS = 400000;      // ile komórek z formułami przejrzeć w innych kartach (szukanie odwołań do G)

function grafikAudit() {
  var t0 = Date.now();
  var ss = SpreadsheetApp.getActive();
  var out = { generatedAt: new Date().toISOString(), spreadsheet: ss.getName(), timeZone: ss.getSpreadsheetTimeZone(), locale: ss.getSpreadsheetLocale(), sheets: [], g: null, otherRefs: [], customColorFns: [], namedRanges: [], triggers: [], grafNorm: null, errors: [] };
  ss.getSheets().forEach(function (sh) { out.sheets.push({ name: sh.getName(), rows: sh.getMaxRows(), cols: sh.getMaxColumns(), lastRow: sh.getLastRow(), lastCol: sh.getLastColumn(), hidden: sh.isSheetHidden() }); });

  var g = ss.getSheetByName('G');
  if (!g) { out.errors.push('Brak karty G'); }
  else {
    try { out.g = ga_sheetReport_(g, true); } catch (e) { out.errors.push('G: ' + e.message); }
  }

  // nazwane zakresy wskazujące G
  ss.getNamedRanges().forEach(function (nr) {
    try { var r = nr.getRange(); out.namedRanges.push({ name: nr.getName(), sheet: r.getSheet().getName(), a1: r.getA1Notation() }); } catch (e) { /* zakres uszkodzony */ }
  });

  // inne karty: formuły z odwołaniem do G albo do funkcji liczących kolory
  var scanned = 0;
  ss.getSheets().forEach(function (sh) {
    if (scanned > GA_MAX_SCAN_CELLS) return;
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (lr < 1 || lc < 1) return;
    var f;
    try { f = sh.getRange(1, 1, lr, lc).getFormulas(); } catch (e) { out.errors.push('Formuły ' + sh.getName() + ': ' + e.message); return; }
    var refs = {}, colorFns = {};
    for (var r = 0; r < f.length; r++) for (var c = 0; c < f[r].length; c++) {
      var x = f[r][c]; if (!x) continue; scanned++;
      var a1 = ga_a1_(r + 1, c + 1);
      if (sh.getName() !== 'G' && /(^|[^A-Za-z0-9_'])'?G'?!/.test(x)) { if (!refs[x]) refs[x] = []; if (refs[x].length < 5) refs[x].push(a1); }
      if (/countColoredCells|sumColoredCells/i.test(x)) { if (!colorFns[x]) colorFns[x] = []; if (colorFns[x].length < 5) colorFns[x].push(a1); }
    }
    Object.keys(refs).slice(0, 60).forEach(function (k) { out.otherRefs.push({ sheet: sh.getName(), formula: k, cells: refs[k] }); });
    Object.keys(colorFns).slice(0, 60).forEach(function (k) { out.customColorFns.push({ sheet: sh.getName(), formula: k, cells: colorFns[k] }); });
  });

  try { ScriptApp.getProjectTriggers().forEach(function (t) { out.triggers.push({ handler: t.getHandlerFunction(), type: String(t.getEventType()), source: String(t.getTriggerSource()) }); }); } catch (e) { out.errors.push('Wyzwalacze: ' + e.message); }

  // graf_norm w pliku Harmonogramu (stanowiska i miejsca pracy na każdy dzień – z tego liczą się terminy)
  try {
    var hid = (typeof HARM_SPREADSHEET_ID !== 'undefined') ? HARM_SPREADSHEET_ID : '';
    if (hid) {
      var hs = SpreadsheetApp.openById(hid);
      var gn = hs.getSheetByName('graf_norm');
      out.grafNorm = { spreadsheet: hs.getName(), sheets: hs.getSheets().map(function (s) { return s.getName(); }), report: gn ? ga_sheetReport_(gn, false) : null };
      var other = [];
      hs.getSheets().forEach(function (sh) {
        if (sh.getName() === 'graf_norm') return;
        var lr = Math.min(sh.getLastRow(), 3000), lc = sh.getLastColumn(); if (lr < 1 || lc < 1) return;
        var f = sh.getRange(1, 1, lr, lc).getFormulas(), seen = {};
        for (var r = 0; r < f.length; r++) for (var c = 0; c < f[r].length; c++) { var x = f[r][c]; if (x && /graf_norm|IMPORTRANGE/i.test(x) && !seen[x]) { seen[x] = 1; other.push({ sheet: sh.getName(), cell: ga_a1_(r + 1, c + 1), formula: x.slice(0, 500) }); } }
      });
      out.grafNorm.refs = other.slice(0, 120);
    }
  } catch (e) { out.errors.push('graf_norm: ' + e.message); }

  out.seconds = Math.round((Date.now() - t0) / 100) / 10;
  var name = 'grafik_audit_' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd_HHmm') + '.json';
  var file = DriveApp.createFile(name, JSON.stringify(out, null, 1), 'application/json');
  Logger.log('Raport: ' + file.getUrl() + '  (' + name + ', ' + out.seconds + ' s)');
  return file.getUrl();
}

/** Struktura karty: rozmiar, zamrożenia, scalenia, A3/B3, nagłówki, formuły (różne wzory R1C1), kody i kolory, formatowanie warunkowe, listy wyboru, ochrona. */
function ga_sheetReport_(sh, isG) {
  var rep = { name: sh.getName(), maxRows: sh.getMaxRows(), maxCols: sh.getMaxColumns(), lastRow: sh.getLastRow(), lastCol: sh.getLastColumn(), frozenRows: sh.getFrozenRows(), frozenCols: sh.getFrozenColumns() };
  var lr = Math.max(1, sh.getLastRow()), lc = Math.max(1, sh.getLastColumn());
  var all = sh.getRange(1, 1, lr, lc);
  // pierwsze wiersze (nagłówki, adresy A3/B3) – wartości i formuły, bez kolumny z nazwiskami poniżej wiersza 4
  var headRows = Math.min(6, lr);
  var hv = sh.getRange(1, 1, headRows, Math.min(lc, 60)).getDisplayValues();
  var hf = sh.getRange(1, 1, headRows, Math.min(lc, 60)).getFormulas();
  rep.head = hv.map(function (row, r) { return row.map(function (v, c) { return hf[r][c] ? { v: v, f: hf[r][c] } : v; }); });
  if (isG) {
    rep.a3 = { value: sh.getRange('A3').getDisplayValue(), formula: sh.getRange('A3').getFormula() };
    rep.b3 = { value: sh.getRange('B3').getDisplayValue(), formula: sh.getRange('B3').getFormula() };
    try { rep.left = ga_rangeReport_(sh.getRange(rep.a3.value), true); } catch (e) { rep.left = { error: e.message }; }
    try { rep.schedule = ga_rangeReport_(sh.getRange(rep.b3.value), false); } catch (e) { rep.schedule = { error: e.message }; }
    // wiersz 4 – daty: pierwsza, ostatnia, liczba
    var r4 = sh.getRange(4, 1, 1, lc).getDisplayValues()[0], dates = r4.filter(function (x) { return /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(x); });
    rep.row4Dates = { count: dates.length, first: dates[0] || '', last: dates[dates.length - 1] || '', sampleNonDates: r4.filter(function (x) { return x && dates.indexOf(x) < 0; }).slice(0, 20) };
  } else {
    rep.all = ga_rangeReport_(all, false);
  }
  rep.merged = sh.getRange(1, 1, lr, lc).getMergedRanges().slice(0, 200).map(function (m) { return m.getA1Notation(); });
  rep.conditionalFormats = sh.getConditionalFormatRules().map(function (rule) {
    var o = { ranges: rule.getRanges().map(function (r) { return r.getA1Notation(); }) };
    var b = rule.getBooleanCondition();
    if (b) {
      o.type = String(b.getCriteriaType()); o.values = b.getCriteriaValues().map(String);
      o.background = b.getBackgroundObject() ? ga_color_(b.getBackgroundObject()) : null; o.fontColor = b.getFontColorObject() ? ga_color_(b.getFontColorObject()) : null;
      o.bold = b.getBold(); o.italic = b.getItalic(); o.strike = b.getStrikethrough();
    }
    var gr = rule.getGradientCondition(); if (gr) o.gradient = true;
    return o;
  });
  // listy wyboru (sprawdzanie poprawności) – zgrupowane po regule
  try {
    var dv = all.getDataValidations(), seen = {};
    rep.validations = [];
    for (var r = 0; r < dv.length; r++) for (var c = 0; c < dv[r].length; c++) {
      var v = dv[r][c]; if (!v) continue;
      var key = String(v.getCriteriaType()) + '|' + v.getCriteriaValues().map(function (x) { return x && x.getA1Notation ? x.getSheet().getName() + '!' + x.getA1Notation() : String(x); }).join(',');
      if (!seen[key]) { seen[key] = { type: String(v.getCriteriaType()), values: key.split('|')[1].slice(0, 2000), allowInvalid: v.getAllowInvalid(), firstCell: ga_a1_(r + 1, c + 1), cells: 0 }; rep.validations.push(seen[key]); }
      seen[key].cells++;
    }
  } catch (e) { rep.validations = { error: e.message }; }
  try { rep.protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).map(function (p) { return { range: p.getRange().getA1Notation(), description: p.getDescription(), warningOnly: p.isWarningOnly() }; }); } catch (e) { rep.protections = { error: e.message }; }
  try { var ns = all.getNotes(), notes = 0; ns.forEach(function (row) { row.forEach(function (n) { if (n) notes++; }); }); rep.notes = notes; } catch (e) { /* bez notatek */ }
  return rep;
}

/** Zakres: różne formuły (R1C1, z liczbą wystąpień i pierwszą komórką), kody wartości (bez kolumny nazwisk), kolory tła i czcionki z kodami. */
function ga_rangeReport_(range, hasNames) {
  var o = { a1: range.getA1Notation(), rows: range.getNumRows(), cols: range.getNumColumns() };
  var f = range.getFormulasR1C1(), dv = range.getDisplayValues(), bg = range.getBackgrounds(), fc = range.getFontColors();
  var r0 = range.getRow(), c0 = range.getColumn();
  var forms = {}, codes = {}, colors = {}, formulaCells = 0, valueCells = 0;
  for (var r = 0; r < f.length; r++) for (var c = 0; c < f[r].length; c++) {
    var x = f[r][c];
    if (x) { formulaCells++; if (!forms[x]) forms[x] = { n: 0, first: ga_a1_(r0 + r, c0 + c) }; forms[x].n++; }
    else if (dv[r][c] !== '') valueCells++;
    if (hasNames && c === 0) continue;                       // kolumna z nazwiskami – nie zapisujemy wartości
    var v = dv[r][c];
    if (v !== '' && v.length <= 40) { codes[v] = (codes[v] || 0) + 1; }
    var ck = bg[r][c] + ' / ' + fc[r][c];
    if (!colors[ck]) colors[ck] = { n: 0, codes: {} }; colors[ck].n++;
    if (v !== '' && v.length <= 40 && Object.keys(colors[ck].codes).length < 15) colors[ck].codes[v] = (colors[ck].codes[v] || 0) + 1;
  }
  o.formulaCells = formulaCells; o.valueCells = valueCells;
  o.formulas = Object.keys(forms).sort(function (a, b) { return forms[b].n - forms[a].n; }).slice(0, GA_MAX_FORMULA_SAMPLES).map(function (k) { return { r1c1: k.slice(0, 1500), count: forms[k].n, firstCell: forms[k].first }; });
  o.codes = Object.keys(codes).sort(function (a, b) { return codes[b] - codes[a]; }).slice(0, 300).map(function (k) { return [k, codes[k]]; });
  o.colors = Object.keys(colors).sort(function (a, b) { return colors[b].n - colors[a].n; }).slice(0, 80).map(function (k) { return { colors: k, count: colors[k].n, codes: colors[k].codes }; });
  if (hasNames) {
    // kolumna nazwisk: tylko liczba wierszy, separatory („****”) i dopiski (np. „UT=…”) – bez samych nazwisk
    var col0 = dv.map(function (row) { return String(row[0] || ''); });
    o.nameColumn = { filled: col0.filter(function (x) { return x.trim(); }).length, separators: col0.filter(function (x) { return x.indexOf('****') >= 0; }), withSuffix: col0.filter(function (x) { return /=/.test(x); }).map(function (x) { var y = x.replace(/^.*?\s([A-ZĄĆĘŁŃÓŚŹŻ]{1,4}\s*=.*)$/, '…$1'); return y !== x ? y : '…' + x.slice(x.indexOf('=')); }).slice(0, 50) };
  }
  return o;
}

function ga_color_(c) { try { return c.asRgbColor().asHexString(); } catch (e) { return String(c); } }
function ga_a1_(r, c) { var s = ''; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s + r; }
