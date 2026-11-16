// Kompetencje w Firestore: jeden dokument kp/main = { skills: [{key, name, weight, color}], perms: [{key, name, expiry?}],
// people: { id: {lp, name, dept, nr, komis, machine, position, perms: {key: wartość}, skills: {key: poziom}} } } (ok. 35 KB dla 150 osób).
// Zmiany pojedynczych pól idą ścieżką „people.id.pole”, więc równoczesna edycja różnych komórek przez dwie osoby się nie nadpisuje.
import { firebase } from './fb.js';

export async function watchCompetence(cb, onError) {
  const { sdk, db } = await firebase();
  return sdk.onSnapshot(sdk.doc(db, 'kp', 'main'), (s) => cb(s.exists() ? s.data() : null), onError);
}

/** Zmiany pól: [{id, path: 'name' | 'perms.pJ' | 'skills.sAE' …, value}] ('' = usunięcie pola) – jednym zapisem. */
export async function setFields(changes) {
  if (!changes.length) return;
  const { sdk, db } = await firebase();
  const patch = { updatedAt: Date.now() };
  for (const ch of changes) patch[`people.${ch.id}.${ch.path}`] = ch.value === '' || ch.value == null ? sdk.deleteField() : ch.value;
  await sdk.updateDoc(sdk.doc(db, 'kp', 'main'), patch);
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

/** Grafik (pracownicy z miejscem pracy) i stanowiska Harmonogramu – do kolumny „Miejsce” i kolorów nazwisk; brak dostępu = puste. */
export async function loadGrafikPlaces() {
  const { sdk, db } = await firebase();
  const one = async (c, d) => { try { const s = await sdk.getDoc(sdk.doc(db, c, d)); return s.exists() ? s.data() : null; } catch { return null; } };
  const [meta, cfg] = await Promise.all([one('gr_meta', 'main'), one('config', 'main')]);
  return { people: (meta && meta.people) || [], cfg };
}
