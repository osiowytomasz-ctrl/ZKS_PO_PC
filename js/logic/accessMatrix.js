// Katalog elementów modułów dla tabeli uprawnień (Ustawienia → Uprawnienia – tabela) i ich domyślne prawa.
// Domyślne prawa NIE są osobną tabelą: liczy je ten sam kod, który steruje programem bez nadpisań (funkcje dostępu z parametrem raw = true),
// więc tabela zawsze pokazuje faktyczne dotychczasowe zasady, a zapisane nadpisania zmieniają tylko to, co GOD zmienił.
import { grafikAccess } from './grafikAccess.js';
import { toolroomAccess, appAccess, TOOL_SUBMODULES } from './toolroomAccess.js';
import { harmAccess, ALL_LEVELS } from './harmAccess.js';
import { MATRIX_LEVELS, STATES, overrideState } from './accessOverlay.js';

export { MATRIX_LEVELS, STATES, STATE_LABELS } from './accessOverlay.js';
export const LEVEL_LABELS = { god: 'GOD', master: 'MASTER', clerik: 'CLERIK', tourist: 'TOURIST', peasant: 'PEASANT' };

const SUB_TITLES = { toolbuilder: 'ToolBuilder', assemtool: 'Assem.Tool', tooltrack: 'ToolTrack', czesci: 'Części', produkty: 'Produkty', pomiarowe: 'Pomiarowe', zniszczone: 'Zniszczone', zuzycie: 'Zużycie' };

/**
 * Sekcje (po jednej na moduł; każda ma przycisk w Ustawieniach): elementy { id, label, kind, off }.
 * kind: 'view' – widok / moduł / sekcja (dostępny w stanie ZAPIS i ODCZYT), 'edit' – przycisk lub opcja zmieniająca dane (tylko ZAPIS);
 * off – stan, który odpowiada „wyłączone” w dotychczasowych zasadach: 'read' (widać, bez zmian) albo 'hidden' (nie ma go wcale).
 */
export const SECTIONS = [
  { key: 'skaner', title: 'Skaner', elements: [
    { id: 'skaner.enter', label: 'Moduł Skaner (przycisk i wejście)', kind: 'view', off: 'hidden' },
  ] },
  { key: 'grafik', title: 'Grafik', elements: [
    { id: 'grafik.view', label: 'Moduł Grafik – przeglądanie', kind: 'view', off: 'hidden' },
    { id: 'grafik.cells', label: 'Wpisy zmian, komentarze, wklejanie, cofanie', kind: 'edit', off: 'read' },
    { id: 'grafik.summary', label: 'Podsumowanie pracownika i UT przy nazwisku', kind: 'view', off: 'hidden' },
    { id: 'grafik.groups', label: 'Kolumny Urlopy / Godziny / Absencje', kind: 'view', off: 'hidden' },
    { id: 'grafik.manage', label: 'Dane pracowników (miejsce, urlopy, plan), święta', kind: 'edit', off: 'hidden' },
    { id: 'grafik.importG', label: 'Import z karty G', kind: 'edit', off: 'hidden' },
  ] },
  { key: 'plan', title: 'Plan', elements: [
    { id: 'plan.editPlan', label: 'Zmiany w Planie (edycja komórek, wysyłka)', kind: 'edit', off: 'read' },
  ] },
  { key: 'harmonogram', title: 'Harmonogram', elements: [
    { id: 'harmonogram.harmonogram', label: 'Moduł Harmonogram (przycisk i wejście)', kind: 'view', off: 'hidden' },
    { id: 'harmonogram.add', label: 'Dodawanie operacji', kind: 'edit', off: 'read' },
    { id: 'harmonogram.edit', label: 'Edycja istniejących operacji', kind: 'edit', off: 'read' },
    { id: 'harmonogram.del', label: 'Usuwanie operacji', kind: 'edit', off: 'hidden' },
    { id: 'harmonogram.style', label: 'Kolory i czcionki operacji, stanowiska, komisy, święta', kind: 'edit', off: 'hidden' },
    { id: 'harmonogram.sim', label: 'Symulacja (przesuwanie bez zapisu, udostępnianie)', kind: 'edit', off: 'hidden' },
  ] },
  { key: 'mistrz', title: 'Mistrz', elements: [
    { id: 'mistrz.cells', label: 'Moduł Mistrz (przycisk, wejście, rejestry)', kind: 'view', off: 'hidden' },
    { id: 'mistrz.manage', label: 'Importy i zarządzanie w Mistrzu, Skrzynka donosów', kind: 'edit', off: 'hidden' },
  ] },
  { key: 'kompetencje', title: 'Kompetencje', elements: [
    { id: 'kompetencje.competence', label: 'Moduł Kompetencje (widok i edycja)', kind: 'view', off: 'hidden' },
  ] },
  { key: 'narzedziownia', title: 'Narzędziownia', elements: [
    { id: 'narzedziownia.enter', label: 'Moduł Narzędziownia (przycisk i wejście)', kind: 'view', off: 'hidden' },
    ...TOOL_SUBMODULES.map((s) => ({ id: `narzedziownia.sub.${s}`, label: `Podmoduł ${SUB_TITLES[s]}`, kind: 'view', off: 'hidden' })),
    { id: 'narzedziownia.manage', label: 'Zapis migawek danych (BN, produkty, pomiarowe, zniszczone)', kind: 'edit', off: 'read' },
    { id: 'narzedziownia.editContours', label: 'Edycja i zatwierdzanie konturów, generator konturów', kind: 'edit', off: 'read' },
    { id: 'narzedziownia.editPlates', label: 'Układ płytek i parametry, części narzędzia', kind: 'edit', off: 'read' },
  ] },
  { key: 'zakupy', title: 'Zakupy', elements: [
    { id: 'zakupy.zakupy', label: 'Zakupy – zamówienia i zatwierdzanie zakupów', kind: 'edit', off: 'hidden' },
  ] },
  { key: 'tablica', title: 'Tablica', elements: [
    { id: 'tablica.editPlan', label: 'Zmiany w Tablicy (zadania, ogłoszenia)', kind: 'edit', off: 'read' },
  ] },
  { key: 'ustawienia', title: 'Ustawienia', elements: [
    { id: 'ustawienia.fullSettings', label: 'Pełne Ustawienia (bez tego tylko klucz i aktualizacja)', kind: 'view', off: 'hidden' },
    { id: 'ustawienia.apiLink', label: 'Adres API', kind: 'edit', off: 'hidden' },
  ] },
];
export const ELEMENTS = Object.fromEntries(SECTIONS.flatMap((s) => s.elements.map((e) => [e.id, { ...e, section: s.key }])));

/** Czy element jest włączony w dotychczasowych zasadach (kod bez nadpisań) dla poziomu [level] (god … peasant). */
export function baseOn(id, level) {
  const [mod, ...rest] = id.split('.');
  const flag = rest.join('.');
  if (id === 'skaner.enter') return ALL_LEVELS.indexOf(level) >= 1;   // od PEASANT w górę; „---” – niedostępny
  if (mod === 'grafik' || mod === 'mistrz' || mod === 'kompetencje') return !!grafikAccess(level, mod, true)[flag];
  if (mod === 'plan' || mod === 'tablica' || mod === 'ustawienia') return !!appAccess(level, mod, true)[flag];
  if (id === 'harmonogram.harmonogram') return !!appAccess(level, 'harmonogram', true).harmonogram;
  if (mod === 'harmonogram') return !!harmAccess(level, true)[flag];
  if (mod === 'zakupy') return !!toolroomAccess(level, 'zakupy', true).zakupy;
  if (mod === 'narzedziownia') {
    if (flag.startsWith('sub.')) return !!toolroomAccess(level, 'narzedziownia', true).moduleVisible(flag.slice(4));
    return !!toolroomAccess(level, 'narzedziownia', true)[flag];
  }
  return false;
}

/** Domyślny stan elementu na poziomie (z dotychczasowych zasad). */
export function defaultState(id, level) {
  const el = ELEMENTS[id];
  return baseOn(id, level) ? 'write' : el.off;
}

/** Obowiązujący stan: nadpisany z tabeli albo domyślny. */
export function stateOf(id, level) { return overrideState(id, level) || defaultState(id, level); }

/** Cały wiersz (5 poziomów) – obowiązujący. */
export function rowOf(id) { return Object.fromEntries(MATRIX_LEVELS.map((lv) => [lv, stateOf(id, lv)])); }

/** Nadpisania do zapisu: tylko wiersze różniące się od domyślnych (wiersz zapisywany w całości). */
export function diffFromDefaults(rows) {
  const out = {};
  for (const [id, row] of Object.entries(rows)) {
    if (!ELEMENTS[id]) continue;
    if (MATRIX_LEVELS.some((lv) => row[lv] !== defaultState(id, lv))) out[id] = Object.fromEntries(MATRIX_LEVELS.map((lv) => [lv, STATES.includes(row[lv]) ? row[lv] : defaultState(id, lv)]));
  }
  return out;
}
