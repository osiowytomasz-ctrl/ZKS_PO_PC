// Poziomy dostępu do Harmonogramu (kolumna „Harmonogram” w zakładce Uzytkownicy → claim `harm` w tokenie Firebase).
// GOD – wszystko (także usuwanie, kolory i czcionki operacji, kolory stanowisk, komisy, święta), MASTER – przeglądanie, dodawanie, edycja,
// CLERIK – przeglądanie, dodawanie, TOURIST – przeglądanie, --- (none) – brak dostępu. Pilnują tego też reguły Firestore.

import { overlayFlags } from './accessOverlay.js';
export const HARM_SPEC = { add: 'edit', edit: 'edit', del: 'edit', style: 'edit', sim: 'edit' };
export const HARM_LEVELS = ['none', 'tourist', 'clerik', 'master', 'god'];
export const HARM_LABELS = { none: '---', peasant: 'PEASANT', tourist: 'TOURIST', clerik: 'CLERIK', master: 'MASTER', god: 'GOD' };
/** Wszystkie poziomy do wyboru, od najniższego. PEASANT – piąty poziom: prawa ustala administrator; w tabelach rang (HARM_LEVELS) go nie ma, więc ma ranga niższą niż TOURIST i nie daje dostępu do niczego poza Skanerem (moduleLevels.js). */
export const ALL_LEVELS = ['none', 'peasant', 'tourist', 'clerik', 'master', 'god'];

export function normLevel(x) {
  const t = String(x ?? '').trim().toLowerCase();
  if (/^-+$/.test(t)) return 'none';
  return HARM_LEVELS.includes(t) || t === 'peasant' ? t : null;
}

/** Poziom, gdy serwer (stary Firebase.gs) nie podał `harm`: tylko przeglądanie (bezpiecznie), dla osób z dostępem do Planu lub Grafiku. */
export function legacyLevel(perms) {
  const p = perms || {};
  return ['read', 'write'].includes(p.plan) || ['read', 'write'].includes(p.grafik) ? 'tourist' : 'none';
}

/** Uprawnienia dla poziomu. */
export function harmAccess(level, raw = false) {
  const lv = normLevel(level) || 'none', r = HARM_LEVELS.indexOf(lv);
  // sim – symulacja: przesuwanie i edycja na kopii danych z bazy, bez zapisu (od CLERIK)
  const flags = { level: lv, label: HARM_LABELS[lv], view: r >= 1, add: r >= 2, edit: r >= 3, del: r >= 4, style: r >= 4, sim: r >= 2 };
  return raw ? flags : overlayFlags(flags, 'harmonogram', lv, HARM_SPEC);
}

/**
 * Czy plan zapisu z edytora gałęzi (logic/harmTree.js: planTree) mieści się w uprawnieniach; zwraca opis blokady albo null.
 * CLERIK – tylko nowe operacje (bez zmian istniejących), MASTER – bez usuwania, GOD – wszystko.
 */
export function treePlanBlock(plan, opsByLp, acc) {
  if (!acc.add) return `Poziom ${acc.label}: tylko przeglądanie`;
  if (!acc.del && (plan.deleted || []).length) return `Poziom ${acc.label}: usuwanie operacji jest zablokowane (${plan.deleted.join(', ')})`;
  if (!acc.edit) {
    const touched = [...(plan.remove || []), ...(plan.sets || []).map(([lp]) => lp).filter((lp) => opsByLp && opsByLp[lp])];
    if (touched.length) return `Poziom ${acc.label}: można tylko dodawać nowe operacje; zmiana istniejących jest zablokowana (${[...new Set(touched)].slice(0, 6).join(', ')})`;
  }
  return null;
}
