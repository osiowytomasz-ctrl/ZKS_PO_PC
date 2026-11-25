// Pamięć filtrów, sortowania i pól wyszukiwania modułów – na tym komputerze (localStorage), osobno dla każdego modułu/widoku.
// Użycie w widoku:  const mem = viewMemory('zakupy.ordered', st, ['filters', 'sorts']);  mem.load();  …  mem.save() (np. na końcu draw()).
// Obsługiwane wartości: filtry kolumn (zbiór wartości lub zakres dat – jak w tableFilter.js), listy sortowań, teksty, liczby, wartości logiczne, tablice.
import { rangeFilter, isRangeFilter } from './tableFilter.js';

const PREFIX = 'zks.view.';

/** Filtry kolumn → postać do zapisu w JSON (zbiór → lista, zakres dat → {range, from, to}). */
export function packFilters(filters) {
  const out = {};
  for (const [k, v] of Object.entries(filters || {})) {
    if (!v) continue;
    if (isRangeFilter(v)) out[k] = { range: true, from: v.from, to: v.to };
    else if (typeof v.has === 'function' && v[Symbol.iterator]) out[k] = [...v].map(String);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;   // proste filtry tekstowe (np. Braki, Śledzenie narzędzi)
  }
  return out;
}
/** Odwrotność packFilters. [simple] – klucze, które są zwykłymi wartościami (nie zbiorami). */
export function unpackFilters(saved, simple = false) {
  const out = {};
  for (const [k, v] of Object.entries(saved || {})) {
    if (Array.isArray(v)) out[k] = new Set(v);
    else if (v && typeof v === 'object' && v.range) out[k] = rangeFilter(v.from, v.to);
    else if (simple || typeof v !== 'object') out[k] = v;
  }
  return out;
}
const cleanSorts = (s) => (Array.isArray(s) ? s : []).filter((x) => x && typeof x.key === 'string').map((x) => ({ key: x.key, ascending: x.ascending !== false }));

/**
 * [key] – nazwa pamięci (np. 'zakupy.ordered'); [st] – obiekt stanu widoku; [fields] – które pola stanu zapamiętać:
 * 'filters' (filtry kolumn), 'sorts', 'simpleFilters' (filtry-teksty: wartości zwykłe) albo nazwa dowolnego pola z prostą wartością (q, sort, dir…).
 * [valid] – opcjonalnie lista dozwolonych kluczy kolumn (nieznane są pomijane – kolumny mogły się zmienić).
 */
export function viewMemory(key, st, fields = ['filters', 'sorts'], valid = null) {
  const name = PREFIX + key;
  let last = '';
  const keep = (k) => !valid || valid.includes(k);
  return {
    /** Wczytuje zapamiętane wartości do [st]; zwraca true, gdy coś było zapisane. */
    load(k = key) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(PREFIX + k) || 'null'); } catch { saved = null; }
      if (!saved || typeof saved !== 'object') return false;
      for (const f of fields) {
        if (!(f in saved)) continue;
        if (f === 'filters') st.filters = Object.fromEntries(Object.entries(unpackFilters(saved.filters)).filter(([c]) => keep(c)));
        else if (f === 'simpleFilters') st.filters = { ...(st.filters || {}), ...unpackFilters(saved.simpleFilters, true) };
        else if (f === 'sorts') st.sorts = cleanSorts(saved.sorts).filter((x) => keep(x.key));
        else st[f] = saved[f];
      }
      last = JSON.stringify(saved);
      return true;
    },
    /** Zapisuje bieżący stan (tylko gdy się zmienił). */
    save(k = key) {
      const o = {};
      for (const f of fields) {
        if (f === 'filters') o.filters = packFilters(st.filters);
        else if (f === 'simpleFilters') o.simpleFilters = packFilters(st.filters);
        else if (f === 'sorts') o.sorts = cleanSorts(st.sorts);
        else o[f] = st[f];
      }
      const text = JSON.stringify(o);
      if (text === last && k === key) return;
      last = text;
      try { localStorage.setItem(PREFIX + k, text); } catch { /* pamięć niedostępna */ }
    },
    name,
  };
}
