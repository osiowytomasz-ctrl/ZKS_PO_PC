'use strict';
// Adres API (wdrożenie Apps Script) trzymany w bazie Firebase: dokument app_config/api = { url, ver, updatedAt, updatedBy }.
// Zapisuje go tylko administrator (poziom GOD) z programu PC; wszystkie programy (PC i telefon) czytają go z bazy bez logowania
// (reguła: odczyt publiczny – adres nie jest tajny, dostępu do danych pilnuje klucz użytkownika). Klucz użytkownika zostaje lokalnie.

const PROJECT = 'harmonohram-zks';
const WEB_API_KEY = 'AIzaSyDavZoJom1HP2JFWF90XDzk8K3tnl11RdY';   // publiczna konfiguracja aplikacji Web Firebase (jak w fb.js)

/** Składnia adresu wdrożenia Apps Script: https://script.google.com/macros/s/<ID>/exec (także z domeną: /a/macros/<domena>/s/<ID>/exec lub /a/<domena>/macros/s/<ID>/exec). */
const LINK_RE = /^https:\/\/script\.google\.com\/(?:macros\/s|a\/macros\/[A-Za-z0-9._-]+\/s|a\/[A-Za-z0-9._-]+\/macros\/s)\/[A-Za-z0-9_-]{20,}\/exec$/;

/** Czyści wpisany adres (spacje, końcowy „/”, zapytanie i fragment). */
function normalizeLink(text) {
  let t = String(text == null ? '' : text).trim();
  t = t.split('#')[0].split('?')[0].replace(/\/+$/, '');
  return t;
}
/** Sprawdza składnię: { ok, url } albo { ok:false, error }. */
function checkLink(text) {
  const url = normalizeLink(text);
  if (!url) return { ok: false, error: 'Wpisz adres API.' };
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Adres musi zaczynać się od https://' };
  if (!LINK_RE.test(url)) return { ok: false, error: 'To nie wygląda na adres wdrożenia Apps Script. Ma postać https://script.google.com/macros/s/…/exec (kończy się na /exec, nie /dev).' };
  return { ok: true, url };
}

/** Dokument REST Firestore → { url, ver, updatedAt, updatedBy } albo null. */
function parseRemote(json) {
  const f = json && json.fields;
  if (!f || !f.url || typeof f.url.stringValue !== 'string') return null;
  const num = (x) => (x ? Number(x.integerValue !== undefined ? x.integerValue : x.doubleValue) || 0 : 0);
  return { url: f.url.stringValue, ver: num(f.ver), updatedAt: num(f.updatedAt), updatedBy: f.updatedBy && f.updatedBy.stringValue || '' };
}

/** Odczyt bieżącego adresu z bazy (bez logowania). Wynik: { ok:true, link: {…}|null } (null – nie ma jeszcze wpisu) albo { ok:false }. */
async function fetchRemoteLink(fetchImpl, timeoutMs = 8000) {
  try {
    const r = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/app_config/api?key=${WEB_API_KEY}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 404) return { ok: true, link: null };
    if (!r.ok) return { ok: false };
    return { ok: true, link: parseRemote(await r.json()) };
  } catch (e) { return { ok: false }; }
}

/**
 * Czy przyjąć adres z bazy: poprawny składniowo, inny niż lokalny i nowszy niż ostatnio przyjęty ([localVer]) albo brak adresu lokalnie.
 * [force] – przyjmij każdy poprawny, inny adres (po nieudanym połączeniu: lokalny adres może być stary).
 */
function shouldAdopt(remote, local, force = false) {
  if (!remote || !checkLink(remote.url).ok) return false;
  const url = normalizeLink(remote.url);
  if (url === normalizeLink(local.url)) return false;
  return force || !normalizeLink(local.url) || remote.ver > (Number(local.linkVer) || 0);
}

module.exports = { checkLink, normalizeLink, parseRemote, fetchRemoteLink, shouldAdopt, PROJECT };
