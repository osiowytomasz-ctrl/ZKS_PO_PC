// Wspólny układ tabeli Planu (Firestore plan_layout/main): szerokości kolumn, wysokości wierszy, czcionka.
// Zmiana u jednego użytkownika od razu przychodzi do pozostałych (nasłuch), także do aplikacji na Androidzie.
import { firebase } from './fb.js';
import { cleanLayout } from './logic/planGrid.js';

/** Nasłuch układu; [cb](layout) przy każdej zmianie. Zwraca funkcję wyłączającą. */
export async function watchPlanLayout(cb, onError) {
  const { sdk, db } = await firebase();
  return sdk.onSnapshot(sdk.doc(db, 'plan_layout', 'main'), (snap) => cb(cleanLayout(snap.exists() ? snap.data() : null)), (e) => onError && onError(e));
}

/**
 * Zapis zmian układu: {cols: {c: px|null}, rows: {klucz: px|null}, font?}. null usuwa własny rozmiar (wraca dopasowanie automatyczne).
 */
export async function savePlanLayout({ cols = {}, rows = {}, font } = {}, user = '') {
  const { sdk, db } = await firebase();
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? sdk.deleteField() : Math.round(v)]));
  const data = { updatedAt: Date.now(), updatedBy: user };
  if (Object.keys(cols).length) data.cols = map(cols);
  if (Object.keys(rows).length) data.rows = map(rows);
  if (font != null) data.font = Math.round(font);
  await sdk.setDoc(sdk.doc(db, 'plan_layout', 'main'), data, { merge: true });
}
