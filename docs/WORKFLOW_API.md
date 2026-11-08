# Funkcja backendu dla Workflow (karta Z)

Aplikacja pobiera surowe wartości karty Z jednym zapytaniem, a kategorię (kolumna H) i kolorowanie liczy sama
(Apps Script nie zwraca wyników formatowania warunkowego). Funkcję trzeba dodać do Apps Script
(`moja-aplikacja/Api.js`) i wdrożyć nową wersję („Zarządzaj wdrożeniami” → Nowa wersja).

1. Wklej gdzieś w `Api.js`:

```js
/** Workflow: surowe wartości karty Z (wiersze od 2, kolumny A–H) jednym odczytem. */
var API_WORKFLOW_SHEET = 'Z';   // <- nazwa karty z workflow; zmień, jeśli inna
function api_getWorkflow_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(API_WORKFLOW_SHEET);
  if (!sheet) throw new Error('Nie znaleziono karty: ' + API_WORKFLOW_SHEET);
  var last = sheet.getLastRow();
  var headers = sheet.getRange(1, 1, 1, 8).getDisplayValues()[0];
  if (last < 2) return { headers: headers, rows: [] };
  var values = sheet.getRange(2, 1, last - 1, 8).getDisplayValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var cells = values[i];
    if (cells.join('') !== '') rows.push({ row: i + 2, cells: cells });
  }
  return { headers: headers, rows: rows };
}
```

2. Dopisz do białej listy `API_FUNCS` (obok innych, np. `getZakupyProductCodes`):

```js
  api_getWorkflow: {
    run: function () { return api_getWorkflow_(); }
  },
```

Jeśli inne wpisy mają pole `perm`, nie dodawaj go (odczyt dla każdego z ważnym kluczem) albo zdecyduj o uprawnieniu.
