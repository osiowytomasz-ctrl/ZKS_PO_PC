// Pomiary (karta pomiaru) w Firebase – bez arkusza „Karty pomiarowe” i bez Script Properties.
//  - karta/{id}: pola karty jak w arkuszu (komis, klient, nrId, nazwaWyrobu, nrRys, autorRaportu, colJ…signSprawdzilData) + lp, data, by, at
//  - karta_draft/{uid}: { json, at } – szkic karty w trakcie wypełniania, osobno dla każdego użytkownika
// Strona karty (web/karta-pomiaru.html) woła te same funkcje co dawniej przez google.script.run – program obsługuje je tutaj.
import { firebase } from './fb.js';
import { api } from './ui.js';

/** Pola karty (kolejność jak kolumny C… arkusza „Karty pomiarowe”). */
export const KARTA_FIELDS = ['komis', 'klient', 'nrId', 'nazwaWyrobu', 'nrRys', 'autorRaportu', 'colJ', 'colK', 'colL', 'support',
  'lvl1Header', 'lvl1Vals', 'lvl2Header', 'lvl2Vals', 'lvl3Header', 'lvl3Vals', 'lvl4Header', 'lvl4Vals', 'lvl5Header', 'lvl5Vals', 'lvl6Header', 'lvl6Vals',
  'coneAngle', 'flangeCount', 'weldsCount', 'flangeUpperFaceIn', 'flangeLowerFaceIn', 'lvlDims', 'uwagi', 'signWykonal', 'signWykonalData', 'signSprawdzil', 'signSprawdzilData'];

const pick = (o) => Object.fromEntries(KARTA_FIELDS.map((k) => [k, String((o || {})[k] ?? '')]));
const pad = (n) => String(n).padStart(2, '0');
/** Data zapisu jak w arkuszu: dd.MM.yyyy HH:mm:ss. */
export const kartaStamp = (d = new Date()) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
/** Pozycja listy (jak karta_listaPomiarow): rowIndex = identyfikator karty w bazie. */
export const listItem = (id, d) => ({ rowIndex: id, lp: d.lp ?? '', data: d.data || '', komis: d.komis || '', klient: d.klient || '', nrId: d.nrId || '', nazwaWyrobu: d.nazwaWyrobu || '', nrRys: d.nrRys || '', autorRaportu: d.colJ || '' });

async function all() {
  const { sdk, db } = await firebase();
  const out = [];
  (await sdk.getDocs(sdk.collection(db, 'karta'))).forEach((d) => out.push({ id: d.id, d: d.data() || {} }));
  return out.sort((a, b) => (Number(b.d.at) || 0) - (Number(a.d.at) || 0));
}

/** Obsługa wywołań strony karty (te same nazwy co funkcje Apps Script); [email] – zalogowany użytkownik. */
export async function kartaCall(fn, args, email = '') {
  const { sdk, db } = await firebase();
  const uid = (sdk.getAuth().currentUser && sdk.getAuth().currentUser.uid) || 'anon';
  switch (fn) {
    case 'karta_zapiszPomiar': {
      const list = await all();
      const lp = list.reduce((m, x) => Math.max(m, Number(x.d.lp) || 0), 0) + 1;
      const id = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await sdk.setDoc(sdk.doc(db, 'karta', id), { ...pick(args[0]), lp, data: kartaStamp(), by: email, at: Date.now() });
      return { ok: true, row: id };
    }
    case 'karta_listaPomiarow': return (await all()).map((x) => listItem(x.id, x.d));
    case 'karta_szukajPomiarow': {
      const [komis, nazwa, rys] = args.map((v) => String(v ?? '').trim());
      return (await all()).filter((x) => String(x.d.komis).trim() === komis && String(x.d.nazwaWyrobu).trim() === nazwa && String(x.d.nrRys).trim() === rys)
        .map((x) => ({ ...listItem(x.id, x.d), nazwaOperacji: x.d.autorRaportu || '', wykonal: x.d.colJ || '' }));
    }
    case 'karta_wczytajPomiar': {
      const s = await sdk.getDoc(sdk.doc(db, 'karta', String(args[0])));
      return pick(s.exists() ? s.data() : {});
    }
    case 'karta_getCurrentUserEmail': return String(email || '').toLowerCase();
    case 'karta_cacheSave': await sdk.setDoc(sdk.doc(db, 'karta_draft', uid), { json: String(args[0] ?? ''), at: Date.now() }); return true;
    case 'karta_cacheLoad': { const s = await sdk.getDoc(sdk.doc(db, 'karta_draft', uid)); return s.exists() ? String(s.data().json || '') : ''; }
    default: throw new Error(`Funkcja „${fn}” nie jest dostępna w aplikacji.`);
  }
}

/** Jednorazowe przeniesienie kart z arkusza „Karty pomiarowe” do bazy (GOD; API karta_export) – identyfikator „r<wiersz>”, istniejące nadpisywane. */
export async function importKartyFromSheet(user = '') {
  const x = await api('karta_export', [], { timeoutMs: 240000 });
  const { sdk, db } = await firebase();
  const rows = (x && x.rows) || [];
  for (let i = 0; i < rows.length; i += 400) {
    const b = sdk.writeBatch(db);
    rows.slice(i, i + 400).forEach((r, k) => b.set(sdk.doc(db, 'karta', 'r' + r.row), { ...pick(r), lp: r.lp ?? '', data: r.data || '', by: user, at: (i + k + 1), imported: true }));
    await b.commit();
  }
  return rows.length;
}
