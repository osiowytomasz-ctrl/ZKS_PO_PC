// Tabela uprawnień w bazie: dokument app_config/access = { m: { '<id elementu>': { god, master, clerik, tourist, peasant } }, by, at }.
// Czytają wszyscy zalogowani (nasłuch na żywo + kopia w pamięci przeglądarki na start bez połączenia), zapisuje tylko GOD (reguły Firestore).
import { firebase } from './fb.js';
import { setOverrides, getOverrides } from './logic/accessOverlay.js';

const LS = 'zks.access.m';
let watching = false;

/** Kopia z poprzedniego uruchomienia – żeby przyciski były od razu zgodne z tabelą, zanim odpowie baza. */
export function loadCachedMatrix() {
  try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (v && typeof v === 'object') setOverrides(v); } catch { /* bez pamięci */ }
}

export async function watchAccessMatrix() {
  if (watching) return; watching = true;
  loadCachedMatrix();
  try {
    const { sdk, db } = await firebase();
    sdk.onSnapshot(sdk.doc(db, 'app_config', 'access'), (d) => {
      const m = d.exists() && d.data().m && typeof d.data().m === 'object' ? d.data().m : {};
      setOverrides(m);
      try { localStorage.setItem(LS, JSON.stringify(m)); } catch { /* bez pamięci */ }
    }, () => { watching = false; });
  } catch { watching = false; }
}

/** Zapis całej tabeli nadpisań (tylko GOD). */
export async function saveAccessMatrix(m, by) {
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'app_config', 'access'), { m, by: by || '', at: Date.now() });
  setOverrides(m);
  try { localStorage.setItem(LS, JSON.stringify(m)); } catch { /* bez pamięci */ }
}
export { getOverrides };
