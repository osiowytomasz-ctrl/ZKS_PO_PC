// Rejestry zużycia (ZP, ZwG) w bazie Firebase (Etap 1 przejścia z arkusza): reg_zp/{cnnn} i reg_zwg/{cnnn} = { r: { "<n>": "<JSON wpisu>" } } po CHUNK wpisów w dokumencie
// (n = numer wiersza arkusza, kolejne wpisy dostają kolejne numery), reg_meta/{klucz} = { next } – następny numer. Odczyt: każdy zalogowany; dopisywanie: każdy zalogowany
// (Skaner → pobranie części, formularz ZwG); import (zastąpienie danych) i usuwanie – MASTER / GOD (reguły Firestore).
import { firebase } from './fb.js';
import { chunkOf, CHUNK } from './logic/regDb.js';

const col = (key) => `reg_${key}`;
const cid = (n) => `c${String(chunkOf(n)).padStart(3, '0')}`;

/** Wszystkie wpisy rejestru [key] ('zp' | 'zwg') z bazy, wg numeru n. */
export async function loadReg(key) {
  const { sdk, db } = await firebase();
  const snap = await sdk.getDocs(sdk.collection(db, col(key)));
  const out = [];
  snap.forEach((d) => { for (const [n, json] of Object.entries((d.data() || {}).r || {})) { try { out.push({ n: Number(n), ...JSON.parse(json) }); } catch { /* uszkodzony wpis pomijamy */ } } });
  return out.sort((a, b) => a.n - b.n);
}

/** Dokument reg_meta/{key} (next, importedAt, importedBy, count, + pola dodatkowe z importu, np. nagłówki PSWT) albo {}. */
export async function loadRegMeta(key) {
  const { sdk, db } = await firebase();
  const d = await sdk.getDoc(sdk.doc(db, 'reg_meta', key));
  return d.exists() ? d.data() : {};
}

/**
 * Dopisuje wpis do rejestru [key]; [n] – numer wiersza arkusza, gdy wpis jest jednocześnie zapisywany w arkuszu (tryb równoległy), inaczej następny wolny.
 * Transakcja: dwie osoby naraz nie dostaną tego samego numeru. Zwraca wpis z numerem n.
 */
export async function appendReg(key, entry, n = null) {
  const { sdk, db } = await firebase();
  const metaRef = sdk.doc(db, 'reg_meta', key);
  let used = 0;
  await sdk.runTransaction(db, async (tx) => {
    const m = await tx.get(metaRef);
    const next = m.exists() ? Number(m.data().next) || 1 : 1;
    used = n != null ? n : next;
    const { n: _drop, ...rest } = entry;
    tx.set(sdk.doc(db, col(key), cid(used)), { r: { [used]: JSON.stringify(rest) } }, { merge: true });
    tx.set(metaRef, { next: Math.max(next, used + 1) });
  });
  return { n: used, ...entry };
}

/** Import: zastępuje wszystkie wpisy rejestru [key] wpisami [entries] (z entriesFromSheet) i ustawia licznik. MASTER / GOD. */
export async function importReg(key, entries, user = '', extraMeta = {}) {
  const { sdk, db } = await firebase();
  const old = await sdk.getDocs(sdk.collection(db, col(key)));
  const ops = [];
  old.forEach((d) => ops.push((b) => b.delete(d.ref)));
  const chunks = new Map();
  for (const { n, ...rest } of entries) { const id = cid(n); if (!chunks.has(id)) chunks.set(id, {}); chunks.get(id)[n] = JSON.stringify(rest); }
  for (const [id, r] of chunks) ops.push((b) => b.set(sdk.doc(db, col(key), id), { r }));
  ops.push((b) => b.set(sdk.doc(db, 'reg_meta', key), { next: Math.max(0, ...entries.map((e) => e.n)) + 1, importedAt: Date.now(), importedBy: String(user || ''), count: entries.length, chunk: CHUNK, ...extraMeta }));
  for (let i = 0; i < ops.length; i += 400) { const b = sdk.writeBatch(db); ops.slice(i, i + 400).forEach((o) => o(b)); await b.commit(); }
  return { entries: entries.length, chunks: chunks.size };
}

/**
 * Zmiana istniejącego wpisu [n] rejestru [key] w jednej transakcji: [fn](wpis) → { entry } (zapis), { conflict } albo { error } (bez zapisu). Wynik: to, co zwróciło [fn], albo { error: 'badrow' }.
 * Używane przez Zakupy (edycja komórek, realizacja zakupu).
 */
export async function updateReg(key, n, fn) {
  const { sdk, db } = await firebase();
  const ref = sdk.doc(db, col(key), cid(n));
  return sdk.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref), json = snap.exists() ? ((snap.data() || {}).r || {})[n] : null;
    if (!json) return { error: 'badrow' };
    const res = fn({ n, ...JSON.parse(json) });
    if (res && res.entry) { const { n: _drop, ...rest } = res.entry; tx.set(ref, { r: { [n]: JSON.stringify(rest) } }, { merge: true }); }
    return res;
  });
}

/** Jeden wpis [n] rejestru [key] wprost z serwera (jeden dokument) albo null. */
export async function readReg(key, n) {
  const { sdk, db } = await firebase();
  const snap = await sdk.getDoc(sdk.doc(db, col(key), cid(n))), json = snap.exists() ? ((snap.data() || {}).r || {})[n] : null;
  if (!json) return null;
  try { return { n: Number(n), ...JSON.parse(json) }; } catch { return null; }
}

/** Usuwa wpis [n] z rejestru [key] (np. przeniesienie zakupu do archiwum). Reguły: zapis w danym rejestrze. */
export async function deleteReg(key, n) {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, col(key), cid(n)), { r: { [n]: sdk.deleteField() } }, { merge: true });
}
