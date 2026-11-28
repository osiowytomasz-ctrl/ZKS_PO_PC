// Poziomy dostępu osobno dla każdego modułu (api_whoami.levels, kolumny zakładki Uzytkownicy – patrz backend/Firebase.gs: api_moduleLevels_).
// Poziomy od najniższego: --- (brak), PEASANT, TOURIST, CLERIK, MASTER, GOD.
//  GOD     – zapis i odczyt oraz opcje zaawansowane modułu (importy, kolory harmonogramu i stanowisk, ustawienia),
//  MASTER  – zapis i odczyt bez opcji zaawansowanych,
//  CLERIK, TOURIST – jak dotychczas (opis przy modułach: logic/grafikAccess.js, logic/toolroomAccess.js),
//  PEASANT – nowy poziom; prawa ustala administrator (na razie: nie daje dostępu do żadnego modułu poza Skanerem).
// Serwer bez `levels` (stary Firebase.gs/Api.gs) albo pusta komórka: poziom jak dotychczas (Grafik dostęp / Narzędziownia / Harmonogram).
import { normLevel, ALL_LEVELS, HARM_LABELS } from './harmAccess.js';
import { grafikLevelOf } from './grafikAccess.js';
import { toolroomLevelOf } from './toolroomAccess.js';

/** Moduły z własnym poziomem: [klucz, nazwa]. */
export const MODULE_LEVELS = [
  ['skaner', 'Skaner'], ['grafik', 'Grafik'], ['plan', 'Plan'], ['harmonogram', 'Harmonogram'], ['mistrz', 'Mistrz'],
  ['kompetencje', 'Kompetencje'], ['narzedziownia', 'Narzędziownia'], ['zakupy', 'Zakupy'], ['tablica', 'Tablica'],
];
export const MODULE_KEYS = MODULE_LEVELS.map(([k]) => k);
export { ALL_LEVELS, HARM_LABELS };

/** Poziom użytkownika w module [key]. */
export function moduleLevelOf(user, key) {
  if (!user) return 'none';
  const set = normLevel(user.levels && user.levels[key]);
  if (set) return set;
  // brak danych z serwera (stary backend): jak dotychczas
  if (key === 'narzedziownia') return toolroomLevelOf(user);
  if (key === 'zakupy') { const t = toolroomLevelOf(user); return t === 'god' || t === 'master' ? t : 'none'; }
  if (key === 'skaner') return 'clerik';
  if (key === 'harmonogram') return normLevel(user.harmLevel) || grafikLevelOf(user);
  if (key === 'plan') { const p = (user.permissions || {}).plan; const g = grafikLevelOf(user); return p === 'write' ? (g === 'god' ? 'god' : 'master') : p === 'read' ? 'tourist' : 'none'; }
  return grafikLevelOf(user);   // grafik, mistrz, kompetencje, tablica
}

/** Czy użytkownik ma w module [key] co najmniej poziom [min] (rangi: peasant < tourist < clerik < master < god). */
export function atLeast(user, key, min) {
  return ALL_LEVELS.indexOf(moduleLevelOf(user, key)) >= ALL_LEVELS.indexOf(min);
}
