// Dostęp do Narzędziowni, Zakupów, Harmonogramu i Ustawień wg poziomu z kolumny „Grafik dostęp” (GOD / MASTER / CLERIK / TOURIST / ---).
//  GOD     – wszystko, w tym edycja konturów, układu płytek i zatwierdzanie konturów.
//  MASTER  – przegląda wszystko; ToolBuilder (składanie narzędzi, zapis do Assem.Tool), ToolTrack (pożyczanie), Zakupy (zamówienia i zatwierdzanie
//            zakupów); nie edytuje konturów ani układu płytek.
//  CLERIK  – widzi tylko ToolBuilder, Assem.Tool, ToolTrack i Części; reszta Narzędziowni niewidoczna.
//  TOURIST – bez Narzędziowni (przycisk niewidoczny, wejście zabronione), bez Harmonogramu; w Ustawieniach tylko klucz i aktualizacja.
import { HARM_LEVELS, normLevel } from './harmAccess.js';

/** Moduły Narzędziowni widoczne dla CLERIK. */
export const CLERIK_TOOL_MODULES = ['toolbuilder', 'assemtool', 'tooltrack', 'czesci'];

export function toolroomAccess(level) {
  const lv = normLevel(level) || 'none', r = HARM_LEVELS.indexOf(lv);
  return {
    level: lv,
    enter: r >= 2,                                  // przycisk Narzędziownia i wejście do niej
    moduleVisible: (id) => (r >= 3 ? true : r === 2 ? CLERIK_TOOL_MODULES.includes(id) : false),
    harmonogram: r >= 2,                            // przycisk Harmonogram (TOURIST – niedostępny)
    editContours: r >= 4,                           // edycja konturów, zatwierdzanie konturów (GOD)
    editPlates: r >= 4,                             // układ płytek i parametry (GOD)
    zakupy: r >= 3,                                 // Zakupy: wprowadzanie zamówień i zatwierdzanie zakupów (MASTER, GOD)
    fullSettings: r >= 2,                           // pełne Ustawienia (TOURIST: tylko klucz i aktualizacja)
    apiLink: r >= 4,                                // adres API widoczny i edytowalny tylko dla GOD
  };
}
