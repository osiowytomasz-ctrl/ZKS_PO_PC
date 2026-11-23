// Status i dostępność pracowników (prawy dolny róg programu): stany, uprawnienie do historii, klucze dzienników i sortowanie.
// Dane w Firestore: presence/{uid} – bieżący stan każdego pracownika; presence_log/{rrrr-mm-dd} – dziennik zmian dnia ({ e: { klucz: wpis } }).
// Historię (dziennik) widzą tylko osoby z listy HISTORY_USERS (te same nazwy pilnują reguły Firestore), pozostali – tylko stan bieżący.
// Czyste funkcje – testy: test/presence.test.js.

/** Statusy do wyboru: id, etykieta, kolor kropki, czy oznacza dostępność. */
export const STATUSES = [
  { id: 'available', label: 'Dostępny', color: '#2e7d32', free: true },
  { id: 'machine', label: 'Przy maszynie', color: '#f9a825', free: false },
  { id: 'busy', label: 'Zajęty', color: '#c62828', free: false },
  { id: 'meeting', label: 'Spotkanie / narada', color: '#6a1b9a', free: false },
  { id: 'break', label: 'Przerwa', color: '#1565c0', free: false },
  { id: 'away', label: 'Nieobecny', color: '#757575', free: false },
];
const BY_ID = new Map(STATUSES.map((s) => [s.id, s]));
export const statusOf = (id) => BY_ID.get(id) || { id: '', label: 'Brak statusu', color: '#bdbdbd', free: false };

/** Osoby, które widzą historię zmian statusu (pozostali – tylko stan bieżący). */
export const HISTORY_USERS = ['Osiowy Tomasz', 'Kumała Łukasz', 'Skupnik Adam'];
/** Osoby, które przy nazwisku widzą wersję oprogramowania i rodzaj urządzenia (PC / Android). */
export const DEVICE_USERS = ['Osiowy Tomasz'];
/** Czas (ms), po którym urządzenie uznajemy za dawno nieużywane (brak zgłoszenia od 7 dni). */
export const DEVICE_STALE_MS = 7 * 86400000;
/** Zgłoszenie urządzenia do zapisu: { name, email, platform: 'pc' | 'android', ver, seenAt }; nieznana platforma – null. */
export function makeDevice(user, platform, ver, now = Date.now()) {
  if (!['pc', 'android'].includes(platform)) return null;
  return { name: String((user && (user.name || user.email)) || '').trim(), email: String((user && user.email) || '').trim(), platform, ver: String(ver ?? '').trim(), seenAt: now };
}
/** Urządzenia osoby o uid [uid] z dokumentów presence_dev (id = „{uid}_{platforma}”): [{ platform, ver, seenAt, stale }] – PC przed Androidem. */
export function devicesFor(uid, devMap, now = Date.now()) {
  const out = [];
  for (const [id, d] of devMap instanceof Map ? devMap.entries() : Object.entries(devMap || {})) {
    if (!id.startsWith(String(uid) + '_') || !d) continue;
    out.push({ platform: d.platform, ver: String(d.ver ?? ''), seenAt: Number(d.seenAt) || 0, stale: now - (Number(d.seenAt) || 0) > DEVICE_STALE_MS });
  }
  return out.sort((a, b) => (a.platform === b.platform ? 0 : a.platform === 'pc' ? -1 : 1));
}
/** Nazwa bez wielkości liter, spacji na brzegach i polskich znaków – „Kumala Łukasz” = „Kumała Łukasz”. */
export const normName = (s) => String(s ?? '').trim().toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const HISTORY_SET = new Set(HISTORY_USERS.map(normName));
export const canSeeHistory = (name) => HISTORY_SET.has(normName(name));
const DEVICE_SET = new Set(DEVICE_USERS.map(normName));
export const canSeeDevices = (name) => DEVICE_SET.has(normName(name));

/** Czas (ms), po którym status uznajemy za nieaktualny (brak zmiany od 12 godzin). */
export const STALE_MS = 12 * 3600 * 1000;
export const isStale = (p, now = Date.now()) => !p || !p.updatedAt || now - Number(p.updatedAt) > STALE_MS;

const pad = (n) => String(n).padStart(2, '0');
/** Dzień dziennika: „rrrr-mm-dd” (czas lokalny). */
export const dayKey = (ts) => { const d = new Date(Number(ts)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Lista dni dziennika od [now] wstecz: [dni] kluczy (najnowszy pierwszy). */
export function lastDays(now, days) {
  const out = [], d = new Date(now); d.setHours(12, 0, 0, 0);
  for (let i = 0; i < Math.max(1, days); i++) { out.push(dayKey(d.getTime() - i * 86400000)); }
  return out;
}
/** „14:05” (dziś) albo „22.11 14:05”. */
export function timeText(ts, now = Date.now()) {
  const d = new Date(Number(ts)), hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return dayKey(ts) === dayKey(now) ? hm : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hm}`;
}
/** Godzina „do” (HH:MM) albo ''; niepoprawny zapis – ''. */
export const untilText = (v) => { const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(v ?? '')); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${pad(Number(m[1]))}:${m[2]}` : ''; };

/** Stan do zapisu: { name, email, status, note, until, updatedAt }; nieznany status – 'available' nie jest zgadywany (zwraca null). */
export function makeState(user, { status, note = '', until = '' }, now = Date.now()) {
  if (!BY_ID.has(status)) return null;
  return { name: String((user && user.name) || (user && user.email) || '').trim(), email: String((user && user.email) || '').trim(), status, note: String(note ?? '').trim().slice(0, 140), until: untilText(until), updatedAt: now };
}
/** Wpis dziennika zmiany statusu: stan + poprzedni status; klucz unikalny (czas + uid). */
export function makeLogEntry(uid, state, prevStatus = '') {
  return { key: `${String(state.updatedAt).padStart(13, '0')}_${String(uid).slice(0, 8)}`, entry: { uid, name: state.name, email: state.email, status: state.status, prev: prevStatus || '', note: state.note, until: state.until, ts: state.updatedAt } };
}
/** Czy zmiana jest rzeczywista (inny status, notatka albo godzina „do”) – bez wpisów dziennika dla powtórnego zapisu tego samego. */
export const changed = (prev, next) => !prev || prev.status !== next.status || (prev.note || '') !== (next.note || '') || (prev.until || '') !== (next.until || '');
/** Pracownicy do listy: dostępni, potem pozostali (aktualne przed nieaktualnymi), nazwiska rosnąco. */
export function sortPresence(list, now = Date.now()) {
  const rank = (p) => (isStale(p, now) ? 2 : statusOf(p.status).free ? 0 : 1);
  return list.slice().sort((a, b) => rank(a) - rank(b) || String(a.name || '').localeCompare(String(b.name || ''), 'pl'));
}
/** Wpisy dziennika z dokumentów dni ({ dzień: { e: { klucz: wpis } } }) – najnowsze pierwsze; [name] – tylko jedna osoba (nazwa dokładnie, '' – wszyscy). */
export function logEntries(dayDocs, name = '') {
  const out = [];
  for (const d of Object.values(dayDocs || {})) for (const e of Object.values((d && d.e) || {})) if (!name || e.name === name) out.push(e);
  return out.sort((a, b) => Number(b.ts) - Number(a.ts));
}
