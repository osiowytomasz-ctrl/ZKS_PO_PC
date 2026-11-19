// Grafik w Firestore: gr_meta/main (pracownicy, miejsca pracy, urlopy, święta) i gr_days/{rrrr-mm} (kody i komentarze miesiąca).
// W bazie tylko kody i komentarze – kolory i podsumowania liczy program (logic/grafikFb.js). Nasłuch na żywo tylko potrzebnych miesięcy.
import { queueInBatch, grafikQueueItems } from './syncStore.js';
import { firebase, resetFirestoreCache } from './fb.js';

// Pusty wynik z pamięci lokalnej pomijamy i czekamy na serwer; potwierdzenie z serwera, że dokumentu nie ma, różni się od pamięci
// tylko znacznikiem fromCache – bez includeMetadataChanges Firestore go nie przysyła (ekran wisiałby na „Wczytywanie…”).
const WITH_META = { includeMetadataChanges: true };
import { api } from './ui.js';
import { monthKey, dayOf } from './logic/grafikFb.js';
import { addHolidays } from './holidayStore.js';

/**
 * Nasłuch pracowników i miesięcy [months]; [cb]({meta, months: {rrrr-mm: doc}, cfg}) – cfg = config/main Harmonogramu (kolory stanowisk,
 * wspólne święta; brak dostępu = null, bez błędu). Zwraca obiekt z setMonths(lista) i stop().
 */
export async function watchGrafik(months, cb, onError) {
  const { sdk, db } = await firebase();
  const st = { meta: null, months: {}, cfg: null, subs: new Map(), metaReady: false, cfgReady: false, ready: new Set() };
  const emit = () => { if (st.metaReady && st.cfgReady && [...st.subs.keys()].every((k) => st.ready.has(k))) cb({ meta: st.meta, months: { ...st.months }, cfg: st.cfg, missingOnServer: !!st.missingOnServer }); };
  // pusty dokument z pamięci lokalnej (komputer jeszcze nie pobrał Grafiku) to nie „brak w bazie” – czekamy na serwer
  const metaRef = sdk.doc(db, 'gr_meta', 'main');
  let verified = false, fromServer = false;
  const unMeta = sdk.onSnapshot(metaRef, WITH_META, async (s) => {
    if (!s.exists() && s.metadata && s.metadata.fromCache) return;
    // „brak dokumentu” z nasłuchu sprawdzamy wprost na serwerze (z pominięciem pamięci lokalnej): jeśli dane tam są,
    // pamięć lokalna jest niespójna – czyścimy ją i przeładowujemy program; gdy już czyściliśmy w tej sesji – bierzemy dane z serwera
    if (!s.exists() && !verified && sdk.getDocFromServer) {
      verified = true;
      try {
        const srv = await sdk.getDocFromServer(metaRef);
        if (srv.exists()) { if (await resetFirestoreCache('gr_meta/main jest na serwerze, a pamięć lokalna podaje brak')) return; fromServer = true; st.meta = srv.data(); st.metaReady = true; emit(); return; }
        st.missingOnServer = true;
      } catch (e) { console.warn('getDocFromServer gr_meta', e); }
    }
    if (!s.exists() && fromServer) return;
    st.meta = s.exists() ? s.data() : null; st.metaReady = true; emit(); }, onError);
  const unCfg = sdk.onSnapshot(sdk.doc(db, 'config', 'main'), (s) => { st.cfg = s.exists() ? s.data() : null; st.cfgReady = true; emit(); }, () => { st.cfg = null; st.cfgReady = true; emit(); });
  const setMonths = (list) => {
    const want = new Set(list);
    for (const [k, un] of st.subs) if (!want.has(k)) { un(); st.subs.delete(k); delete st.months[k]; st.ready.delete(k); }
    for (const k of want) if (!st.subs.has(k)) {
      st.subs.set(k, sdk.onSnapshot(sdk.doc(db, 'gr_days', k), WITH_META, (s) => { if (!s.exists() && s.metadata && s.metadata.fromCache) return; st.months[k] = s.exists() ? s.data() : {}; st.ready.add(k); emit(); }, onError));
    }
    emit();
  };
  setMonths(months);
  return { setMonths, stop: () => { unMeta(); unCfg(); for (const un of st.subs.values()) un(); st.subs.clear(); } };
}

/**
 * Zapis zmian komórek: [{pid, iso, code?, note?}] (code/note pominięte = bez zmiany, '' = usunięcie) – jednym zapisem wsadowym.
 * [rows] – mapa pid → wiersz karty G: w okresie przejściowym te same zmiany idą też do arkusza (graf_norm, wersja webowa).
 */
export async function saveCells(changes, rows) {
  if (!changes.length) return { sheet: null };
  const { sdk, db } = await firebase();
  const byMonth = new Map();
  for (const ch of changes) {
    const mk = monthKey(ch.iso), dd = dayOf(ch.iso);
    if (!byMonth.has(mk)) byMonth.set(mk, { c: {}, n: {} });
    const doc = byMonth.get(mk);
    if (ch.code !== undefined) (doc.c[ch.pid] = doc.c[ch.pid] || {})[dd] = ch.code === '' ? sdk.deleteField() : ch.code;
    if (ch.note !== undefined) (doc.n[ch.pid] = doc.n[ch.pid] || {})[dd] = ch.note === '' ? sdk.deleteField() : ch.note;
  }
  const b = sdk.writeBatch(db);
  for (const [mk, doc] of byMonth) {
    const data = {};
    if (Object.keys(doc.c).length) data.c = doc.c;
    if (Object.keys(doc.n).length) data.n = doc.n;
    b.set(sdk.doc(db, 'gr_days', mk), data, { merge: true });
  }
  // do arkusza (karta G) – nie od razu: kolejka wysyłki „Do arkusza” (MASTER, GOD), w tym samym zapisie
  queueInBatch(sdk, db, b, 'grafik', grafikQueueItems(changes, rows));
  await b.commit();
  return { sheet: null };
}

/** Zmiana danych pracowników / świąt (gr_meta/main, scalanie pól). */
export async function saveMeta(patch) {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'gr_meta', 'main'), { ...patch, updatedAt: Date.now() }, { merge: true });
}

/**
 * Import całej karty G (api grafikExport) do bazy: pracownicy (identyfikator z nr ewidencyjnego albo wiersza), kody i komentarze
 * w paczkach miesięcy, święta. Zastępuje dotychczasowe dane Grafiku w bazie. Zwraca liczby do komunikatu.
 */
export async function importFromSheet(user = '') {
  const x = await api('grafikExport', [], { timeoutMs: 180000 });
  const used = new Set();
  const people = x.people.map((p) => {
    let id = p.sep ? `sep${p.row}` : (p.nr ? String(p.nr).replace(/[^\w-]/g, '_') : `r${p.row}`);
    while (used.has(id)) id += '_';
    used.add(id);
    return { id, row: p.row, lp: p.lp, name: p.name, suffix: p.suffix || '', nr: p.nr || '', place: p.place || '', sep: !!p.sep, ut: p.ut || {} };
  });
  const months = {};
  let cells = 0, notes = 0;
  x.people.forEach((p, i) => {
    const id = people[i].id;
    x.dates.forEach((iso, d) => {
      const code = String(x.codes[i][d] || '').trim(), note = String((x.notes[i] || [])[d] || '');
      if (!code && !note) return;
      const doc = months[monthKey(iso)] = months[monthKey(iso)] || { c: {}, n: {} };
      if (code) { (doc.c[id] = doc.c[id] || {})[dayOf(iso)] = code; cells++; }
      if (note) { (doc.n[id] = doc.n[id] || {})[dayOf(iso)] = note; notes++; }
    });
  });
  const { sdk, db } = await firebase();
  // pracownicy dodani w programie (Kompetencje – bez wiersza w karcie G) zostają na końcu listy z ich wpisami
  const prevMeta = await sdk.getDoc(sdk.doc(db, 'gr_meta', 'main'));
  const keep = ((prevMeta.exists() && prevMeta.data().people) || []).filter((p) => !p.row && !p.sep && !used.has(p.id));
  people.push(...keep);
  const keepIds = new Set(keep.map((p) => p.id));
  const old = await sdk.getDocs(sdk.collection(db, 'gr_days'));
  if (keepIds.size) old.forEach((d) => { const doc = d.data() || {}; for (const part of ['c', 'n']) for (const id of keepIds) if (doc[part] && doc[part][id]) { const m = months[d.id] = months[d.id] || { c: {}, n: {} }; m[part][id] = doc[part][id]; } });
  const writes = [];
  old.forEach((d) => { if (!months[d.id]) writes.push((b) => b.delete(d.ref)); });
  for (const [mk, doc] of Object.entries(months)) writes.push((b) => b.set(sdk.doc(db, 'gr_days', mk), doc));
  writes.push((b) => b.set(sdk.doc(db, 'gr_meta', 'main'), { people, holidays: x.holidays || [], year: x.year || '', importedAt: Date.now(), importedBy: user, updatedAt: Date.now() }));
  for (let i = 0; i < writes.length; i += 400) { const b = sdk.writeBatch(db); writes.slice(i, i + 400).forEach((w) => w(b)); await b.commit(); }
  // święta z karty i (i!A36:A100) dopisane do wspólnej listy programu (Ustawienia); brak prawa – bez błędu
  let holidays = 0;
  try { holidays = await addHolidays(x.holidays || []); } catch { /* lista świąt bez zmian */ }
  return { kept: keep.length, people: people.filter((p) => !p.sep).length, months: Object.keys(months).length, cells, notes, holidays };
}
