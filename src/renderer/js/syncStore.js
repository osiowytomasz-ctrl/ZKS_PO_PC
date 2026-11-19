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
export function grafikQueueItems(changes, rows, ts = Date.now()) {
  const items = {};
  for (const ch of changes) {
    if (!rows || !rows[ch.pid]) continue;
    const it = { row: rows[ch.pid], iso: ch.iso, ts };
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
export async function sendQueue(name) {
  const { sdk, db } = await firebase();
  const snap = await sdk.getDoc(ref(sdk, db, name));
  const items = (snap.exists() && snap.data().items) || {};
  const keys = Object.keys(items);
  if (!keys.length) return { sent: 0, rest: 0 };
  const list = keys.map((k) => items[k]);
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    if (name === 'grafik') await api('grafikWriteBack', [part.map(({ row, iso, value, note }) => ({ row, iso, ...(value !== undefined ? { value } : {}), ...(note !== undefined ? { note } : {}) }))], { timeoutMs: 180000 });
    else await api('savePlanData', [part.map(({ row, col, value }) => ({ row, col, value }))], { timeoutMs: 180000 });
  }
  // usunięcie wysłanych – tylko pozycji bez nowszej zmiany (ts bez zmian)
  let rest = 0;
  await sdk.runTransaction(db, async (tx) => {
    const cur = await tx.get(ref(sdk, db, name));
    const now = { ...((cur.exists() && cur.data().items) || {}) };
    for (const k of keys) if (now[k] && now[k].ts === items[k].ts) delete now[k];
    rest = Object.keys(now).length;
    tx.set(ref(sdk, db, name), { items: now, updatedAt: Date.now(), sentAt: Date.now() });
  });
  return { sent: keys.length, rest };
}

/**
 * Przycisk „Do arkusza (n)” (MASTER, GOD): świeci na pomarańczowo, gdy w kolejce są zmiany; kliknięcie – wysłanie do arkusza.
 * [h] – fabryka elementów, [toast], [confirmBox] z ui.js; [label] – nazwa karty w arkuszu (G, PLAN). Zwraca element przycisku.
 */
export function syncButton(name, label, { h, toast, confirmBox }) {
  const b = h('button', { class: 'btn small', title: `Zmiany zapisane w bazie czekają na wysłanie do karty ${label} arkusza Google` }, 'Do arkusza');
  let n = 0, stop = null, busy = false;
  const paint = () => {
    b.textContent = busy ? 'Wysyłanie…' : `Do arkusza${n ? ` (${n})` : ''}`;
    b.disabled = busy || !n;
    Object.assign(b.style, n && !busy ? { background: '#ff9800', color: '#000', borderColor: '#e65100', fontWeight: 700, boxShadow: '0 0 6px #ff9800' } : { background: '', color: '', borderColor: '', fontWeight: '', boxShadow: '' });
  };
  b.onclick = async () => {
    if (!n || busy) return;
    if (!(await confirmBox('Wysyłka do arkusza', `Wysłać ${n} zmienionych komórek do karty ${label} arkusza Google?`, 'Wyślij'))) return;
    busy = true; paint();
    try { const r = await sendQueue(name); toast(`Wysłano do karty ${label}: ${r.sent}` + (r.rest ? ` (nowe zmiany w kolejce: ${r.rest})` : '')); }
    catch (e) { toast('Nie wysłano: ' + (e.message || e), true); }
    busy = false; paint();
  };
  watchQueue(name, (x) => { n = x; paint(); if (!b.isConnected && stop) { stop(); } }).then((s) => { stop = s; });
  paint();
  return b;
}
