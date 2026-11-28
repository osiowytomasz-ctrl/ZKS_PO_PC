// Dodawanie pozycji do Listy detali (Mistrz): tabela 10 wierszy zapamiętywana między uruchomieniami – te same zasady co „Dodaj zakupy”.
export const DRAFT_ROWS = 10;
export const DRAFT_FIELDS = ['komis', 'rysunek', 'pozycja', 'komplet', 'ilosc', 'nazwa', 'uwagi'];
export const LABELS = { komis: 'Komis', rysunek: 'Nr rysunku', pozycja: 'Nr poz.', komplet: 'Komplet', ilosc: 'Ilość zlecona', nazwa: 'Nazwa elementu', uwagi: 'Uwagi' };

const blankRow = () => Object.fromEntries(DRAFT_FIELDS.map((f) => [f, '']));
export { blankRow };
export const isBlankRow = (r) => DRAFT_FIELDS.every((f) => !String(r[f] ?? '').trim());
export const emptyDraft = () => Array.from({ length: DRAFT_ROWS }, blankRow);
export const filledCount = (draft) => draft.filter((r) => !isBlankRow(r)).length;

/** Niepuste wiersze na górę (kolejność zachowana), reszta pusta do 10. */
export function compactDraft(draft) {
  return [...draft.filter((r) => !isBlankRow(r)), ...emptyDraft()].slice(0, DRAFT_ROWS);
}

/** Ilość zlecona: liczba całkowita ≥ 1 (jak w API mp_addDetail) albo null. */
export function parseOrdered(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  const n = Number(t);
  return t !== '' && Number.isFinite(n) && n >= 1 && Math.floor(n) === n ? n : null;
}

/** Komunikat o pierwszym błędnym wierszu albo null (można wysyłać). Wymagane: komis, nr rysunku, nr pozycji, komplet i ilość. */
export function validateDraft(draft) {
  if (filledCount(draft) === 0) return 'Tabela jest pusta.';
  const seen = new Map();
  for (let i = 0; i < draft.length; i++) {
    const r = draft[i];
    if (isBlankRow(r)) continue;
    for (const f of ['komis', 'rysunek', 'pozycja', 'komplet']) if (!String(r[f] ?? '').trim()) return `Wiersz ${i + 1}: uzupełnij pole „${LABELS[f]}”.`;
    if (parseOrdered(r.ilosc) === null) return `Wiersz ${i + 1}: ilość zlecona musi być liczbą całkowitą większą lub równą 1.`;
    const key = ['komis', 'rysunek', 'pozycja', 'komplet'].map((f) => String(r[f]).trim()).join('|');
    if (seen.has(key)) return `Wiersz ${i + 1}: ten sam detal jest już w wierszu ${seen.get(key)} tabeli.`;
    seen.set(key, i + 1);
  }
  return null;
}

/** Odczyt zapisanej tabeli (JSON); przy błędzie pusta tabela. */
export function parseDraft(json) {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return emptyDraft();
    const rows = arr.slice(0, DRAFT_ROWS).map((o) => Object.fromEntries(DRAFT_FIELDS.map((f) => [f, String(o?.[f] ?? '')])));
    return [...rows, ...emptyDraft()].slice(0, DRAFT_ROWS);
  } catch { return emptyDraft(); }
}

/** Dane jednego wiersza do API mp_addDetail. */
export const toForm = (r) => ({ komis: r.komis.trim(), rysunek: r.rysunek.trim(), pozycja: r.pozycja.trim(), komplet: r.komplet.trim(), ilosc: String(parseOrdered(r.ilosc)), nazwa: r.nazwa.trim(), uwagi: r.uwagi.trim() });
