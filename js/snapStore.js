// Migawki danych w Firebase (Firestore): dane z arkusza pobierane raz, potem tylko na życzenie (przycisk „Odśwież z arkusza”).
//   snap_meta/{klucz} – { chunks, size, updatedAt, updatedBy, info }  (info – krótki opis, np. liczba wierszy)
//   snap_rows/{klucz}_{i} – { i, s: fragment tekstu JSON }  (JSON całej migawki pocięty na fragmenty < 1 MB)
// Zapis: MASTER / GOD (reguły Firestore), odczyt: każdy zalogowany. Klucze: 'bn', 'pswt', 'pom', 'badania'.
import { firebase } from './fb.js';

const CHUNK = 250000;   // znaków na dokument (UTF-8 do 3 B/znak < 1 MB)
const mem = new Map();

/** Pocięcie tekstu na fragmenty. */
export const splitText = (text, n = CHUNK) => { const out = []; for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n)); return out.length ? out : ['']; };

/** Zapis migawki [data] (dowolny JSON) pod kluczem [key]; [info] – opis. Usuwa nadmiarowe fragmenty poprzedniej wersji. */
export async function putSnapshot(key, data, { user = '', info = '' } = {}) {
  const { sdk, db } = await firebase();
  const text = JSON.stringify(data), parts = splitText(text);
  const metaRef = sdk.doc(db, 'snap_meta', key);
  let old = 0;
  try { const m = await sdk.getDoc(metaRef); if (m.exists()) old = Number(m.data().chunks) || 0; } catch { /* brak poprzedniej wersji */ }
  for (let start = 0; start < parts.length; start += 400) {   // partie zapisów (limit 500 operacji)
    const b = sdk.writeBatch(db);
    parts.slice(start, start + 400).forEach((s, j) => b.set(sdk.doc(db, 'snap_rows', `${key}_${start + j}`), { i: start + j, s }));
    await b.commit();
  }
  for (let i = parts.length; i < old; i++) { try { await sdk.deleteDoc(sdk.doc(db, 'snap_rows', `${key}_${i}`)); } catch { /* ignorujemy */ } }
  const meta = { chunks: parts.length, size: text.length, updatedAt: Date.now(), updatedBy: String(user || ''), info: String(info || '') };
  await sdk.setDoc(metaRef, meta);   // meta na końcu: czytelnik widzi komplet fragmentów
  mem.set(key, Promise.resolve({ data, meta }));
  return meta;
}
/** Migawka z bazy: { data, meta } albo null, gdy jej nie ma. [force] – bez pamięci w programie. */
export function getSnapshot(key, force = false) {
  if (!force && mem.has(key)) return mem.get(key);
  const p = (async () => {
    const { sdk, db } = await firebase();
    const m = await sdk.getDoc(sdk.doc(db, 'snap_meta', key));
    if (!m.exists()) return null;
    const meta = m.data(), docs = await Promise.all(Array.from({ length: Number(meta.chunks) || 0 }, (_, i) => sdk.getDoc(sdk.doc(db, 'snap_rows', `${key}_${i}`))));
    if (docs.some((d) => !d.exists())) throw new Error('Migawka „' + key + '” w bazie jest niekompletna – odśwież ją z arkusza.');
    return { data: JSON.parse(docs.map((d) => d.data().s).join('')), meta };
  })();
  p.catch(() => mem.delete(key));
  mem.set(key, p);
  return p;
}
