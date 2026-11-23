/**
 * Baza.gs — odczyt kart arkusza do bazy Firebase na żądanie (Narzędziownia → Produkty, Pomiarowe; BN idzie istniejącą funkcją getBNbaseData).
 * Program PC czyta kartę raz, zapisuje ją w Firebase (snap_meta / snap_rows), a potem tylko na życzenie (przycisk „Odśwież z arkusza”).
 *
 * W Api.gs (API_FUNCS):
 *   baseSheet: { run: function (a) { return base_sheet_(a[0]); } },
 * Karty: PSWT (produkty – wiersz 1 = nagłówki), POM (narzędzia pomiarowe; kod w kolumnie C, interwał w kolumnie H),
 *        BADANIA = „Badania 2026” (kod w kolumnie A, daty badań; w L6:L11 kolory statusów – zwracane jako legenda),
 *        ZN – zniszczone narzędzia (Narzędziownia → Zniszczone): wiersz 2 = nagłówki, od wiersza 3 wpisy: A lp, B nr narzędzia, C procent zniszczenia, D–G opis / cena / firma /
 *        oznaczenie (formuły z PSWT – program czyta wartości wyświetlane), H kto / gdzie, I data, J miesiąc, K kwota strat, L opis zniszczeń, M przyczyna.
 */
var BASE_ALLOWED = { PSWT: 'PSWT', POM: 'POM', BADANIA: 'Badania 2026', ZN: 'ZN' };

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

/**
 * Dopisanie zniszczonego narzędzia do karty ZN (Narzędziownia → Zniszczone → „Dodaj zniszczone narzędzie”): narzędziowiec po oględzinach wpisuje numer narzędzia,
 * procent zniszczenia, kto / gdzie, datę, opis zniszczeń i przyczynę – tak jak w karcie ZN. Kolumny z formułami (D–G opis / cena / firma / oznaczenie, J miesiąc, K kwota strat)
 * zostają w arkuszu: wpis trafia do pierwszego wiersza bez numeru narzędzia (puste wiersze z formułami), a gdy ich brak – do nowego wiersza z formułami skopiowanymi z poprzedniego.
 *   Api.gs: znAddEntry: { write: true, run: function (a, ctx) { return zn_addEntry_(a[0], ctx); } },
 * Wejście: { code, pct (0–100), who, date ('rrrr-mm-dd' lub 'dd.mm.rrrr'; puste = dziś), damage, cause }. Wynik: { row, lp }.
 */
function zn_addEntry_(e, ctx) {
  e = e || {};
  var code = String(e.code || '').trim();
  if (!code) throw new Error('Podaj numer narzędzia.');
  if (code.length > 60) throw new Error('Numer narzędzia jest za długi.');
  var pct = Number(String(e.pct == null ? '' : e.pct).replace(',', '.').replace('%', ''));
  if (!isFinite(pct) || pct < 0 || pct > 100) throw new Error('Procent zniszczenia musi być liczbą od 0 do 100.');
  var date = zn_parseDate_(e.date);
  var who = String(e.who || '').trim().slice(0, 120), damage = String(e.damage || '').trim().slice(0, 2000), cause = String(e.cause || '').trim().slice(0, 1000);
  var sh = SpreadsheetApp.getActive().getSheetByName(BASE_ALLOWED.ZN);
  if (!sh) throw new Error('Karta „ZN” nie istnieje w arkuszu.');
  var last = Math.max(sh.getLastRow(), 2);
  var vals = last >= 3 ? sh.getRange(3, 1, last - 2, 3).getValues() : [];   // A lp, B nr narz., C procent
  var row = 0, maxLp = 0;
  for (var i = 0; i < vals.length; i++) {
    var lp = Number(vals[i][0]); if (isFinite(lp) && lp > maxLp) maxLp = lp;
    if (!row && String(vals[i][1]).trim() === '' && String(vals[i][2]).trim() === '') row = 3 + i;   // pierwszy pusty wiersz z formułami
  }
  if (!row) {   // brak wolnych wierszy – nowy wiersz z formułami (D–G, J, K) z poprzedniego
    row = last + 1;
    if (last >= 3) { sh.getRange(last, 4, 1, 4).copyTo(sh.getRange(row, 4, 1, 4)); sh.getRange(last, 10, 1, 2).copyTo(sh.getRange(row, 10, 1, 2)); }
  }
  sh.getRange(row, 1).setValue(maxLp + 1);
  sh.getRange(row, 2).setValue(code);
  sh.getRange(row, 3).setValue(pct / 100).setNumberFormat('0%');
  sh.getRange(row, 8).setValue(who);
  sh.getRange(row, 9).setValue(date).setNumberFormat('dd.MM.yyyy');
  sh.getRange(row, 12).setValue(damage);
  sh.getRange(row, 13).setValue(cause);
  sh.getRange(row, 2).setNote('Dodano w programie: ' + String((ctx && (ctx.name || ctx.email)) || '') + ', ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm'));
  return { row: row, lp: maxLp + 1 };
}
/** Data z „rrrr-mm-dd” albo „dd.mm.rrrr”; puste – dziś; nieprawidłowa – błąd. */
function zn_parseDate_(v) {
  var t = String(v || '').trim();
  if (!t) { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else throw new Error('Data musi mieć postać rrrr-mm-dd albo dd.mm.rrrr.');
  var dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) throw new Error('Nieprawidłowa data.');
  return dt;
}
