// Karta ZN w bazie Firebase (Etap 1 przejścia z arkusza): zn_entries/{zn_nnnnn} = { lp, code, pct, who, date, damage, cause, createdAt, createdBy }, zn_meta/main = { next } (następny lp).
// Odczyt: każdy zalogowany; dodawanie wpisu: każdy zalogowany (jak dotąd narzędziowiec po oględzinach); zmiana, usuwanie i import – MASTER / GOD (reguły Firestore).
import { firebase } from './fb.js';
import { znId } from './logic/znDb.js';

/** Wszystkie wpisy z bazy (wg lp). */
export async function loadZnEntries() {
  const { sdk, db } = await firebase();
  const snap = await sdk.getDocs(sdk.collection(db, 'zn_entries'));
  const out = []; snap.forEach((d) => out.push(d.data()));
  return out.sort((a, b) => a.lp - b.lp);
}

/** Dodaje wpis { code, pct, who, date, damage, cause } z kolejnym numerem lp (transakcja – dwie osoby naraz dostaną różne numery). Zwraca wpis z lp. */
export async function addZnEntry(entry, user = '') {
  const { sdk, db } = await firebase();
  const metaRef = sdk.doc(db, 'zn_meta', 'main');
  let lp = 0;
  await sdk.runTransaction(db, async (tx) => {
    const m = await tx.get(metaRef);
    lp = m.exists() ? Number(m.data().next) || 1 : 1;
    tx.set(metaRef, { next: lp + 1 });
    tx.set(sdk.doc(db, 'zn_entries', znId(lp)), { lp, ...entry, createdAt: Date.now(), createdBy: String(user || '') });
  });
  return { lp, ...entry };
}

/** Import: zastępuje wszystkie wpisy w bazie wpisami [entries] (z entriesFromSheet) i ustawia licznik. MASTER / GOD. */
export async function importZnEntries(entries, user = '') {
  const { sdk, db } = await firebase();
  const old = await sdk.getDocs(sdk.collection(db, 'zn_entries'));
  const ops = [];
  old.forEach((d) => ops.push((b) => b.delete(d.ref)));
  const now = Date.now();
  for (const e of entries) ops.push((b) => b.set(sdk.doc(db, 'zn_entries', znId(e.lp)), { ...e, createdAt: now, createdBy: String(user || '') }));
  ops.push((b) => b.set(sdk.doc(db, 'zn_meta', 'main'), { next: Math.max(0, ...entries.map((e) => e.lp)) + 1, importedAt: now, importedBy: String(user || '') }));
  for (let i = 0; i < ops.length; i += 400) { const b = sdk.writeBatch(db); ops.slice(i, i + 400).forEach((o) => o(b)); await b.commit(); }
  return { entries: entries.length };
}
