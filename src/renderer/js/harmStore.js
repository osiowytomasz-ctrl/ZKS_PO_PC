// Dane Harmonogramu i Grafiku w Firestore: nasłuch na żywo, import z plików, zmiana pojedynczych pól.
import { firebase } from './fb.js';
import { chunkId, grafikDocs, DEFAULT_STATIONS } from './logic/harmModel.js';

const BATCH = 400;

/** Nasłuch zmian: onChange({opsByLp, daysByKey, cfg, fromCache}). Zwraca funkcję kończącą nasłuch. */
export async function watchHarm(onChange, onError) {
  const { sdk, db } = await firebase();
  const st = { opsChunks: new Map(), grafik: new Map(), cfg: null, ready: { ops: false, gr: false, cfg: false }, fromCache: true };
  const emit = () => {
    if (!(st.ready.ops && st.ready.gr && st.ready.cfg)) return;
    const opsByLp = {}; for (const c of st.opsChunks.values()) Object.assign(opsByLp, c);
    const daysByKey = {}; for (const m of st.grafik.values()) Object.assign(daysByKey, m);
    onChange({ opsByLp, daysByKey, cfg: st.cfg, fromCache: st.fromCache });
  };
  const opts = { includeMetadataChanges: false };
  const un = [
    sdk.onSnapshot(sdk.collection(db, 'harm_ops'), opts, (snap) => {
      for (const ch of snap.docChanges()) { if (ch.type === 'removed') st.opsChunks.delete(ch.doc.id); else st.opsChunks.set(ch.doc.id, ch.doc.data().ops || {}); }
      st.ready.ops = true; st.fromCache = snap.metadata.fromCache; emit();
    }, onError),
    sdk.onSnapshot(sdk.collection(db, 'grafik'), opts, (snap) => {
      for (const ch of snap.docChanges()) { if (ch.type === 'removed') st.grafik.delete(ch.doc.id); else st.grafik.set(ch.doc.id, ch.doc.data().days || {}); }
      st.ready.gr = true; emit();
    }, onError),
    sdk.onSnapshot(sdk.doc(db, 'config', 'main'), opts, (snap) => { st.cfg = snap.exists() ? snap.data() : null; st.ready.cfg = true; emit(); }, onError),
  ];
  return () => un.forEach((f) => f());
}

const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v; return r; };

/** Import operacji z pliku (wynik importOperations). Zastępuje całą zawartość harm_ops. */
export async function importOps(operations) {
  const { sdk, db } = await firebase();
  const chunks = new Map();
  for (const o of operations) {
    const { lp, ...rest } = o;
    const id = chunkId(lp);
    if (!chunks.has(id)) chunks.set(id, {});
    if (!(lp in chunks.get(id))) chunks.get(id)[lp] = clean(rest);   // przy powtórzonym lp liczy się pierwsza
  }
  const old = await sdk.getDocs(sdk.collection(db, 'harm_ops'));
  const writes = [];
  old.forEach((d) => { if (!chunks.has(d.id)) writes.push((b) => b.delete(d.ref)); });
  for (const [id, ops] of chunks) writes.push((b) => b.set(sdk.doc(db, 'harm_ops', id), { ops }));
  await commit(sdk, db, writes);
  return { chunks: chunks.size, operations: operations.length };
}

/** Import grafiku (wynik parseGrafikText): dokumenty miesięczne + lista stanowisk, jeśli jeszcze jej nie ma. */
export async function importGrafik(parsed) {
  const { sdk, db } = await firebase();
  const docs = grafikDocs(parsed.days);
  await commit(sdk, db, Object.entries(docs).map(([id, d]) => (b) => b.set(sdk.doc(db, 'grafik', id), d)));
  const cfgRef = sdk.doc(db, 'config', 'main');
  const cur = await sdk.getDoc(cfgRef);
  if (!cur.exists() || !(cur.data().stations || []).length) {
    const known = new Map(DEFAULT_STATIONS.map((s) => [s.name, s]));
    await sdk.setDoc(cfgRef, { stations: parsed.stations.map((n) => known.get(n) || { name: n, bg: '#cccccc', color: '#000000' }), holidays: cur.exists() ? cur.data().holidays || [] : [] }, { merge: true });
  }
  return { months: Object.keys(docs).length, days: parsed.days.length };
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
