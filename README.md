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
| Skaner (pobranie części oraz rejestry detali, operacji i dokumentacji rozpoznawane po znaku rozdzielającym; skaner USB, kamera tam, gdzie jest `BarcodeDetector`) | gotowy |
| Grafik (filtry, sortowanie, edycja, zakres dat, zoom Ctrl+kółko) | gotowy |
| Zakupy (zamówione = bez PZ, zakupione = z PZ, archiwum; czerwone pozycje do korekty; tabela dodawania 10 wierszy; realizacja z kopią pozostałej ilości) | gotowy |
| Pomiary (karta pomiaru, HTML z Androida) | gotowy (przycisk na ekranie Help) |
| Symulator, SymulatorNUM (wersje HTML; wymagają internetu dla bibliotek) | gotowy (przyciski na ekranie Help) |
| Narzędziownia (ekran z ToolBuilder, Assem.Tool, ToolTrack; Zniszczone i Pomiarówka w budowie) | gotowy |
| ToolTrack (filtry kaskadowe, skaner USB, zapis lokalizacji) | gotowy |
| Harmonogram (wykres Gantta, filtry, sortowanie, dostawy, zależności) | gotowy |
| Plan (bloki zmian, edycja tekstu z kolorami, daty, pracownicy) | gotowy |
| Help (posuw Ra/R, cięciwy, współrzędne otworów, F° → Fmm) | gotowy |
| ToolBuilder (łańcuch mocowań, zapis do BN) | gotowy |
| Assem.Tool (lista zespołów BN, filtry, szczegóły, pamięć podręczna) | gotowy, bez rysunków 2D/3D |

## Budowa

- `src/main` – proces główny: okno, szyfrowane ustawienia, klient API (`apiCore.cjs`), zapis plików i PDF.
- `src/renderer` – interfejs: `js/logic` to czysta logika (odpowiedniki `*Logic.kt`), `js/views` to ekrany.
- `web` – strony HTML (Pomiary, symulatory) serwowane pod `zks-web://`; `lib/desktop-bridge.js` zastępuje natywny most Androida.

## Różnice względem aplikacji na Androida

- Brak rysunków 2D/3D narzędzi (ToolBuilder, Assem.Tool, okno części na ekranie głównym) i filtrów z katalogu na ekranie głównym.
- Plan: bez dopisywania komisów do sąsiedniej kolumny przy edycji.
- Symulatory to oryginalne strony HTML (nie natywne jak w telefonie) i ładują biblioteki z internetu.
- Kamera: tylko tam, gdzie system ma `BarcodeDetector`; zwykle używa się skanera USB (działa jak klawiatura).

## Szybkość

Odczyty z arkusza są zapamiętywane na dysku (`userData/cache`, osobno dla każdego adresu i klucza). Przy ponownym wejściu w moduł
dane pojawiają się od razu z pamięci, a świeże dociągają się w tle. Edycja i zapis w Grafiku, Planie i Zakupach włączają się dopiero
po odświeżeniu, żeby nie zapisać zmian na starych danych. Katalog narzędzi i listy kodów wczytują się w tle zaraz po starcie.
Pamięć można wyczyścić w Ustawieniach. Najwolniejszy jest sam backend Apps Script (czytanie arkusza), czego aplikacja nie przyspieszy.

Stan zsynchronizowany z gałęzią Androida `claude/great-babbage-dgqc7x` do commita `0b31147` (7.11.2026).

## Workflow (karta Z)

Kategoria zadania (kolumna H) i kolorowanie są liczone lokalnie z surowych wartości (`src/renderer/js/logic/workflow.js`), bo Apps Script nie zwraca
wyników formatowania warunkowego. Edycja: kliknięcie w A/B/C ustawia status (`x`, jeden naraz), E i F mają edytor tekstu z formatowaniem
(pogrubienie, kursywa, podkreślenie, przekreślenie, kolor), data (D) i zlecający (G) uzupełniają się automatycznie tylko gdy są puste.
Edycja jest w samej tabeli jak w arkuszu: strzałki, Tab, Home/End poruszają po komórkach, Enter lub F2 (albo pisanie) zaczyna edycję tekstu z paskiem formatowania nad tabelą, Enter zatwierdza, Alt+Enter dodaje linię, Esc anuluje, Spacja lub x ustawia status.
Backend: `backend/Workflow.gs` (instrukcja w `docs/WORKFLOW_API.md`).

Zsynchronizowano z gałęzią Androida do commita `45deb72` (10.11.2026): Skaner z rejestrami (backend `mp_*` w `backend/Api.gs`, `backend/Code_MistrzPO.gs`),
logo i ikona, przyciski Symulator/SymulatorNUM/Pomiary w Help. Workflow ma filtry i sortowanie jak w Zakupach (kliknięcie nagłówka kolumny);
bez sortowania najnowsze zadania są na górze. Backend trzeba wkleić do Apps Script i wdrożyć Nową wersję (`WKLEJ_DO_APPSCRIPT.md` w repozytorium `ZKS_PO`).
