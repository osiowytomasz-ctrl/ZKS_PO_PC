// Tekst sformatowany (Tablica ogłoszeń – „Informacje od mistrza”): edytor jak w Wordzie (wklejanie z Worda / stron, pogrubienie, kolory, listy…) i bezpieczne wyświetlanie u innych użytkowników.
// HTML jest czyszczony listą dozwolonych znaczników i stylów (bez skryptów, zdarzeń, odnośników, obrazów) – przy zapisie i przy wyświetlaniu. Czyste funkcje – testy: test/rich-text.test.js.
// Odpowiednik w aplikacji na Androida: ui/workflow/RichText.kt (ta sama lista).

const TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'sub', 'sup']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'xml', 'object', 'iframe', 'template', 'noscript', 'svg', 'math']);
const VOID = new Set(['br']);
const SIZES_PX = [10, 13, 16, 18, 24, 32, 48];   // znacznik <font size="1…7">
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;
const NO_COLOR = new Set(['inherit', 'initial', 'unset', 'windowtext', 'transparent', 'currentcolor']);

/** Styl (łańcuch CSS) → tylko dozwolone właściwości: color, background-color, font-weight, font-style, text-decoration, font-size, text-align. */
export function cleanStyle(style) {
  const out = [];
  for (const part of String(style ?? '').split(';')) {
    const i = part.indexOf(':'); if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase(), val = part.slice(i + 1).trim().replace(/\s*!important$/i, '');
    if (!val || /expression|url\(|javascript|@import/i.test(val)) continue;
    if ((prop === 'color' || prop === 'background-color' || prop === 'background') && COLOR.test(val) && !NO_COLOR.has(val.toLowerCase())) out.push(`${prop === 'background' ? 'background-color' : prop}:${val}`);
    else if (prop === 'font-weight' && /^(bold|bolder|normal|[1-9]00)$/i.test(val)) out.push(`font-weight:${val}`);
    else if (prop === 'font-style' && /^(italic|oblique|normal)$/i.test(val)) out.push(`font-style:${val}`);
    else if (prop === 'text-decoration' || prop === 'text-decoration-line') { const t = val.toLowerCase().split(/\s+/).filter((x) => ['underline', 'line-through', 'none'].includes(x)); if (t.length) out.push(`text-decoration:${t.join(' ')}`); }
    else if (prop === 'text-align' && /^(left|right|center|justify)$/i.test(val)) out.push(`text-align:${val}`);
    else if (prop === 'font-size') { const m = /^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/i.exec(val); if (m) { const n = Number(m[1]), u = m[2].toLowerCase(); if ((u === 'px' && n >= 8 && n <= 72) || (u === 'pt' && n >= 6 && n <= 54) || ((u === 'em' || u === 'rem') && n >= 0.5 && n <= 4) || (u === '%' && n >= 50 && n <= 400)) out.push(`font-size:${n}${u}`); } }
  }
  return out.join(';');
}
const attr = (attrs, name) => { const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs || ''); return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null; };
const esc = (t) => t.replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z]{2,8});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Czyści HTML: zostają dozwolone znaczniki i style; nieznane znaczniki znikają (tekst zostaje), skrypty i style znikają razem z zawartością, niedomknięte znaczniki są domykane. */
export function sanitizeHtml(html) {
  const src = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)|</g;
  const out = [], stack = [];   // stack: nazwa znacznika wyjściowego albo '' (znacznik pominięty)
  let skip = 0, skipName = '';
  for (let m; (m = re.exec(src));) {
    if (m[4] !== undefined) { if (!skip) out.push(esc(m[4])); continue; }
    if (m[0] === '<') { if (!skip) out.push('&lt;'); continue; }
    const closing = m[1] === '/', name = m[2].toLowerCase(), attrs = m[3] || '';
    if (skip) { if (name === skipName) { if (closing) skip--; else if (!/\/\s*$/.test(attrs)) skip++; } continue; }
    if (DROP_WITH_CONTENT.has(name)) { if (!closing && !/\/\s*$/.test(attrs) && !VOID.has(name)) { skip = 1; skipName = name; } continue; }
    if (closing) {
      const i = stack.lastIndexOf(name === 'font' ? 'span' : name); const tag = name === 'font' ? 'span' : name;
      if (TAGS.has(tag) && !VOID.has(tag) && i >= 0) { while (stack.length > i) { const t = stack.pop(); if (t) out.push(`</${t}>`); } }
      continue;
    }
    if (name === 'br') { out.push('<br>'); continue; }
    if (name === 'font') {   // <font color size> (Word, stare edytory) → <span style>
      const st = [], c = attr(attrs, 'color'), sz = Number(attr(attrs, 'size'));
      if (c && COLOR.test(c)) st.push(`color:${c}`);
      if (sz >= 1 && sz <= 7) st.push(`font-size:${SIZES_PX[sz - 1]}px`);
      out.push(st.length ? `<span style="${st.join(';')}">` : '<span>'); stack.push('span'); continue;
    }
    if (!TAGS.has(name)) continue;
    const style = cleanStyle(attr(attrs, 'style'));
    out.push(`<${name}${style ? ` style="${style}"` : ''}>`); stack.push(name);
  }
  while (stack.length) { const t = stack.pop(); if (t) out.push(`</${t}>`); }
  return out.join('').replace(/(<br>\s*){4,}/g, '<br><br>').trim();
}
/** Tekst bez formatowania (do podglądów i starszych wersji programu): bloki → nowe linie, elementy listy → „• ”. */
export function plainText(html) {
  return sanitizeHtml(html).replace(/<li[^>]*>/g, '• ').replace(/<\/(p|div|li|h[1-4])>/g, '\n').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}
/** Zwykły tekst → HTML (nowe linie jako <br>) – dla informacji zapisanych dawniej bez formatowania. */
export const textToHtml = (text) => esc(String(text ?? '')).replace(/\r?\n/g, '<br>');
