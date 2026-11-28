// Ostatnie zdarzenia Tablicy w bazie: jeden dokument wf_meta/feed = { updated, by, src: { ops: [3], docs: [3], dreg: [3], plates: [3] } } – po 3 najnowsze zdarzenia z rejestrów operacji, dokumentacji, detali
// (Mistrz PO: mp_rows) i płytek (rejestr ZP: reg_zp). Każdy użytkownik czyta tylko ten jeden dokument (na żywo); odświeża go (czytając ogony tabel) pierwszy, kto zobaczy go starszego niż godzina,
// oraz każdy program po własnym zdarzeniu (zapis skanera) – tak, aby lista była aktualna, a baza nie była obciążona. Odświeżanie wymaga prawa odczytu rejestrów Mistrza (CLERIK+).
import { firebase } from './fb.js';
import { FEED_SOURCES, FEED_PER, topEvents, feedStale } from './logic/boardFeed.js';

const pad3 = (n) => String(n).padStart(3, '0');
const CHUNK = 300;

/** Ostatnie wiersze zakładki [key] Mistrza (dwie ostatnie paczki z mp_rows): [{ row, v }]. */
export async function mpTail(key, chunksBack = 2) {
  const { sdk, db } = await firebase();
  const meta = await sdk.getDoc(sdk.doc(db, 'mp_meta', 'main'));
  if (!meta.exists()) return [];
  const sh = ((meta.data() || {}).sheets || {})[key] || {};
  const chunks = Math.max(0, Number(sh.n) || Math.ceil((Number(sh.rows) || 0) / CHUNK));   // import z programu nie zapisuje liczby paczek – wtedy z liczby wierszy
  const rows = [];
  for (let i = chunks - 1; i >= 0 && i >= chunks - chunksBack; i--) {
    const d = await sdk.getDoc(sdk.doc(db, 'mp_rows', `${key}_${pad3(i)}`));
    if (!d.exists()) continue;
    for (const [row, json] of Object.entries((d.data() || {}).r || {})) { let v = {}; try { v = JSON.parse(json); } catch { v = {}; } rows.push({ row: Number(row), v }); }
  }
  return rows;
}
/** Wszystkie wiersze zakładki [key] (np. Lista detali – do procentu wykonania). */
async function mpAll(key) { return mpTail(key, 1e6); }

/** Ostatnie wpisy rejestru płytek ZP (reg_zp, dwie ostatnie paczki): [{ row, v }] w kształcie rejestru. */
export async function zpTail() {
  const { sdk, db } = await firebase();
  const m = await sdk.getDoc(sdk.doc(db, 'reg_meta', 'zp'));
  const next = m.exists() ? Number((m.data() || {}).next) || 0 : 0;
  if (next <= 1) return [];
  const last = Math.floor((next - 1) / CHUNK), rows = [];
  for (let c = last; c >= 0 && c >= last - 1; c--) {
    const d = await sdk.getDoc(sdk.doc(db, 'reg_zp', `c${pad3(c)}`));
    if (!d.exists()) continue;
    for (const [n, json] of Object.entries((d.data() || {}).r || {})) { try { rows.push({ row: Number(n), v: JSON.parse(json) }); } catch { /* uszkodzony wpis */ } }
  }
  return rows;
}

/** Odświeża w dokumencie wf_meta/feed rejestry [sources] (domyślnie wszystkie): czyta ich ogony z tabel i zapisuje po 3 najnowsze zdarzenia. Zwraca zapisane zdarzenia { klucz: [zdarzenia] }. */
export async function refreshFeed(sources = FEED_SOURCES, by = '') {
  const { sdk, db } = await firebase();
  const out = {};
  const ctx = {};
  if (sources.includes('dreg')) ctx.dlist = await mpAll('dlist');   // procent wykonania detalu z Listy detali (szt zrobione / szt x kpl)
  for (const key of sources) out[key] = topEvents(key, key === 'plates' ? await zpTail() : await mpTail(key), ctx, FEED_PER);
  await sdk.setDoc(sdk.doc(db, 'wf_meta', 'feed'), { updated: Date.now(), by: String(by || ''), src: out }, { merge: true });
  return out;
}
/** Nasłuch dokumentu zdarzeń na żywo: [cb]({ updated, src }) – bez dokumentu src puste. Zwraca funkcję zatrzymującą nasłuch. */
export async function watchFeed(cb, onError = () => {}) {
  const { sdk, db } = await firebase();
  return sdk.onSnapshot(sdk.doc(db, 'wf_meta', 'feed'), (snap) => { const d = snap.exists() ? snap.data() : {}; cb({ updated: Number(d.updated) || 0, src: d.src || {} }); }, onError);
}

let touchTimer = null, touchSources = new Set();
/** Po własnym zdarzeniu (zapis skanera): odświeża zdarzenia po chwili (łączy kilka zapisów w jedno odświeżenie); błędy (brak uprawnień, brak sieci) są ciche – odświeży ktoś inny albo co godzinę. */
export function feedTouch(sources = FEED_SOURCES, by = '') {
  for (const s of sources) touchSources.add(s);
  clearTimeout(touchTimer);
  touchTimer = setTimeout(() => { const list = [...touchSources]; touchSources = new Set(); refreshFeed(list, by).catch(() => {}); }, 4000);
}
export { feedStale };
