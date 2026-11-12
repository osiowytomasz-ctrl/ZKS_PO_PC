// Poziomy dostępu do Harmonogramu (kolumna „Harmonogram” w zakładce Uzytkownicy → claim `harm` w tokenie Firebase).
// GOD – wszystko (także usuwanie, kolory i czcionki operacji, kolory stanowisk, komisy, święta), MASTER – przeglądanie, dodawanie, edycja,
// CLERIK – przeglądanie, dodawanie, TOURIST – przeglądanie, --- (none) – brak dostępu. Pilnują tego też reguły Firestore.

export const HARM_LEVELS = ['none', 'tourist', 'clerik', 'master', 'god'];
export const HARM_LABELS = { none: '---', tourist: 'TOURIST', clerik: 'CLERIK', master: 'MASTER', god: 'GOD' };

export function normLevel(x) {
  const t = String(x ?? '').trim().toLowerCase();
  if (/^-+$/.test(t)) return 'none';
  return HARM_LEVELS.includes(t) ? t : null;
}

/** Poziom, gdy serwer (stary Firebase.gs) nie podał `harm`: jak dotychczas – zapis w Planie lub Grafiku = pełny dostęp, odczyt = przeglądanie. */
export function legacyLevel(perms) {
  const p = perms || {};
  if (p.plan === 'write' || p.grafik === 'write') return 'god';
  if (p.plan === 'read' || p.grafik === 'read') return 'tourist';
  return 'none';
}

/** Uprawnienia dla poziomu. */
export function harmAccess(level) {
  const lv = normLevel(level) || 'none', r = HARM_LEVELS.indexOf(lv);
  return { level: lv, label: HARM_LABELS[lv], view: r >= 1, add: r >= 2, edit: r >= 3, del: r >= 4, style: r >= 4 };
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
