// Komunikator w oknie statusu: rozmowy ogólna i prywatne, przechowywane najwyżej 3 dni (starsze wiadomości są niewidoczne i usuwane).
// Firestore: chat/{rozmowa}__{rrrr-mm-dd} = { t: początek dnia (ms), m: { klucz: { u: uid, n: imię i nazwisko, x: tekst, ts } } }; chat_inbox/{uid} = { uid nadawcy: { n, ts, x } } (powiadomienia o rozmowach prywatnych).
// Czyste funkcje – testy: test/chat.test.js.
import { dayKey } from './presence.js';

/** Czas przechowywania rozmów. */
export const RETENTION_DAYS = 3;
export const RETENTION_MS = RETENTION_DAYS * 86400000;
export const MAX_TEXT = 500;
export const GENERAL = 'all';

/** Identyfikator rozmowy prywatnej dwóch osób – ten sam dla obu (uid w porządku alfabetycznym). */
export const dmId = (a, b) => 'dm_' + [String(a), String(b)].sort().join('_');
/** Dokument jednego dnia rozmowy. */
export const docId = (conv, day) => `${conv}__${day}`;
/** Początek dnia „rrrr-mm-dd” (czas lokalny) w ms. */
export const dayStart = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
/** Dni rozmowy do wczytania (dziś i dwa poprzednie: wiadomość sprzed ≤ 3 dób może leżeć w dokumencie najstarszego dnia). */
export const readDays = (now = Date.now()) => { const out = []; for (let i = 0; i <= RETENTION_DAYS; i++) out.push(dayKey(now - i * 86400000)); return out; };
/** Dni, których dokumenty można już usunąć (starsze niż okres przechowywania): [od, do] dni wstecz. */
export const expiredDays = (now = Date.now(), from = RETENTION_DAYS + 1, to = RETENTION_DAYS + 7) => { const out = []; for (let i = from; i <= to; i++) out.push(dayKey(now - i * 86400000)); return out; };

/** Wiadomość do zapisu: { key, msg } albo null (pusty tekst). Tekst przycięty do MAX_TEXT. */
export function makeMessage(uid, name, text, now = Date.now()) {
  const x = String(text ?? '').trim().slice(0, MAX_TEXT);
  if (!x) return null;
  return { key: `${String(now).padStart(13, '0')}_${String(uid).slice(0, 8)}_${Math.floor(Math.random() * 1e4)}`, msg: { u: String(uid), n: String(name ?? '').trim(), x, ts: now } };
}
/** Wiadomości z dokumentów dni ({ dzień: { m: { klucz: wiadomość } } }) – tylko z ostatnich 3 dni, od najstarszej. */
export function mergeMessages(dayDocs, now = Date.now()) {
  const out = [];
  for (const d of Object.values(dayDocs || {})) for (const m of Object.values((d && d.m) || {})) if (m && Number(m.ts) > now - RETENTION_MS) out.push(m);
  return out.sort((a, b) => Number(a.ts) - Number(b.ts));
}
/** Liczba nieprzeczytanych (cudzych wiadomości nowszych niż [lastRead]). */
export const unreadCount = (msgs, myUid, lastRead = 0) => (msgs || []).filter((m) => m.u !== myUid && Number(m.ts) > Number(lastRead || 0)).length;
/** „Dzisiaj”, „Wczoraj” albo „22.11” – nagłówek dnia w oknie rozmowy. */
export function dayLabel(ts, now = Date.now()) {
  const k = dayKey(ts);
  if (k === dayKey(now)) return 'Dzisiaj';
  if (k === dayKey(now - 86400000)) return 'Wczoraj';
  const [, m, d] = k.split('-'); return `${d}.${m}`;
}
