# Grafik – analiza przed przeniesieniem do Firebase

Stan na wersję PC 1.19.1 / Android 1.19.0. Cel: Grafik w Firebase (szybki, na żywo u wszystkich) z **tą samą funkcjonalnością**
co dziś w arkuszu i w aplikacjach. Ten dokument opisuje, co wiadomo z kodu, czego kod nie pokazuje (formuły i formatowanie
w samym arkuszu) i jak to sprawdzić (`backend/GrafikAudit.gs`).

## 1. Skąd są dane dziś

**Karta `G` w głównym arkuszu** (ten sam plik co Plan, Uzytkownicy, ND…):

| Miejsce | Znaczenie |
|---|---|
| `A3` | adres zakresu „lewego”: 2 kolumny – pracownik i „dyspozycja” (np. `A5:B80`; wartość może pochodzić z formuły) |
| `B3` | adres zakresu grafiku – dni (np. `C4:…`); pierwszy wiersz zakresu to nagłówki |
| wiersz 4 | daty dni (nagłówki kolumn); po nich aplikacje wybierają zakres „od–do” |
| kolumna B od wiersza 5 | lista pracowników także dla **Planu** (`api_planWorkers_`, `Code_Plan.js`) – skracana do „Nazwisko Imi” |

**Wpisy w komórkach dnia** (z danych graf_norm i z aplikacji):

- zmiana i godziny: litera zmiany + liczba godzin, np. `a8` (I zmiana 8 h), `b8`, `c8`, `a5b3`, `a4b4`, `a2b6`, `a6`;
- nieobecność: `UT` (urlop), `L4` (zwolnienie), `*` (dzień wolny); puste = brak wpisu;
- wiersze-separatory z `****` w nazwie (grupy) – aplikacje je pomijają;
- dopisek w nazwisku `UT=…` (np. pozostały urlop) – aplikacje go ucinają przy wyświetlaniu.

**Kolory**: aplikacje pokazują kolory tła i czcionki komórek tak, jak zwraca je `getBackgrounds()` / `getFontColors()` –
to są kolory **wpisane ręcznie** (formatowanie warunkowe arkusza nie jest przez nie widoczne). W skrypcie są też funkcje własne
`countColoredCells` / `sumColoredCells` (liczą komórki **po kolorze tła**) – jeśli arkusz ich używa (np. do liczenia dni),
kolor jest dziś „daną”, a nie tylko wyglądem.

## 2. Jak dziś działa odczyt i zapis

| | Arkusz (web) | API (PC, Android) |
|---|---|---|
| odczyt | `getGrData(od, do)`: zakres dni wg dat z wiersza 4, `getDisplayValues` + kolory | to samo w `api_readGrData_` + pamięć podręczna 45 s (unieważniana zapisem z aplikacji) |
| zapis | `saveGrData`: **każda komórka osobnym `setValue`**, potem `flush` | `api_saveGrData_`: to samo, kolumny liczone od pierwszej daty zakresu |
| uprawnienia | lista 2 e-maili w kodzie | kolumna „Grafik” w karcie Uzytkownicy (read / write) |
| na żywo | nie (trzeba odświeżyć) | PC: odświeżanie w tle co 90 s; brak powiadamiania o zmianach innych |

Powolność: każdy odczyt to kilka sekund czytania arkusza (wartości + 2× kolory), zapis – kilka sekund na komórkę wsadowo.

## 3. Kto korzysta z Grafiku (musi działać po przeniesieniu)

1. **Moduł Grafik** – PC, Android, wersja webowa: zakres dat, filtry i sortowanie jak autofiltr (każda kolumna, wartości z liczbą
   wierszy), zoom, edycja komórek (PC – okno, web – pisanie w komórce z Enter w prawo), „Zapisz / Odrzuć zmiany”.
2. **Plan** – lista pracowników (G!B5:B) i podpowiedź „kto jest na zmianie a/b/c danego dnia” (`getGrData` jednego dnia, kody a/b/c).
3. **Harmonogram** – okno dnia (obsada maszyn, pracownicy z wpisem) i przede wszystkim **graf_norm**:
   - karta `graf_norm` w **osobnym pliku Harmonogramu**: wiersz = dzień, kolumny B:G = godziny stanowisk (1Si, 2Un, 3Co, 5Śl, Do, Narz),
     od H – **miejsca pracy** `1Si1 1Si2 1Si3 2Un1 2Un3 2Un2 3Co1 3Co3 3Co2 Narz1 5Śl1…5Śl4 Do1…Do3` (17) z kodami zmian;
   - z niej program liczy godziny stanowiska na dzień, a z nich **terminy wszystkich operacji** (silnik `schedule.js`);
   - **jak graf_norm powstaje z G (który pracownik na którym miejscu pracy) – nie wynika z kodu aplikacji**; to formuły w pliku
     Harmonogramu (albo ręczne przypisanie). Z danych: wypełnione miejsca pracy idą w tej samej kolejności co pracownicy z wpisem.
4. **Pobieranie w tle** (PC `prefetch.js`) i reguły Firestore (claim `grafik` w tokenie).

## 4. Co jest wyliczane – znane reguły (już w programie, z testami)

| Reguła | Gdzie | Opis |
|---|---|---|
| godziny zmian z kodu | `shiftHours` | cyfra **bezpośrednio** po literze a/b/c, pierwsze wystąpienie (jak ZNAJDŹ + FRAGMENT.TEKSTU): `a5b3` → a=5, b=3 |
| godziny stanowiska na dzień | `stationHours` | „Śl”, „Do”, „Narz” – suma wszystkich zmian ze wszystkich 9 miejsc; maszyny – osobno a, b, c z miejsc 1–3, każda zmiana najwyżej 8 h |
| miejsce pracy z nagłówka | `slotNumber` | nazwa stanowiska + cyfra 1–9 (`1Si2` → miejsce 2 stanowiska 1Si) |
| nieobecności | `describeCode` | UT – urlop, L4 – zwolnienie, `*` – dzień wolny |
| doba produkcyjna | Harmonogram | od 6:00 do 6:00 |
| pracownik ↔ zmiana | `planHints` | a = I, b = II, c = III (Plan „Zmiana a/b/c”) |

## 5. Czego nie widać w kodzie – sprawdzi audyt

`backend/GrafikAudit.gs` → funkcja `grafikAudit()` (tylko odczyt, raport JSON na Dysku, bez nazwisk):

- formuły w karcie G (kolumna „dyspozycja”, dopisek `UT=…`, sumy, ewentualne kolumny „razem” w zakresie dni),
- formatowanie warunkowe i listy wyboru (np. lista kodów w komórkach dnia),
- kolory użyte razem z kodami (legenda: który kod ma jaki kolor) i użycie `countColoredCells` / `sumColoredCells`,
- odwołania innych kart do G (kto jeszcze liczy z Grafiku), nazwane zakresy, ochrona, scalenia,
- karta `graf_norm` w pliku Harmonogramu: formuły / IMPORTRANGE – **jak z G powstają miejsca pracy**,
- wyzwalacze skryptu.

## 6. Propozycja (do potwierdzenia po audycie)

- **Firestore**: `gr_people` (pracownik: nazwisko, kolejność, grupa-separator, miejsce pracy, kolory nazwiska, dopiski),
  `gr_days/{rrrr-mm}` (paczka miesiąca: dzień → pracownik → kod; kilkadziesiąt KB), `config/grafik` (kody i ich kolory – legenda,
  stanowiska i miejsca pracy). Zmiany na żywo u wszystkich (PC, Android), zapis jednym zapisem wsadowym, cofanie.
- **Wyliczenia w programie** zamiast w arkuszu: wszystko z punktu 4 + to, co pokaże audyt (dyspozycja, `UT=`, sumy, kolory wg kodu).
- **graf_norm liczone w programie z Grafiku** (bez drugiego pliku) → Harmonogram i Plan biorą obsadę wprost z Firebase.
- **Przejście bez przerwy**: jednorazowy import z G (z kolorami), potem okres równoległy – zapis z aplikacji do Firebase
  i (opcjonalnie) eksport z powrotem do karty G dla formuł/raportów, które jeszcze z niej korzystają; wersja webowa do czasu
  wyłączenia czyta G.
- **Funkcje do zachowania 1:1**: zakres dat, autofiltr i sortowanie każdej kolumny, kolory, separatory, zoom, edycja jak w Excelu
  (jak w Planie: strzałki, pisanie, kopiuj/wklej, Delete, cofnij), zapis, uprawnienia z kolumny „Grafik”.

## 7. Wyniki audytu (karta G) i co wdrożono w PC 1.20.0

**Co pokazał audyt** (`GrafikAudit.gs`; plik z wynikiem zawiera dane osobowe i nie trafia do repozytorium):

- `A3` = zakres lewy `B4:C…`, `B3` = okno dni od DZIŚ−3 do DZIŚ+7; wiersz 4 = nagłówki, daty od kolumny `BG` (01-01-2026 … 31-01-2028);
  wiersz 3 nad datami = znacznik święta (niedziela albo data z `i!A36:A100`).
- Kolumny wyliczane w arkuszu: `B` nazwa z dopiskiem `UT= <pozostało>` (+ ewentualnie przyrostek, np. „br”), `C` pozostało = `D − AT`,
  `D` dostępny = UT poprzedniego roku + UT bieżący − wykorzystane, `F–Q` liczba UT w miesiącach, `R–AC` plan urlopu (ręcznie),
  `AD–AO` godziny narastająco do końca miesiąca, `AP` suma planu, `AQ/AR` UT z lat, `AS` wykorzystane do dziś (UT + NŻ),
  `AT` UT po dzisiaj, `AU–BE` liczby nieobecności (NŻ, v, L4, OP, Ojc, OKL, HDK, BO, BHP, SZ, Sł), `BF` **miejsce pracy**.
- **Kolory komórek to wyłącznie formatowanie warunkowe** (31 reguł) – nie są „daną”. Komentarzy w karcie jest kilka.
- `graf_norm` (plik Harmonogramu): `H1 = TRANSPOSE(IMPORTRANGE(…"G!BF4:…"))` – miejsce pracy osoby to kolumna `BF`;
  godziny stanowisk (B:G) i terminy (kolumna M Harmonogramu) liczą to samo, co silnik programu (`stationHours`, `computeEnd`).
- `i!A10 = UNIQUE(SORT(G!B5:B27))` – jedyne inne odwołanie do G.
- **Niespójność w arkuszu**: formuły godzin `AD–AO` różnią się między wierszami (część bierze tylko pierwszą liczbę, część skleja cyfry
  i pomija L4). Program liczy godziny jednolicie: suma godzin zmian z kodu (`a8` = 8, `a5b3` = 8, `L4`/`UT` = 0).

**Model w Firestore (bez kolorów – minimum danych):**

- `gr_meta/main` – `people[{id,row,lp,name,suffix,nr,place,sep,ut:{rok:{prev,cur,plan[12]}}}]`, `holidays[]`, `year`, `importedAt/By`;
- `gr_days/{rrrr-mm}` – `c:{osoba:{dd:kod}}` i `n:{osoba:{dd:komentarz}}`; program nasłuchuje tylko miesięcy z widocznego zakresu
  (+ cały rok „do” dla podsumowań urlopów).
- Kolory (`cellStyle` – te same 31 reguł w tej samej kolejności), podsumowania (`personSummary`) i graf_norm (`grafNormDays`) liczy program.

**PC 1.20.0 – moduł Grafik na Firebase:** tabela jak arkusz (zaznaczanie, strzałki, Tab/Enter, pisanie w komórce, F2, Delete,
Ctrl+C/X/V zgodne z Excelem, Ctrl+Z/Y), zapis od razu, zmiany innych widoczne na żywo, **komentarze komórek** (menu pod prawym
przyciskiem, znacznik w rogu), podsumowanie pracownika (miesiące, nieobecności, edycja miejsca/UT/planu), autofiltr i sortowanie,
zoom, kolumny podsumowania. „Import z G” przenosi kartę do bazy; w okresie przejściowym każda zmiana trafia też do karty G
(`grafikWriteBack`), więc graf_norm i wersja webowa działają bez zmian. Poprzedni widok z arkusza – przycisk „Arkusz”.

**Dalej:** Android na Firebase, Harmonogram (graf_norm z bazy zamiast arkusza) i Plan (pracownicy i zmiany z bazy).

**PC 1.21.0 – uzupełnienia po pierwszym imporcie:**

- kolumna „Miejsce” w kolorze stanowiska z Harmonogramu (`placeStation`, lista `stationList(config/main)`);
- grupy kolumn jak w karcie G (przyciski): **Urlopy** (plan, UT z poprzedniego roku i bieżący – wpisywane wprost w tabeli,
  wykorzystane, zaplanowane, dostępny, pozostały), **Godziny** (przepracowane w każdym miesiącu + razem; w podpowiedzi narastająco),
  **Absencje** (NŻ, v, L4, OP, Ojc, OKL, HDK, BO, BHP, SZ, Sł – liczba dni z wpisem zawierającym kod, jak COUNTIFS w AU–BE);
- godziny przepracowane (`workHours`): suma liczb po literach zmian (`a8b2` = 10), sam numer = tyle godzin, nieobecności = 0.
  Arkusz: w części wierszy pierwsza liczba z komórki (L4 = 4 h, a8b2 = 8 h), w innych sklejone cyfry (a8b2 = 82 h), a „DATE(rok;2;31)”
  to 3 marca – stąd różnice względem kolumn AD–AO;
- urlop i absencje liczone dokładnie jak w arkuszu (C, D, AS, AT, AU–BE);
- nagłówek: numer tygodnia ISO nad datami, daty w pionie w formacie karty G (dd-mm-rrrr);
- **święta wspólne dla programu** w Ustawieniach (`config/main.holidays`, `holidayStore.js`, `views/holidays.js`) – używa ich Harmonogram
  i Grafik; import z G dopisuje daty z `i!A36:A100`; reguły: listę świąt zmienia GOD albo osoba z zapisem w Grafiku.
