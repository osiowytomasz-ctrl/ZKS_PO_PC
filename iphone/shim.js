// Odpowiednik `window.zks` (Electron: preload.cjs + apiCore.cjs + apiLink.cjs) dla przeglądarki – wersja na iPhone'a.
// Ten sam kod widoków (Skaner, status i komunikator) działa tu bez zmian: zapytania do Apps Script idą przez fetch (klucz w treści żądania),
// adres API pochodzi z bazy Firebase (app_config/api, odczyt publiczny) i jest przyjmowany jak w programie PC i na Androidzie.

export const PROJECT = 'harmonohram-zks';
const WEB_API_KEY = 'AIzaSyDavZoJom1HP2JFWF90XDzk8K3tnl11RdY';   // publiczna konfiguracja Firebase Web (jak w js/fb.js)
const LINK_RE = /^https:\/\/script\.google\.com\/(?:macros\/s|a\/macros\/[A-Za-z0-9._-]+\/s|a\/[A-Za-z0-9._-]+\/macros\/s)\/[A-Za-z0-9_-]{20,}\/exec$/;
const FRIENDLY = { NO_KEY: 'Nieprawidłowy lub nieaktywny klucz.', BAD_KEY: 'Nieprawidłowy lub nieaktywny klucz.', FORBIDDEN: 'Brak uprawnień do tej funkcji.' };

export const normalizeLink = (t) => String(t == null ? '' : t).trim().split('#')[0].split('?')[0].replace(/\/+$/, '');
export function checkLink(text) {
  const url = normalizeLink(text);
  if (!url) return { ok: false, error: 'Wpisz adres API.' };
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Adres musi zaczynać się od https://' };
  if (!LINK_RE.test(url)) return { ok: false, error: 'To nie wygląda na adres wdrożenia Apps Script (…/exec).' };
  return { ok: true, url };
}
/** Czy przyjąć adres z bazy: poprawny, inny niż lokalny i nowszy niż ostatnio przyjęty (albo brak lokalnie); force – po błędzie połączenia. */
export function shouldAdopt(remote, local, force = false) {
  if (!remote || !checkLink(remote.url).ok) return false;
  const url = normalizeLink(remote.url);
  if (url === normalizeLink(local.url)) return false;
  return force || !normalizeLink(local.url) || remote.ver > (Number(local.linkVer) || 0);
}
export function parseRemote(json) {
  const f = json && json.fields;
  if (!f || !f.url || typeof f.url.stringValue !== 'string') return null;
  const num = (x) => (x ? Number(x.integerValue !== undefined ? x.integerValue : x.doubleValue) || 0 : 0);
  return { url: f.url.stringValue, ver: num(f.ver), updatedAt: num(f.updatedAt), updatedBy: (f.updatedBy && f.updatedBy.stringValue) || '' };
}

/**
 * Tworzy obiekt `zks`: [storage] – localStorage (albo atrapa), [fetchImpl] – fetch, [version] – numer wersji aplikacji.
 * Klucz użytkownika zostaje w pamięci tej przeglądarki (iPhone nie daje stronom WWW bezpiecznego magazynu jak Keychain).
 */
export function createZks({ storage, fetchImpl = (...a) => fetch(...a), version = 'dev' } = {}) {
  const get = (k, d = '') => { try { const v = storage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const set = (k, v) => { try { storage.setItem(k, String(v)); } catch { /* pamięć niedostępna (tryb prywatny) */ } };
  const load = () => ({ url: get('zks.ios.url'), key: get('zks.ios.key'), linkVer: Number(get('zks.ios.linkver', '0')) || 0 });
  const save = (cfg) => {
    set('zks.ios.url', String(cfg.url || '').trim()); set('zks.ios.key', String(cfg.key || '').trim());
    if (cfg.linkVer !== undefined) set('zks.ios.linkver', Number(cfg.linkVer) || 0);
    return true;
  };
  let lastRelink = 0;

  async function fetchRemoteLink(timeoutMs = 8000) {
    try {
      const r = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/app_config/api?key=${WEB_API_KEY}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 404) return { ok: true, link: null };
      if (!r.ok) return { ok: false };
      return { ok: true, link: parseRemote(await r.json()) };
    } catch { return { ok: false }; }
  }
  async function syncLink(force = false) {
    const r = await fetchRemoteLink();
    if (!r.ok) return { ok: false, changed: false };
    const cur = load();
    if (r.link && shouldAdopt(r.link, cur, force)) { save({ url: normalizeLink(r.link.url), key: cur.key, linkVer: r.link.ver }); return { ok: true, changed: true, link: r.link }; }
    if (r.link && normalizeLink(r.link.url) === normalizeLink(cur.url) && r.link.ver !== cur.linkVer) save({ url: cur.url, key: cur.key, linkVer: r.link.ver });
    return { ok: true, changed: false, link: r.link };
  }

  /** Jedno wywołanie API: { ok, data, user } albo { ok:false, code, error } (kody jak w apiCore.cjs). */
  async function callOnce(fn, args, opts) {
    const { url, key } = load();
    if (!url.trim() || !key.trim()) return { ok: false, code: 'NOT_CONFIGURED', error: 'Wpisz klucz użytkownika w ustawieniach.' };
    let text;
    try {
      const response = await fetchImpl(url.trim(), {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // „prosty” nagłówek – bez zapytania wstępnego CORS
        body: JSON.stringify({ key: key.trim(), fn, args: args || [] }), redirect: 'follow', credentials: 'omit',
        signal: AbortSignal.timeout(opts.timeoutMs || 90000),
      });
      if (!response.ok) return { ok: false, code: 'HTTP_' + response.status, error: 'Serwer zwrócił błąd ' + response.status + '.' };
      text = await response.text();
    } catch { return { ok: false, code: 'NETWORK', error: 'Brak połączenia z serwerem.' }; }
    let envelope;
    try { envelope = JSON.parse(text); if (envelope === null || typeof envelope !== 'object') throw new Error('shape'); }
    catch { return { ok: false, code: 'BAD_RESPONSE', error: 'Serwer nie zwrócił danych API. Sprawdź adres i ustawienia wdrożenia.' }; }
    if (!envelope.ok) { const code = envelope.code || 'ERROR'; return { ok: false, code, error: FRIENDLY[code] || (envelope.error && String(envelope.error).trim()) || 'Błąd serwera.' }; }
    return { ok: true, data: envelope.data === undefined ? null : envelope.data, user: envelope.user || null };
  }

  return {
    getSettings: async () => load(),
    saveSettings: async (cfg) => save(cfg || {}),
    async call(fn, args = [], opts = {}) {
      let r = await callOnce(fn, args, opts);
      // samonaprawa: po błędzie połączenia / odpowiedzi nie-API sprawdzamy bazę (najwyżej raz na 2 minuty) i ponawiamy z nowym adresem
      if (!r.ok && /^(NETWORK|BAD_URL|BAD_RESPONSE|HTTP_)/.test(r.code || '') && Date.now() - lastRelink >= 120000) {
        lastRelink = Date.now();
        if ((await syncLink(true)).changed) r = await callOnce(fn, args, opts);
      }
      return r;
    },
    syncLink: (force) => syncLink(!!force),
    remoteLink: () => fetchRemoteLink(),
    checkLink: async (t) => checkLink(t),
    cacheGet: async () => null,          // bez pamięci podręcznej odpowiedzi – zawsze świeże dane
    cacheClear: async () => true,
    appVersion: async () => version,
    copyText: async (t) => { try { await navigator.clipboard.writeText(String(t || '')); } catch { /* brak uprawnień schowka */ } return true; },
    openExternal: async (u) => { window.open(u, '_blank', 'noopener'); return true; },
  };
}
