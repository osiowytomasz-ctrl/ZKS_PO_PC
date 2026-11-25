# ZKS PO – wersja na iPhone'a (Skaner i Chat)

Aplikacja webowa (PWA) z tego samego kodu co program PC i aplikacja na Androida: **Skaner** (produkt, detal, operacja, dokument, Lista detali, Dokumentacja – te same
reguły i uprawnienia co na Androidzie) oraz **Chat** (status i dostępność pracowników, rozmowa ogólna i prywatne, historia dla uprawnionych).

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
