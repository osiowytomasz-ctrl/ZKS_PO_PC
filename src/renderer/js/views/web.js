import { h } from '../ui.js';
import { kartaCall } from '../pomiaryStore.js';

/** Funkcje, które strona Pomiary może wołać (jak GasCalls.allowed w aplikacji na Androida). */
export const GAS_ALLOWED = new Set([
  'karta_zapiszPomiar', 'karta_szukajPomiarow', 'karta_wczytajPomiar', 'karta_listaPomiarow',
  'karta_getCurrentUserEmail', 'karta_cacheSave', 'karta_cacheLoad',
]);

const BASE = 'zks-web://app/';

/** Moduły ze stron HTML w ramce (zks-web://). Wywołania google.script.run trafiają do głównego okna przez postMessage. */
export function mountWeb(el, ctx, mod) {
  el.style.padding = '0';
  el.style.overflow = 'hidden';
  const params = new URLSearchParams({ email: ctx.user?.email || '', name: ctx.user?.name || '' });
  const frame = h('iframe', { class: 'frame', src: BASE + mod.web + (mod.gas ? '?' + params : ''), allow: 'camera; clipboard-write' });
  el.append(frame);

  const reply = (id, ok, payload) => frame.contentWindow && frame.contentWindow.postMessage({ type: 'gas-done', id, ok, payload }, '*');

  const onMessage = async (e) => {
    if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.type === 'gas-call') {
      if (!GAS_ALLOWED.has(d.fn)) return reply(d.id, false, { message: `Funkcja „${d.fn}” nie jest dostępna w aplikacji.` });
      // Pomiary: wszystko w bazie Firebase (karta, karta_draft) – bez arkusza
      try { reply(d.id, true, await kartaCall(d.fn, Array.isArray(d.args) ? d.args : [], ctx.user && ctx.user.email)); }
      catch (err) { reply(d.id, false, { message: err.message || 'Błąd serwera.' }); }
    } else if (d.type === 'save-file') {
      window.zks.saveFile(String(d.name || 'plik'), String(d.mime || ''), String(d.base64 || ''));
    } else if (d.type === 'print-html') {
      window.zks.printHtml(String(d.html || ''));
    } else if (d.type === 'close') {
      ctx.home();
    }
  };
  window.addEventListener('message', onMessage);
  return () => { window.removeEventListener('message', onMessage); el.style.padding = ''; el.style.overflow = ''; };
}
