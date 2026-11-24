// Dostęp do Narzędziowni i Zakupów wg poziomu z kolumny „Narzędziownia” (GOD / MASTER / CLERIK / TOURIST / ---); pusta komórka = poziom z „Grafik dostęp”.
// Narzędziowiec ma tu np. GOD, a inni inne uprawnienia; z czasem rozwiniemy je szczegółowo.
//  GOD     – wszystko, w tym edycja konturów, zatwierdzanie konturów i układ płytek / parametry.
//  MASTER  – przegląda wszystko; ToolBuilder (składanie narzędzi, zapis do Assem.Tool), ToolTrack (pożyczanie), Zakupy (zamówienia i zatwierdzanie
//            zakupów); nie edytuje konturów ani układu płytek.
//  CLERIK  – widzi tylko ToolBuilder, Assem.Tool, ToolTrack i Części; reszta Narzędziowni niewidoczna, bez Zakupów.
//  TOURIST – bez Narzędziowni (przycisk niewidoczny, wejście zabronione).
// Osobno (poziom z „Grafik dostęp”): Harmonogram niedostępny dla TOURIST, w Ustawieniach tylko klucz i aktualizacja, adres API tylko GOD – appAccess.
import { HARM_LEVELS, normLevel } from './harmAccess.js';
import { grafikLevelOf } from './grafikAccess.js';

/** Moduły Narzędziowni widoczne dla CLERIK. */
export const CLERIK_TOOL_MODULES = ['toolbuilder', 'assemtool', 'tooltrack', 'czesci'];

/** Poziom w Narzędziowni z danych użytkownika (whoami: toolroomLevel); stary serwer albo pusta komórka – jak poziom Grafiku. */
export function toolroomLevelOf(user) {
  if (!user) return 'none';
  return normLevel(user.toolroomLevel) || grafikLevelOf(user);
}

export function toolroomAccess(level) {
  const lv = normLevel(level) || 'none', r = HARM_LEVELS.indexOf(lv);
  return {
    level: lv,
    enter: r >= 2,                                  // przycisk Narzędziownia i wejście do niej
    moduleVisible: (id) => (r >= 3 ? true : r === 2 ? CLERIK_TOOL_MODULES.includes(id) : false),
    manage: r >= 3,                                 // zapis migawek danych (BN, produkty, pomiarowe, zniszczone) – MASTER, GOD
    editContours: r >= 4,                           // edycja konturów, zatwierdzanie konturów, dane konturów w bazie (GOD)
    editPlates: r >= 4,                             // układ płytek i parametry (GOD)
    zakupy: r >= 3,                                 // Zakupy: wprowadzanie zamówień i zatwierdzanie zakupów (MASTER, GOD)
  };
}

/** Dostęp ogólny wg poziomu z „Grafik dostęp”: Harmonogram, zakres Ustawień i adres API. */
export function appAccess(level) {
  const lv = normLevel(level) || 'none', r = HARM_LEVELS.indexOf(lv);
  return {
    harmonogram: r >= 2,                            // przycisk Harmonogram (TOURIST – niedostępny)
    fullSettings: r >= 2,                           // pełne Ustawienia (TOURIST: tylko klucz i aktualizacja)
    apiLink: r >= 4,                                // adres API widoczny i edytowalny tylko dla GOD
  };
}
