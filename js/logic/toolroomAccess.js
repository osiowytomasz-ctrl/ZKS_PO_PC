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
import { overlayFlags, resolveOn } from './accessOverlay.js';

/** Podmoduły Narzędziowni z własnym wierszem w tabeli uprawnień (id `narzedziownia.sub.<id>`). */
export const TOOL_SUBMODULES = ['toolbuilder', 'assemtool', 'tooltrack', 'czesci', 'produkty', 'pomiarowe', 'zniszczone', 'zuzycie'];
export const TOOLROOM_SPEC = { narzedziownia: { enter: 'view', manage: 'edit', editContours: 'edit', editPlates: 'edit' }, zakupy: { zakupy: 'edit' } };

/** Moduły Narzędziowni widoczne dla CLERIK. */
export const CLERIK_TOOL_MODULES = ['toolbuilder', 'assemtool', 'tooltrack', 'czesci'];

/** Poziom w Narzędziowni z danych użytkownika (whoami: toolroomLevel); stary serwer albo pusta komórka – jak poziom Grafiku. */
export function toolroomLevelOf(user) {
  if (!user) return 'none';
  return normLevel(user.toolroomLevel) || grafikLevelOf(user);
}

/** [mod] – 'narzedziownia' albo 'zakupy' (własny poziom); [raw] – bez nadpisań z tabeli uprawnień. */
export function toolroomAccess(level, mod = 'narzedziownia', raw = false) {
  const lv = normLevel(level) || 'none', r = HARM_LEVELS.indexOf(lv);
  const flags = {
    level: lv,
    enter: r >= 2,                                  // przycisk Narzędziownia i wejście do niej
    moduleVisible: (id) => { const base = r >= 3 ? true : r === 2 ? CLERIK_TOOL_MODULES.includes(id) : false; return raw || !TOOL_SUBMODULES.includes(id) ? base : resolveOn(`narzedziownia.sub.${id}`, lv, 'view', base); },
    manage: r >= 3,                                 // zapis migawek danych (BN, produkty, pomiarowe, zniszczone) – MASTER, GOD
    editContours: r >= 4,                           // edycja konturów, zatwierdzanie konturów, dane konturów w bazie (GOD)
    editPlates: r >= 4,                             // układ płytek i parametry (GOD)
    zakupy: r >= 3,                                 // Zakupy: wprowadzanie zamówień i zatwierdzanie zakupów (MASTER, GOD)
  };
  return raw ? flags : overlayFlags(flags, mod, lv, TOOLROOM_SPEC[mod]);
}

/** Dostęp ogólny wg poziomu z „Grafik dostęp”: Harmonogram, zakres Ustawień i adres API. */
/** [mod] – 'ustawienia' (domyślnie), 'harmonogram', 'plan' albo 'tablica' (każdy ma własne wiersze w tabeli uprawnień). */
export const APP_SPEC = { ustawienia: { fullSettings: 'view', apiLink: 'edit' }, harmonogram: { harmonogram: 'view' }, plan: { editPlan: 'edit' }, tablica: { editPlan: 'edit' } };
export function appAccess(level, mod = 'ustawienia', raw = false) {
  const lv = normLevel(level) || 'none', r = HARM_LEVELS.indexOf(lv);
  const flags = {
    harmonogram: r >= 2,                            // przycisk Harmonogram (TOURIST – niedostępny)
    fullSettings: r >= 2,                           // pełne Ustawienia (TOURIST: tylko klucz i aktualizacja)
    apiLink: r >= 4,                                // adres API widoczny i edytowalny tylko dla GOD
    editPlan: r >= 3,                               // Plan i Tablica (Workflow): zmiany tylko MASTER i GOD; CLERIK i TOURIST – tylko przeglądanie
  };
  return raw ? flags : overlayFlags(flags, mod, lv, APP_SPEC[mod]);
}
