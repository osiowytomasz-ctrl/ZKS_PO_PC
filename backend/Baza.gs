/**
 * Baza.gs — odczyt kart arkusza do bazy Firebase na żądanie (Narzędziownia → Produkty, Pomiarowe; BN idzie istniejącą funkcją getBNbaseData).
 * Program PC czyta kartę raz, zapisuje ją w Firebase (snap_meta / snap_rows), a potem tylko na życzenie (przycisk „Odśwież z arkusza”).
 *
 * W Api.gs (API_FUNCS):
 *   baseSheet: { run: function (a) { return base_sheet_(a[0]); } },
 * Karty: PSWT (produkty – wiersz 1 = nagłówki), POM (narzędzia pomiarowe; kod w kolumnie C, interwał w kolumnie H),
 *        BADANIA = „Badania 2026” (kod w kolumnie A, daty badań; w L6:L11 kolory statusów – zwracane jako legenda).
 */
var BASE_ALLOWED = { PSWT: 'PSWT', POM: 'POM', BADANIA: 'Badania 2026' };

/** Wartości wyświetlane całej karty [key] (bez pustych wierszy na końcu): { sheet, rows, cols, values, legend? }. */
function base_sheet_(key) {
  var name = BASE_ALLOWED[String(key || '').toUpperCase()];
  if (!name) throw new Error('Nieznana karta: ' + key + ' (dozwolone: ' + Object.keys(BASE_ALLOWED).join(', ') + ').');
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Karta „' + name + '” nie istnieje w arkuszu.');
  var rows = sh.getLastRow(), cols = sh.getLastColumn();
  if (rows < 1 || cols < 1) return { sheet: name, rows: 0, cols: 0, values: [] };
  var values = sh.getRange(1, 1, rows, cols).getDisplayValues();
  var last = values.length;
  while (last > 0 && values[last - 1].every(function (v) { return String(v).trim() === ''; })) last--;
  values = values.slice(0, last);
  var out = { sheet: name, rows: values.length, cols: cols, values: values };
  if (String(key).toUpperCase() === 'BADANIA') {   // kolory statusów w kolumnie L, wiersze 6–11
    var r = sh.getRange(6, 12, 6, 1);
    var txt = r.getDisplayValues(), bg = r.getBackgrounds(), fg = r.getFontColors();
    out.legend = [];
    for (var i = 0; i < 6; i++) out.legend.push({ row: 6 + i, text: String(txt[i][0] || ''), bg: bg[i][0], fg: fg[i][0] });
  }
  return out;
}
