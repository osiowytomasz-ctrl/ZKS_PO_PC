// Dane Harmonogramu i Grafiku w Firestore: nasłuch na żywo, import z plików, zmiana pojedynczych pól.
import { firebase } from './fb.js';
import { chunkId } from './logic/harmModel.js';

const BATCH = 400;

/** Nasłuch zmian operacji i konfiguracji: onChange({opsByLp, cfg, fromCache}). Zwraca funkcję kończącą nasłuch. */
export async function watchHarm(onChange, onError) {
  const { sdk, db } = await firebase();
  const st = { chunks: new Map(), cfg: null, ready: { ops: false, cfg: false }, fromCache: true };
  const emit = () => {
    if (!(st.ready.ops && st.ready.cfg)) return;
    const opsByLp = {}; for (const c of st.chunks.values()) Object.assign(opsByLp, c);
    onChange({ opsByLp, cfg: st.cfg, fromCache: st.fromCache });
  };
  const un = [
    sdk.onSnapshot(sdk.collection(db, 'harm_ops'), (snap) => {
      for (const ch of snap.docChanges()) { if (ch.type === 'removed') st.chunks.delete(ch.doc.id); else st.chunks.set(ch.doc.id, ch.doc.data().ops || {}); }
      st.ready.ops = true; st.fromCache = snap.metadata.fromCache; emit();
    }, onError),
    sdk.onSnapshot(sdk.doc(db, 'config', 'main'), (snap) => { st.cfg = snap.exists() ? snap.data() : null; st.ready.cfg = true; emit(); }, onError),
  ];
  return () => un.forEach((f) => f());
}

const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v; return r; };

/** Import operacji z arkusza (wynik opsFromSheetRows): zastępuje całą zawartość harm_ops. Tylko suche dane; ustawienia stanowisk (config/main) zostają. */
export async function importOps(operations) {
  const { sdk, db } = await firebase();
  const chunks = new Map();
  for (const o of operations) {
    const { lp, ...rest } = o;
    const id = chunkId(lp);
    if (!chunks.has(id)) chunks.set(id, {});
    if (!(lp in chunks.get(id))) chunks.get(id)[lp] = clean(rest);
  }
  const old = await sdk.getDocs(sdk.collection(db, 'harm_ops'));
  const writes = [];
  old.forEach((d) => { if (!chunks.has(d.id)) writes.push((b) => b.delete(d.ref)); });
  for (const [id, ops] of chunks) writes.push((b) => b.set(sdk.doc(db, 'harm_ops', id), { ops }));
  await commit(sdk, db, writes);
  return { chunks: chunks.size, operations: operations.length };
}

/** Zmiana pól jednej operacji (np. {startManual: ms|null}); null kasuje wartość w bazie. */
export async function updateOp(lp, patch) {
  const { sdk, db } = await firebase();
  const data = {};
  for (const [k, v] of Object.entries(patch)) data[`ops.${lp}.${k}`] = v === null ? sdk.deleteField() : v;
  await sdk.updateDoc(sdk.doc(db, 'harm_ops', chunkId(lp)), data);
}

/** Nowa operacja albo pełna podmiana istniejącej. */
export async function saveOp(lp, op) {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'harm_ops', chunkId(lp)), { ops: { [lp]: clean(op) } }, { merge: true });
}

/** Wiele nowych operacji naraz (jeden zapis wsadowy; operacje z jednego dokumentu scalane). */
export async function saveOps(entries) {
  const { sdk, db } = await firebase();
  const chunks = new Map();
  for (const [lp, op] of entries) { const id = chunkId(lp); if (!chunks.has(id)) chunks.set(id, {}); chunks.get(id)[lp] = clean(op); }
  const b = sdk.writeBatch(db);
  for (const [id, ops] of chunks) b.set(sdk.doc(db, 'harm_ops', id), { ops }, { merge: true });
  await b.commit();
}

/** Zmiana numeru operacji (plan z renamePlan): nowe klucze, usunięcie starych (także suboperacji) i poprawa poprzedników – jednym zapisem wsadowym. */
export async function renameOp(plan) {
  const { sdk, db } = await firebase();
  const ref = (lp) => sdk.doc(db, 'harm_ops', chunkId(lp));
  const b = sdk.writeBatch(db);
  // najpierw usuwamy wszystkie stare klucze, potem zapisujemy nowe – dzięki temu działa też zamiana miejscami (a ↔ b)
  for (const m of plan.moves) b.update(ref(m.oldId), { [`ops.${m.oldId}`]: sdk.deleteField() });
  for (const m of plan.moves) b.set(ref(m.newId), { ops: { [m.newId]: clean(m.op) } }, { merge: true });
  for (const [lp, preds] of plan.referrers) b.update(ref(lp), { [`ops.${lp}.preds`]: preds });
  await b.commit();
}

/**
 * Zapis gałęzi z edytora (plan z planTree): najpierw kasowanie numerów z [plan.remove] (stare numery, usunięte i nadpisywane operacje),
 * potem zapis [plan.sets] – jednym zapisem wsadowym, więc działa też zamiana numerów miejscami.
 */
export async function applyTree(plan) {
  const { sdk, db } = await firebase();
  const ref = (lp) => sdk.doc(db, 'harm_ops', chunkId(lp));
  const b = sdk.writeBatch(db);
  for (const lp of plan.remove) b.update(ref(lp), { [`ops.${lp}`]: sdk.deleteField() });
  for (const [lp, op] of plan.sets) b.set(ref(lp), { ops: { [lp]: clean(op) } }, { merge: true });
  await b.commit();
}

/** Usunięcie kilku operacji naraz (np. operacji głównej razem z suboperacjami). */
export async function deleteOps(lps) {
  const { sdk, db } = await firebase();
  const b = sdk.writeBatch(db);
  for (const lp of lps) b.update(sdk.doc(db, 'harm_ops', chunkId(lp)), { [`ops.${lp}`]: sdk.deleteField() });
  await b.commit();
}

export async function deleteOp(lp) {
  const { sdk, db } = await firebase();
  await sdk.updateDoc(sdk.doc(db, 'harm_ops', chunkId(lp)), { [`ops.${lp}`]: sdk.deleteField() });
}

async function commit(sdk, db, writes) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const b = sdk.writeBatch(db);
    for (const w of writes.slice(i, i + BATCH)) w(b);
    await b.commit();
  }
}

/** Zapis ustawień harmonogramu: stanowiska [{name, bg, color, sum?}], kolory komisów [{komis, bg, color, …}] i święta [{date: 'RRRR-MM-DD', name}] (zamienia całe listy). */
export async function saveSettings(stations, komisColors, holidays) {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'config', 'main'), {
    stations: stations.map(({ name, bg, color, sum }) => (sum ? { name, bg, color, sum: true } : { name, bg, color })),
    komisColors: komisColors.map(({ komis, bg, color, bold, italic, underline }) => ({ komis, bg, color, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(underline ? { underline: true } : {}) })),
    ...(holidays ? { holidays: holidays.map(({ date, name }) => (name ? { date, name } : { date })) } : {}),
  }, { merge: true });
}
