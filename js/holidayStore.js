// Święta wspólne dla całego programu (Harmonogram, Grafik, Plan): config/main.holidays = [{date: 'RRRR-MM-DD', name}].
// Edycja w Ustawieniach programu; zmienia GOD Harmonogramu albo osoba z prawem zapisu w Grafiku (reguły Firestore).
import { firebase } from './fb.js';

/** Lista świąt z bazy (posortowana po dacie). */
export async function loadHolidays() {
  const { sdk, db } = await firebase();
  const s = await sdk.getDoc(sdk.doc(db, 'config', 'main'));
  return normHolidays(s.exists() ? s.data().holidays : []);
}

/** Zapis całej listy świąt (pozostałe ustawienia config/main bez zmian). */
export async function saveHolidays(list) {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'config', 'main'), { holidays: normHolidays(list).map(({ date, name }) => (name ? { date, name } : { date })) }, { merge: true });
}

/** Dopisanie dat, których jeszcze nie ma (np. święta z karty i przy imporcie Grafiku). Zwraca liczbę dopisanych. */
export async function addHolidays(dates) {
  const cur = await loadHolidays(), have = new Set(cur.map((x) => x.date));
  const add = [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !have.has(d));
  if (add.length) await saveHolidays([...cur, ...add.map((date) => ({ date, name: '' }))]);
  return add.length;
}

export function normHolidays(list) {
  const m = new Map();
  for (const x of list || []) { const date = typeof x === 'string' ? x : x && x.date; if (/^\d{4}-\d{2}-\d{2}$/.test(String(date)) && !m.has(date)) m.set(date, { date, name: (x && x.name) || '' }); }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}
