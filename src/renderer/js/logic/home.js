// Reguły listy „Braki części” (odpowiednik HomeLogic.kt, bez filtrów z katalogu narzędzi).
export const LEVELS = { red: 'Czerwony', yellow: 'Żółty', green: 'Zielony', other: 'Inny kolor' };
const ORDER = ['red', 'yellow', 'green', 'other'];

export function levelOf(color) {
  switch (String(color ?? '').trim().toLowerCase().replace(/ /g, '')) {
    case '#ff0000': case '#d50000': return 'red';
    case '#ffff00': case '#ffd600': return 'yellow';
    case '#00ff00': case '#00c853': return 'green';
    default: return 'other';
  }
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

export function filterParts(parts, { code = '', level = null } = {}) {
  return parts.filter((p) => (!code.trim() || norm(p.partCode).includes(norm(code))) && (!level || levelOf(p.color) === level));
}

export function levelsPresent(parts) {
  const set = new Set(parts.map((p) => levelOf(p.color)));
  return ORDER.filter((l) => set.has(l));
}
