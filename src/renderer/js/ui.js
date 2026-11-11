// Pomocnicze funkcje interfejsu: tworzenie elementów, dialogi, komunikaty, wywołania API.

/** Tworzy element: h('div', {class:'x', onclick: fn}, 'tekst', dziecko…). */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Wywołuje funkcję backendu; przy błędzie rzuca ApiError z polskim komunikatem. */
export async function api(fn, args = [], opts = {}) {
  const r = await window.zks.call(fn, args, opts);
  if (!r.ok) throw new ApiError(r.code, r.error);
  return r.data;
}

/**
 * Odczyt z pamięcią podręczną (stale-while-revalidate): jeśli są zapisane dane z poprzedniego razu, `onData(dane, {cached:true, age})`
 * wywoływane jest od razu, a potem `onData(świeże, {cached:false})`, gdy dojdą z serwera. Zwraca obietnicę rozwiązywaną przy
 * pierwszych danych (z pamięci albo z serwera). Błąd serwera przy istniejących danych z pamięci to tylko komunikat.
 */
const inflight = new Map();
/** To samo wywołanie (funkcja + argumenty) w toku jest wspólne: wejście w moduł w trakcie pobierania w tle nie zaczyna drugiego zapytania. */
function apiShared(fn, args, opts) {
  const { callArgs, ...apiOpts } = opts;
  const sent = callArgs || args || [];
  const k = fn + '|' + JSON.stringify(sent);
  if (inflight.has(k)) return inflight.get(k);
  // Wynik zapisuje się w pamięci pod kluczem `args` (zwykłe wywołanie), nawet gdy serwerowi wysyłamy `callArgs` (np. z dopiskiem 'fresh').
  const p = api(fn, sent, { ...apiOpts, cache: true, cacheArgs: args || [] }).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/**
 * Odczyt z pamięcią podręczną (stale-while-revalidate): jeśli są zapisane dane z poprzedniego razu, `onData(dane, {cached:true, age})`
 * wywoływane jest od razu, a potem `onData(świeże, {cached:false})`, gdy dojdą z serwera. Zwraca obietnicę rozwiązywaną przy
 * pierwszych danych (z pamięci albo z serwera). Błąd serwera przy istniejących danych z pamięci to tylko komunikat (chyba że `silent`).
 * Opcje: `maxAge` (ms): dane z pamięci nie starsze niż tyle traktujemy jako świeże i nie pytamy serwera;
 * `force`: pomija pamięć i pyta serwer; `silent`: bez komunikatu o błędzie (odświeżanie w tle);
 * `callArgs`: argumenty wysyłane do serwera zamiast `args` (np. z dopiskiem 'fresh', który pomija pamięć podręczną w skrypcie).
 */
export async function apiCached(fn, args, onData, opts = {}) {
  const { maxAge = 0, silent = false, force = false, callArgs, ...apiOpts } = opts;
  const cached = force ? null : await window.zks.cacheGet(fn, args || []);
  let resolveFirst, rejectFirst, settled = false;
  const first = new Promise((res, rej) => { resolveFirst = res; rejectFirst = rej; });
  if (cached && cached.data !== undefined) {
    const age = Date.now() - cached.t;
    if (maxAge && age <= maxAge) { onData(cached.data, { cached: false, age, recent: true }); return cached.data; }
    onData(cached.data, { cached: true, age });
    settled = true; resolveFirst(cached.data);
  }
  apiShared(fn, args, { ...apiOpts, callArgs }).then((data) => {
    onData(data, { cached: false, age: 0 });
    if (!settled) { settled = true; resolveFirst(data); }
  }).catch((e) => {
    if (settled) { if (!silent) toast('Nie udało się odświeżyć danych: ' + e.message + ' (widać dane z pamięci)', true); }
    else rejectFirst(e);
  });
  return first;
}

let toastTimer;
export function toast(message, isError = false) {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const t = h('div', { class: 'toast' + (isError ? ' error' : '') }, message);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), isError ? 6000 : 3000);
}

/** Okno modalne. Zwraca {close, root}. */
export function modal(title, content, { wide = false, onClose, sticky = false } = {}) {
  const overlay = h('div', { class: 'overlay' });
  const box = h('div', { class: 'dialog' + (wide ? ' wide' : '') }, title ? h('h3', {}, title) : null, content);
  overlay.append(box);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  // sticky: okno z edycją nie zamyka się klawiszem Esc ani kliknięciem obok (żeby nie stracić zmian)
  const onKey = (e) => { if (e.key === 'Escape' && !sticky) close(); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !sticky) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return { close, root: box };
}

export function alertBox(title, message) {
  return new Promise((resolve) => {
    const m = modal(title, h('div', {}, h('p', { style: { whiteSpace: 'pre-wrap' } }, message),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { m.close(); resolve(); } }, 'OK'))), { onClose: resolve });
  });
}

export function confirmBox(title, message, okLabel = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal(title, h('div', {},
      h('p', { style: { whiteSpace: 'pre-wrap' } }, message),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { finish(false); m.close(); } }, 'Anuluj'),
        h('button', { class: 'btn primary', onclick: () => { finish(true); m.close(); } }, okLabel))), { onClose: () => finish(false) });
  });
}

/** Okno z kilkoma przyciskami: options = [[etykieta, wartość], …]; ostatni jest główny. Zamknięcie okna zwraca null. */
export function choiceBox(title, message, options) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal(title, h('div', {}, h('p', { style: { whiteSpace: 'pre-wrap' } }, message),
      h('div', { class: 'actions', style: { flexWrap: 'wrap' } }, ...options.map(([label, value], i) =>
        h('button', { class: 'btn' + (i === options.length - 1 ? ' primary' : ''), onclick: () => { finish(value); m.close(); } }, label)))), { onClose: () => finish(null) });
  });
}

/** Pole formularza z etykietą. */
export function field(label, input) {
  return h('label', { class: 'f' }, h('span', {}, label), input);
}

/**
 * Okno kolumny: sortowanie (A→Z / Z→A / brak) i wybór wartości (jak autofiltr w arkuszu).
 * options: [{value,count}]; activeFilter: Set|undefined; activeSort: true|false|null.
 * onApply(filter: Set|null, sort: true|false|null).
 */
export function columnFilterDialog({ title, options, activeFilter, activeSort, onApply }) {
  let sort = activeSort === undefined ? null : activeSort;
  const selected = new Set(activeFilter ? [...activeFilter] : options.map((o) => o.value));
  const before = new Set(selected);
  const list = h('div', { class: 'opts' });
  const search = h('input', { type: 'search', placeholder: 'Szukaj…', style: { width: '100%', padding: '6px', margin: '4px 0' } });
  const sortButtons = [];
  const paintSort = () => sortButtons.forEach(([val, b]) => { b.classList.toggle('primary', sort === val); });
  const mkSort = (label, val) => {
    const b = h('button', { class: 'btn small', onclick: () => { sort = val; paintSort(); } }, label);
    sortButtons.push([val, b]);
    return b;
  };
  const render = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const shown = options.filter((o) => !q || (o.value || '(puste)').toLowerCase().includes(q));
    for (const o of shown) {
      const cb = h('input', { type: 'checkbox', checked: selected.has(o.value), onchange: () => { cb.checked ? selected.add(o.value) : selected.delete(o.value); } });
      list.append(h('label', {}, cb, o.value || '(puste)', h('span', { class: 'count' }, String(o.count))));
    }
    if (!shown.length) list.append(h('div', { class: 'muted' }, 'Brak wartości.'));
  };
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (q) {
      selected.clear();
      options.filter((o) => (o.value || '(puste)').toLowerCase().includes(q)).forEach((o) => selected.add(o.value));
    } else {
      selected.clear(); before.forEach((v) => selected.add(v));
    }
    render();
  });
  let m;
  const apply = () => {
    const all = selected.size === options.length;
    onApply(all ? null : new Set(selected), sort);
    m.close();
  };
  const content = h('div', {},
    h('div', { class: 'row' }, 'Sortuj: ', mkSort('A→Z', true), mkSort('Z→A', false), mkSort('Brak', null)),
    search, list,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { options.forEach((o) => selected.add(o.value)); render(); } }, 'Zaznacz wszystko'),
      h('button', { class: 'btn small', onclick: () => { selected.clear(); render(); } }, 'Odznacz wszystko')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
      h('button', { class: 'btn primary', onclick: apply }, 'OK')));
  m = modal(title, content);
  paintSort();
  render();
  search.focus();
}

/** Nagłówek filtrowanej tabeli. */
export function filterHeader(column, { filtered, label, onclick, vertical = false, extra = {} }) {
  const inner = vertical ? h('span', {}, column.title) : column.title;
  return h('th', { class: 'click' + (filtered ? ' filtered' : '') + (vertical ? ' vert' : ''), onclick, ...extra },
    inner, filtered ? ' ▼' : '', label ? h('span', { class: 'badge' }, label) : null);
}
