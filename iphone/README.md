# ZKS PO – wersja na iPhone'a (Skaner, Grafik, Plan, Tablica i Chat)

Aplikacja webowa (PWA) z tego samego kodu co program PC i aplikacja na Androida: **Skaner** (produkt, detal, operacja, dokument, Lista detali, Dokumentacja – te same
reguły i uprawnienia co na Androidzie) **Grafik** i **Plan** (te same widoki i uprawnienia co w programie PC – GOD / MASTER / CLERIK / TOURIST; pasek narzędzi zwija się pod przyciskiem „Narzędzia”, tabela przewija się palcem; przyciski kart pojawiają się tylko tym, którzy mają dostęp) **Tablica** (Workflow: lista zadań na żywo; zmiany tylko MASTER i GOD, pozostali przeglądają – jak w programie PC) i **Chat** (status i dostępność pracowników, rozmowa ogólna i prywatne, historia dla uprawnionych).
Powiadomienia Workflow (dzwonek 🔔 w nagłówku): nowe zadania, zmiany statusu (także moich zleceń), codzienne przypomnienie o zaległych; komunikat na ekranie, dźwięk, powiadomienie systemowe i licznik na ikonie aplikacji.

## Jak to działa
- Strona jest składana skryptem `scripts/build-iphone.mjs` ze współdzielonego kodu (`src/renderer/css|js|img|vendor/firebase.js`) i plików z tego katalogu,
  a publikowana workflow-em `.github/workflows/iphone-pages.yml` na GitHub Pages (po każdym pushu do `main`, który zmienia `iphone/` lub `src/renderer/`).
- Logowanie jak w aplikacji na Androida: **klucz użytkownika**. Adres API pobiera się sam z bazy (app_config/api); gdy go tam nie ma – pole adresu na ekranie logowania.
- Odczyt kodów kamerą: Safari nie ma `BarcodeDetector`, więc używana jest biblioteka ZXing (`vendor/zxing.min.js`, licencja Apache-2.0) przez `barcode-shim.js`.
- Klucz jest w pamięci przeglądarki na telefonie (strony WWW nie mają dostępu do Keychain) – w razie zgubienia telefonu administrator wydaje nowy klucz.

## Uruchomienie (jednorazowo, administrator)
1. GitHub → repozytorium → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Uruchom workflow „Wersja na iPhone'a (GitHub Pages)” (Actions → Run workflow) albo zrób push do `main`. Adres strony: `https://<konto>.github.io/<repozytorium>/`.
   (Strony GitHub Pages z prywatnego repozytorium wymagają płatnego planu GitHub; alternatywa: Firebase Hosting – ta sama zawartość katalogu `_site`.)
3. Opublikuj `backend/firestore.rules` (reguła `presence_dev` zna platformę `ios`).

## Instalacja na iPhone'ie
Safari → otwórz adres strony → przycisk Udostępnij → **Dodaj do ekranu początkowego**. Przy pierwszym użyciu kamery zezwól na dostęp do kamery.

## Test lokalny
`node scripts/build-iphone.mjs _site` i serwowanie katalogu `_site` dowolnym serwerem statycznym (HTTPS lub localhost – kamera wymaga bezpiecznego kontekstu).

## Powiadomienia – ograniczenia iPhone'a
Powiadomienia powstają, gdy aplikacja jest otwarta (nasłuch bazy na żywo), oraz **przy każdym otwarciu aplikacji** – program porównuje zadania z poprzednim stanem zapamiętanym na telefonie, więc zmiany z czasu, gdy aplikacja była zamknięta, pojawiają się jako powiadomienia po jej otwarciu.
Powiadomienia „z zewnątrz” przy zamkniętej aplikacji (push) wymagałyby serwera wysyłającego (Firebase Cloud Messaging + Cloud Functions, plan Blaze) – nie jest to zrobione. Powiadomienia systemowe i licznik na ikonie działają tylko dla aplikacji dodanej do ekranu początkowego (iOS 16.4+) po zgodzie użytkownika (Dzwonek → Ustawienia powiadomień → „Powiadomienia systemowe”).
