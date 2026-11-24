// Adres API w bazie Firebase (app_config/api) – zapisuje go tylko administrator (GOD) z programu PC; patrz src/main/apiLink.cjs.
// app_config/api = { url, ver, updatedAt, updatedBy } (bieżący), app_config_history/{ver} = { url, ver, ts, by, prev } (historia, bez nadpisywania).
import { firebase } from './fb.js';

/**
 * Zapisuje adres w bazie, jeśli różni się od bieżącego (bez duplikatów: ten sam adres nie tworzy nowej wersji ani wpisu historii).
 * Zwraca { changed, ver }. Wymaga logowania do Firebase (reguły: tylko GOD).
 */
export async function publishLink(url, by) {
  const { sdk, db } = await firebase({ fresh: true });
  const ref = sdk.doc(db, 'app_config', 'api');
  return sdk.runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    const old = cur.exists() ? cur.data() : null;
    if (old && old.url === url) return { changed: false, ver: Number(old.ver) || 0 };
    const ver = (old ? Number(old.ver) || 0 : 0) + 1;
    const now = Date.now();
    tx.set(ref, { url, ver, updatedAt: now, updatedBy: by || '' });
    tx.set(sdk.doc(db, 'app_config_history', String(ver).padStart(5, '0')), { url, ver, ts: now, by: by || '', prev: old ? old.url : '' });
    return { changed: true, ver };
  });
}

/** Ostatnie wpisy historii adresów (najnowsze pierwsze). */
export async function readLinkHistory(n = 10) {
  const { sdk, db } = await firebase();
  const snap = await sdk.getDocs(sdk.query(sdk.collection(db, 'app_config_history'), sdk.orderBy('ver', 'desc'), sdk.limit(n)));
  return snap.docs.map((d) => d.data());
}

/**
 * Przy starcie programu administratora (GOD): jeśli lokalny, poprawny adres różni się od zapisanego w bazie – zapisuje go.
 * Zwraca wynik publishLink albo null (nic do zrobienia / adres niepoprawny / brak połączenia).
 */
export async function publishIfDiffers(url, by) {
  try {
    const c = await window.zks.checkLink(url);
    if (!c.ok) return null;
    const r = await publishLink(c.url, by);
    await window.zks.syncLink(false);   // zapamiętuje numer wersji adresu po stronie programu
    return r;
  } catch (e) { console.warn('publishLink', e); return null; }
}
