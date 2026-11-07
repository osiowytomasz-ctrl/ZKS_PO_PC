'use strict';
// Klient API Apps Script (odpowiednik ApiClient.kt). Czysta funkcja z wstrzykiwanym fetch, żeby dało się ją testować.

const FRIENDLY = {
  NO_KEY: 'Nieprawidłowy lub nieaktywny klucz.',
  BAD_KEY: 'Nieprawidłowy lub nieaktywny klucz.',
  FORBIDDEN: 'Brak uprawnień do tej funkcji.',
};

/**
 * Wywołuje funkcję backendu. Zwraca {ok:true,data,user} albo {ok:false,code,error}.
 * Kody lokalne: NOT_CONFIGURED, BAD_URL, NETWORK, HTTP_xxx, BAD_RESPONSE.
 * Klucz idzie w ciele żądania, nigdy w adresie URL.
 */
async function callApi(config, fn, args, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || 90000;
  const url = (config && config.url || '').trim();
  const key = (config && config.key || '').trim();
  if (!url || !key) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'Ustaw adres API i klucz w ustawieniach.' };
  }
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('proto');
  } catch (e) {
    return { ok: false, code: 'BAD_URL', error: 'Nieprawidłowy adres API.' };
  }
  const body = JSON.stringify({ key, fn, args: args || [] });
  let text;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, code: 'HTTP_' + response.status, error: 'Serwer zwrócił błąd ' + response.status + '.' };
    }
    text = await response.text();
  } catch (e) {
    return { ok: false, code: 'NETWORK', error: 'Brak połączenia z serwerem.' };
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
    if (envelope === null || typeof envelope !== 'object') throw new Error('shape');
  } catch (e) {
    return {
      ok: false,
      code: 'BAD_RESPONSE',
      error: 'Serwer nie zwrócił danych API. Sprawdź adres i ustawienia wdrożenia.',
    };
  }
  if (!envelope.ok) {
    const code = envelope.code || 'ERROR';
    const msg = FRIENDLY[code] || (envelope.error && String(envelope.error).trim()) || 'Błąd serwera.';
    return { ok: false, code, error: msg };
  }
  return { ok: true, data: envelope.data === undefined ? null : envelope.data, user: envelope.user || null };
}

module.exports = { callApi };
