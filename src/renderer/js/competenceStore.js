// Kompetencje w Firestore: jeden dokument kp/main = { skills: [{key, name, weight, color}], perms: [{key, name, expiry?}],
// people: { id: {lp, name, dept, nr, komis, machine, position, perms: {key: wartość}, skills: {key: poziom}} } } (ok. 35 KB dla 150 osób).
// Zmiany pojedynczych pól idą ścieżką „people.id.pole”, więc równoczesna edycja różnych komórek przez dwie osoby się nie nadpisuje.
import { firebase } from './fb.js';

export async function watchCompetence(cb, onError) {
  const { sdk, db } = await firebase();
  return sdk.onSnapshot(sdk.doc(db, 'kp', 'main'), (s) => (!s.exists() && s.metadata && s.metadata.fromCache) ? undefined : cb(s.exists() ? s.data() : null), onError);
}

/** Zmiany pól: [{id, path: 'name' | 'perms.pJ' | 'skills.sAE' …, value}] ('' = usunięcie pola) – jednym zapisem. */
export async function setFields(changes) {
  if (!changes.length) return;
  const { sdk, db } = await firebase();
  const patch = { updatedAt: Date.now() };
  for (const ch of changes) patch[`people.${ch.id}.${ch.path}`] = ch.value === '' || ch.value == null ? sdk.deleteField() : ch.value;
  const ref = sdk.doc(db, 'kp', 'main');
  try { await sdk.updateDoc(ref, patch); }
  catch (e) { if (e.code !== 'not-found') throw e; await sdk.setDoc(ref, { skills: [], perms: [], people: {} }, { merge: true }); await sdk.updateDoc(ref, patch); }
}

export async function savePerson(id, data) {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'kp', 'main'), { people: { [id]: data }, updatedAt: Date.now() }, { merge: true });
}

export async function deletePerson(id) {
  const { sdk, db } = await firebase();
  await sdk.updateDoc(sdk.doc(db, 'kp', 'main'), { [`people.${id}`]: sdk.deleteField(), updatedAt: Date.now() });
}

/** Zapis definicji kolumn (umiejętności z wagami, uprawnienia). */
export async function saveDefs(defs) {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'kp', 'main'), { ...defs, updatedAt: Date.now() }, { merge: true });
}

/** Import całej matrycy (zastępuje dokument). */
export async function importCompetence(data, user = '') {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'kp', 'main'), { ...data, importedAt: Date.now(), importedBy: user, updatedAt: Date.now() });
}

/**
 * Pracownicy z Grafiku (gr_meta/main) i stanowiska Harmonogramu (config/main) na żywo: cb({meta, cfg}); brak dostępu = puste.
 * Lista pracowników jest wspólna: Kompetencje dodają i zmieniają osoby (nazwisko, nr ew., miejsce pracy) w Grafiku.
 */
export async function watchGrafikMeta(cb) {
  const { sdk, db } = await firebase();
  const st = { meta: null, cfg: null, n: 0 };
  const emit = () => { if (st.n >= 2) cb({ meta: st.meta, cfg: st.cfg }); };
  const once = new Set();
  const on = (c, d, k) => sdk.onSnapshot(sdk.doc(db, c, d), (s) => { if (!s.exists() && s.metadata && s.metadata.fromCache) return; st[k] = s.exists() ? s.data() : null; if (!once.has(k)) { once.add(k); st.n++; } emit(); }, () => { st[k] = null; if (!once.has(k)) { once.add(k); st.n++; } emit(); });
  const u1 = on('gr_meta', 'main', 'meta'), u2 = on('config', 'main', 'cfg');
  return () => { u1(); u2(); };
}
