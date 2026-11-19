// Poziomy dostępu do Grafiku i Kompetencji (kolumna „Grafik dostęp” w zakładce Uzytkownicy → api_whoami.grafikLevel i claim `grl`).
// GOD – wszystko; MASTER – wszystko poza importem z karty G; CLERIK – Grafik: wpisy zmian i komentarze, bez kolumn Urlopy / Godziny /
// Absencje, importu i widoku z arkusza, bez Kompetencji; TOURIST – Grafik tylko do przeglądania, bez podsumowań, bez Kompetencji.
// Te same zasady pilnują reguły Firestore (gr_days – od CLERIK, gr_meta i kp – od MASTER) i Api.gs (import z G – GOD).
import { normLevel, HARM_LEVELS, HARM_LABELS } from './harmAccess.js';

/** Poziom z danych użytkownika (whoami); stary serwer bez `grafikLevel`: zapis w Grafiku = MASTER, odczyt = TOURIST. */
export function grafikLevelOf(user) {
  if (!user) return 'none';
  const lv = normLevel(user.grafikLevel);
  if (lv) return lv;
  const p = (user.permissions || {}).grafik;
  return p === 'write' ? 'master' : p === 'read' ? 'tourist' : 'none';
}

export function grafikAccess(level) {
  const lv = normLevel(level) || 'none', r = HARM_LEVELS.indexOf(lv);
  return {
    level: lv, label: HARM_LABELS[lv],
    view: r >= 1,            // przeglądanie Grafiku
    cells: r >= 2,           // wpisy zmian, komentarze, wklejanie, cofanie
    groups: r >= 3,          // kolumny Urlopy / Godziny / Absencje
    summary: r >= 2,         // podsumowanie pracownika i „UT=” przy nazwisku (TOURIST – bez podsumowań)
    manage: r >= 3,          // dane pracowników (miejsce, urlopy, plan), święta
    sheet: r >= 4,           // dawny widok z arkusza (pobieranie z arkusza – tylko GOD)
    importG: r >= 4,         // import z karty G
    competence: r >= 3,      // moduł Kompetencje (widoczny i edytowalny)
  };
}
