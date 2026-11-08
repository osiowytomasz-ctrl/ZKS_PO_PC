# Backend Workflow (karta Z)

Kod backendu jest w pliku `backend/Workflow.gs` (odczyt `api_getWorkflow_`, zapis `api_saveWorkflow_`, test `api_testWorkflow`).
Jest sprawdzony testami na atrapie arkusza (`test/workflow-backend.test.js`).

1. Wklej całą zawartość `backend/Workflow.gs` do projektu Apps Script (np. na końcu `Api.gs`).
   **Usuń wcześniejszą wersję** `api_getWorkflow_`, `API_WORKFLOW_SHEET` i `api_testWorkflow`, żeby nie było duplikatów.
2. W `API_FUNCS` (w `Api.gs`) ustaw dwa wpisy:

```js
  api_getWorkflow: {
    run: function () { return api_getWorkflow_(); }
  },
  api_saveWorkflow: {
    write: true,
    run: function (a, ctx) { return api_saveWorkflow_(a[0], ctx); }
  },
```

3. Wdróż **Nową wersję** na wdrożeniu używanym przez aplikację (Wdróż → Zarządzaj wdrożeniami → ołówek → Nowa wersja).

Reguły zapisu: status w A/B/C jest wyłączny (jeden `x`), data (D) i zlecający (G) uzupełniają się tylko gdy są puste (data z godziną, zlecający to
nazwa użytkownika z klucza), formuła kategorii (H) jest kopiowana do nowego wiersza, a edycja tekstu E/F jest odrzucana, jeśli ktoś zmienił tę
komórkę w arkuszu od ostatniego odświeżenia. Nowe zadania trafiają do pierwszego wiersza z pustymi kolumnami A–G.
