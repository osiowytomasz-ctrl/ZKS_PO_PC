// Wysyłka Grafiku i Planu do arkusza Google – tylko na żądanie (bez automatycznej kopii przy każdej zmianie).
// Każda zmiana zapisana w bazie trafia do kolejki w Firebase (wspólnej dla wszystkich urządzeń):
//  - sync/grafik: { items: { "<osoba>~<dzień>": { row, iso, value?, note?, ts } }, updatedAt }
//  - sync/plan:   { items: { "<wiersz>~<kolumna>": { row, col, value, ts } }, updatedAt }
// Kolejka trzyma ostatnią wartość każdej komórki; przycisk „Do arkusza (n)” (MASTER, GOD) wysyła ją przez API
// (grafikWriteBack / savePlanData) i usuwa z kolejki tylko pozycje, które w międzyczasie się nie zmieniły.
import { firebase } from './fb.js';
import { api } from './ui.js';

const enc = (s) => encodeURIComponent(String(s)).replace(/\./g, '%2E');
const ref = (sdk, db, name) => sdk.doc(db, 'sync', name);

/** Pozycje kolejki Grafiku dla zmian ([{pid, iso, code?, note?}], [rows] – osoba → wiersz karty G). */
export function grafikQueueItems(changes, rows, ts = Date.now(), names = {}) {
  const items = {};
  for (const ch of changes) {
    if (!rows || !rows[ch.pid]) continue;
    const it = { row: rows[ch.pid], iso: ch.iso, ts };
    if (names && names[ch.pid]) it.name = names[ch.pid];   // serwer sprawdza, czy w tym wierszu karty G jest ta osoba
    if (ch.code !== undefined) it.value = ch.code;
    if (ch.note !== undefined) it.note = ch.note;
    items[enc(ch.pid) + '~' + ch.iso] = it;
  }
  return items;
}
/** Pozycje kolejki Planu ([{row, col, value}]). */
export function planQueueItems(list, ts = Date.now()) {
  return Object.fromEntries(list.map((x) => [`${x.row}~${x.col}`, { row: x.row, col: x.col, value: x.value ?? '', ts }]));
}

/** Dopisanie do kolejki w tym samym zapisie wsadowym co zmiana w bazie ([b] – writeBatch). */
export function queueInBatch(sdk, db, b, name, items) {
  if (Object.keys(items).length) b.set(ref(sdk, db, name), { items, updatedAt: Date.now() }, { merge: true });
}

/** Nasłuch liczby pozycji w kolejce: cb(n). Zwraca funkcję zatrzymania. */
export async function watchQueue(name, cb) {
  const { sdk, db } = await firebase();
  return sdk.onSnapshot(ref(sdk, db, name), (s) => cb(Object.keys((s.exists() && s.data().items) || {}).length), () => cb(0));
}

/** Wysłanie kolejki do arkusza; wynik: { sent, rest } (rest – zmiany dopisane w trakcie wysyłki). */
const WHY = { nodate: 'brak kolumny daty w karcie G', norow: 'brak wiersza w karcie G', name: 'nie znaleziono tej osoby (po nazwisku) w karcie G', dup: 'w karcie G jest kilka osób o tym nazwisku', noset: 'komórka nie przyjęła wartości (formuła, ochrona lub format)', old: 'Apps Script ma starą wersję Api.gs – wklej nowy i wdróż „Nowa wersja”' };
/**
 * Wynik wysyłki Grafiku: [results] z serwera (po jednym na pozycję: 'ok' | 'nodate' | 'norow' | 'name'; brak tablicy = stara wersja serwera: nic nie uznajemy za zapisane).
 * Zwraca { ok: [klucze zapisane], failed: [{ key, why }] } – z kolejki wolno usunąć tylko zapisane.
 */
export function splitResults(keys, results) {
  const ok = [], failed = [];
  keys.forEach((k, i) => {
    const r = Array.isArray(results) ? results[i] : 'old';
    if (r === 'ok' || r === undefined) ok.push(k); else failed.push({ key: k, why: WHY[r] || String(r) });
  });
  return { ok, failed };
}

const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** Zakres wysyłki Grafiku: tydzień wstecz i tydzień w przód względem [today] (włącznie – 15 dni, rrrr-mm-dd). */
export function grafikRange(today = new Date()) {
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7), b = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  const days = [];
  for (let d = a; d <= b; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(isoOf(d));
  return { from: days[0], to: days[days.length - 1], days };
}
/**
 * Pozycje „cały zakres”: dla każdej osoby z wierszem karty G i każdego dnia zakresu – kod i komentarz z bazy (pusty = wyczyszczenie komórki).
 * [people] z gr_meta, [months] – {rrrr-mm: {c, n}}.
 */
export function grafikRangeItems(people, months, days, ts = Date.now()) {
  const items = {};
  for (const p of people || []) {
    if (!p || p.sep || !p.row) continue;
    for (const iso of days) {
      const doc = months[iso.slice(0, 7)] || {}, dd = iso.slice(8, 10);
      const code = (doc.c && doc.c[p.id] && doc.c[p.id][dd]) || '', note = (doc.n && doc.n[p.id] && doc.n[p.id][dd]) || '';
      items[enc(p.id) + '~' + iso] = { row: p.row, iso, name: p.name, value: String(code), note: String(note), ts };
    }
  }
  return items;
}
/** Pobranie z bazy (z serwera) danych zakresu Grafiku i zbudowanie pozycji „cały zakres”. */
export async function grafikRangeFromDb(today = new Date()) {
  const { sdk, db } = await firebase();
  const get = (r) => (sdk.getDocFromServer ? sdk.getDocFromServer(r) : sdk.getDoc(r));
  const rg = grafikRange(today);
  const meta = await get(sdk.doc(db, 'gr_meta', 'main'));
  const months = {};
  for (const mk of new Set(rg.days.map((d) => d.slice(0, 7)))) { const s = await get(sdk.doc(db, 'gr_days', mk)); months[mk] = s.exists() ? s.data() : {}; }
  return { ...rg, items: grafikRangeItems((meta.exists() && meta.data().people) || [], months, rg.days) };
}

/**
 * Wysyłka kolejki [name] do arkusza. Dla Grafiku [extra] – dodatkowe pozycje (cały zakres dni z bazy), które zastępują kolejkę dla tych samych
 * komórek; z kolejki znikają tylko zapisane pozycje o niezmienionym ts (reszta zostaje z powodem w [failed]).
 */
export async function sendQueue(name, extra = {}) {
  const { sdk, db } = await firebase();
  const snap = await sdk.getDoc(ref(sdk, db, name));
  const items = (snap.exists() && snap.data().items) || {};
  const all = { ...items, ...extra };
  const keys = Object.keys(all);
  if (!keys.length) return { sent: 0, rest: 0, failed: [] };
  const list = keys.map((k) => all[k]);
  const results = [];
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    if (name === 'grafik') {
      const r = await api('grafikWriteBack', [part.map(({ row, iso, value, note, name: who }) => ({ row, iso, ...(who ? { name: who } : {}), ...(value !== undefined ? { value } : {}), ...(note !== undefined ? { note } : {}) }))], { timeoutMs: 180000 });
      if (r && Array.isArray(r.results)) results.push(...r.results); else results.push(...part.map(() => 'old'));   // serwer bez wyników na pozycję = stara wersja Api.gs
    } else {
      await api('savePlanData', [part.map(({ row, col, value }) => ({ row, col, value }))], { timeoutMs: 180000 });
      results.push(...part.map(() => 'ok'));
    }
  }
  const { ok, failed } = splitResults(keys, results);
  let rest = 0;
  // usunięcie wysłanych – tylko pozycji bez nowszej zmiany (ts bez zmian)
  await sdk.runTransaction(db, async (tx) => {
    const cur = await tx.get(ref(sdk, db, name));
    const now = { ...((cur.exists() && cur.data().items) || {}) };
    for (const k of ok) if (items[k] && now[k] && now[k].ts === items[k].ts) delete now[k];
    rest = Object.keys(now).length;
    tx.set(ref(sdk, db, name), { items: now, updatedAt: Date.now(), sentAt: Date.now() });
  });
  return { sent: ok.length, rest, failed };
}

/**
 * Przycisk „Do arkusza (n)” (MASTER, GOD): świeci na pomarańczowo, gdy w kolejce są zmiany; kliknięcie – wysłanie do arkusza.
 * [h] – fabryka elementów, [toast], [confirmBox] z ui.js; [label] – nazwa karty w arkuszu (G, PLAN). Zwraca element przycisku.
 */
export function syncButton(name, label, { h, toast, confirmBox }, { range = false } = {}) {
  const b = h('button', { class: 'btn small', title: range ? `Zastępuje w karcie ${label} arkusza Google dni od tygodnia wstecz do tygodnia w przód danymi z bazy (oraz wysyła zmiany z kolejki)` : `Zmiany zapisane w bazie czekają na wysłanie do karty ${label} arkusza Google` }, 'Do arkusza');
  let n = 0, stop = null, busy = false;
  const paint = () => {
    b.textContent = busy ? 'Wysyłanie…' : `Do arkusza${n ? ` (${n})` : ''}`;
    b.disabled = busy || (!n && !range);
    Object.assign(b.style, n && !busy ? { background: '#ff9800', color: '#000', borderColor: '#e65100', fontWeight: 700, boxShadow: '0 0 6px #ff9800' } : { background: '', color: '', borderColor: '', fontWeight: '', boxShadow: '' });
  };
  b.onclick = async () => {
    if ((!n && !range) || busy) return;
    const rg = range ? grafikRange() : null;
    const ask = range ? `Zastąpić w karcie ${label} arkusza Google dni ${rg.from} – ${rg.to} (tydzień wstecz i w przód) danymi z bazy?` + (n ? ` Dodatkowo zostanie wysłane ${n} zmian z kolejki.` : '') : `Wysłać ${n} zmienionych komórek do karty ${label} arkusza Google?`;
    if (!(await confirmBox('Wysyłka do arkusza', ask, 'Wyślij'))) return;
    busy = true; paint();
    try {
      const r = await sendQueue(name, range ? (await grafikRangeFromDb()).items : {});
      const bad = r.failed || [];
      if (bad.length) toast(`Karta ${label}: zapisano ${r.sent}, NIE zapisano ${bad.length} – ${[...new Set(bad.map((x) => x.why))].join('; ')}. Pozycje zostały w kolejce.`, true);
      else toast(`Wysłano do karty ${label}: ${r.sent}` + (r.rest ? ` (nowe zmiany w kolejce: ${r.rest})` : ''));
    }
    catch (e) { toast('Nie wysłano: ' + (e.message || e), true); }
    busy = false; paint();
  };
  watchQueue(name, (x) => { n = x; paint(); if (!b.isConnected && stop) { stop(); } }).then((s) => { stop = s; });
  paint();
  return b;
}
