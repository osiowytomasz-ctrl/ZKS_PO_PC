// Tryb przejścia z arkusza do bazy dla każdej części programu (docs/MIGRACJA_ARKUSZ_DO_BAZY.md), dokument app_config/migration = { zn: 'sheet' | 'dual' | 'db', … }.
//   sheet – jak dotąd: arkusz jest źródłem danych (baza tylko jako kopia),
//   dual  – praca równoległa: program czyta z bazy, a zapisuje do bazy i do arkusza (można porównać oba),
//   db    – zapis tylko do bazy, arkusz zostaje kopią „Eksport do arkusza”.
// Przełącza tylko GOD (reguły Firestore). Wycofanie = ustawienie z powrotem „sheet”.
import { firebase } from './fb.js';

export const MODES = { sheet: 'Arkusz (jak dotąd)', dual: 'Równolegle (baza i arkusz)', db: 'Tylko baza' };
const mem = new Map();
const LABELS = { zn: 'ZN (zniszczone)', zp: 'ZP (płytki)', zwg: 'ZwG (wiertła)', zakupy: 'Zakupy', n: 'N (lokalizacje)', pswt: 'Produkty (PSWT)', bn: 'BN (zespoły)' };
let watching = false, first = true;

/**
 * Nasłuch zmian trybów pracy na żywo (jeden dokument app_config/migration): tryb ustawiony przez GOD obowiązuje od razu u wszystkich zalogowanych (pamięć trybów jest aktualizowana),
 * a na górze ekranu pojawia się komunikat z przyciskiem „Odśwież program” – otwarte widoki (np. Skaner) czytają tryb przy otwarciu.
 */
export async function watchModes() {
  if (watching) return; watching = true;
  try {
    const { sdk, db } = await firebase();
    sdk.onSnapshot(sdk.doc(db, 'app_config', 'migration'), (d) => {
      const data = d.exists() ? d.data() : {}, changed = [];
      for (const k of Object.keys(MODES_BY_DOMAIN(data))) {
        const v = data[k] in MODES ? data[k] : 'sheet', old = mem.has(k) ? mem.get(k) : (first ? v : 'sheet');
        if (old !== v) changed.push([k, v, data[k + 'By']]);
        mem.set(k, v);
      }
      if (!first && changed.length) announce(changed);
      first = false;
    }, () => { watching = false; });
  } catch { watching = false; }
}
const MODES_BY_DOMAIN = (data) => Object.fromEntries(Object.keys(data).filter((k) => k in LABELS).map((k) => [k, data[k]]));

function announce(changed) {
  if (typeof document === 'undefined') return;
  let bar = document.getElementById('mode-change-bar');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'mode-change-bar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff3cd;color:#000;border-bottom:2px solid #f0ad00;padding:8px 12px;display:flex;gap:12px;align-items:center;font-size:14px';
    document.body.append(bar);
  }
  bar.replaceChildren();
  const t = document.createElement('span'); t.style.flex = '1';
  t.textContent = 'Administrator zmienił tryb pracy programu: ' + changed.map(([k, v, by]) => `${LABELS[k] || k} → ${MODES[v]}${by ? ' (' + by + ')' : ''}`).join('; ') + '. Odśwież program, żeby wszystkie widoki pracowały w nowym trybie.';
  const b = document.createElement('button'); b.textContent = 'Odśwież program'; b.style.cssText = 'padding:4px 12px;font-weight:600;cursor:pointer';
  b.onclick = () => location.reload();
  const x = document.createElement('button'); x.textContent = '×'; x.title = 'Ukryj'; x.style.cssText = 'padding:2px 8px;cursor:pointer'; x.onclick = () => bar.remove();
  bar.append(t, b, x);
}

/** Tryb [domain] ('zn', …); brak ustawienia = 'sheet'. */
export async function getMode(domain, force = false) {
  watchModes();
  if (!force && mem.has(domain)) return mem.get(domain);
  let mode = 'sheet';
  try {
    const { sdk, db } = await firebase();
    const d = await sdk.getDoc(sdk.doc(db, 'app_config', 'migration'));
    const v = d.exists() ? d.data()[domain] : null;
    if (v in MODES) mode = v;
  } catch { /* bez bazy – tryb arkuszowy */ }
  mem.set(domain, mode);
  return mode;
}

export async function setMode(domain, mode, user = '') {
  if (!(mode in MODES)) throw new Error('Nieznany tryb: ' + mode);
  const { sdk, db } = await firebase();
  await sdk.setDoc(sdk.doc(db, 'app_config', 'migration'), { [domain]: mode, [domain + 'At']: Date.now(), [domain + 'By']: String(user || '') }, { merge: true });
  mem.set(domain, mode);
  return mode;
}
