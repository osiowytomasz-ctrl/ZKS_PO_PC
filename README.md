# ZKS PO (komputer)

Wersja aplikacji ZKS PO na komputer (Windows, macOS, Linux), zbudowana w Electronie. Działa jak aplikacja na Androida
(repozytorium `ZKS_PO`): łączy się z tym samym backendem Apps Script, tym samym adresem `/exec` i tym samym kluczem użytkownika.
Aplikacja na Androida i backend nie są tu zmieniane.

## Uruchomienie

```bash
npm install
npm start        # uruchamia aplikację
npm test         # testy logiki i klienta API
npm run dist     # instalator (electron-builder)
```

Przy pierwszym uruchomieniu wpisz w **Ustawieniach** adres API (`…/exec`) i klucz użytkownika (te same co w telefonie).
Klucz jest zapisywany szyfrowany przez system (`safeStorage`), jeśli system to umożliwia, i trafia tylko w treść żądania do podanego adresu.

## Stan modułów

| Moduł | Stan |
|---|---|
| Ekran główny (braki części, filtry) | gotowy |
| Ustawienia i sprawdzenie połączenia | gotowy |
| Skaner (skaner USB jako klawiatura, kamera tam, gdzie jest `BarcodeDetector`) | gotowy |
| Grafik (filtry, sortowanie, edycja, zakres dat, zoom Ctrl+kółko) | gotowy |
| Zakupy (zamówione, zakupione, archiwum, dodawanie, realizacja) | gotowy |
| Pomiary (karta pomiaru, HTML z Androida) | gotowy |
| Symulator, SymulatorNUM (wersje HTML; wymagają internetu dla bibliotek) | gotowy |
| Plan, ToolTrack, ToolBuilder, Assem.Tool, Harmonogram, Help | w budowie (kolejny etap) |

## Budowa

- `src/main` – proces główny: okno, szyfrowane ustawienia, klient API (`apiCore.cjs`), zapis plików i PDF.
- `src/renderer` – interfejs: `js/logic` to czysta logika (odpowiedniki `*Logic.kt`), `js/views` to ekrany.
- `web` – strony HTML (Pomiary, symulatory) serwowane pod `zks-web://`; `lib/desktop-bridge.js` zastępuje natywny most Androida.
