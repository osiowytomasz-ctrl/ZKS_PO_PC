// Edytor gałęzi operacji (operacja › suboperacja › subsuboperacja): drzewo do edycji w oknie, ten sam zapis jako tekst do notatnika
// (eksport/import pliku .txt) i plan zapisu ze sprawdzeniem całej logiki (numery, poziomy, duplikaty, zależności, cykle, odwołania z zewnątrz).
// Czyste funkcje – testy: test/harm-tree.test.js. Okno: views/harmLive.js (treeEditor).
import { ID_PATTERN, isSyntheticId, lpCompare, descendants } from './harmModel.js';
import { computeSchedule, subParent, depthOf } from './schedule.js';

const FIELDS = ['lp', 'element', 'station', 'hours', 'preds', 'komis', 'client'];
export const TREE_COLUMNS = ['lp', 'opis', 'stanowisko', 'czas [h]', 'zależności (Z1, Z2…)', 'komis', 'klient'];
let keySeq = 0;
const newKey = () => 'n' + (++keySeq);
const num = (v) => (v == null || v === '' ? '' : String(v));

/** Węzeł edytora: pola jako teksty; [orig] = numer w bazie (null = nowa operacja), [key] = stały identyfikator w oknie. */
export function nodeFromOp(lp, op) {
  return { key: newKey(), orig: lp, lp, element: op.element || '', station: op.station || '', hours: num(op.hours), preds: (op.preds || []).join(', '), komis: op.komis || '', client: op.client || '' };
}
export const emptyNode = (lp) => ({ key: newKey(), orig: null, lp, element: '', station: '', hours: '', preds: '', komis: '', client: '' });

/** Gałąź z bazy: węzeł [rootId] i wszystkie jego potomki w kolejności drzewa. */
export function treeFromOps(opsByLp, rootId) {
  return [rootId, ...descendants(opsByLp, rootId)].filter((lp) => opsByLp[lp]).map((lp) => nodeFromOp(lp, opsByLp[lp]));
}

export const sortTree = (nodes) => nodes.slice().sort((a, b) => lpCompare(a.lp.trim(), b.lp.trim()));
const parentLp = (lp) => subParent(String(lp).trim());
const isUnder = (lp, root) => { for (let p = parentLp(lp); p != null; p = subParent(p)) if (p === root) return true; return false; };
const renameInPreds = (nodes, map) => nodes.map((n) => ({ ...n, preds: n.preds.split(/[,;\s]+/).filter(Boolean).map((p) => map.get(p) ?? p).join(', ') }));

/** Zmiana numeru węzła w oknie: potomki dostają nowy początek numeru, zależności w gałęzi wskazujące na zmienione numery są poprawiane. */
export function renameNode(nodes, key, newLp) {
  const n = nodes.find((x) => x.key === key); if (!n) return nodes;
  const old = n.lp.trim(), neu = String(newLp).trim();
  if (old === neu) return nodes;
  const map = new Map();
  const out = nodes.map((x) => {
    const lp = x.lp.trim();
    if (x.key === key) { map.set(old, neu); return { ...x, lp: neu }; }
    if (old && isUnder(lp, old)) { const t = neu + lp.slice(old.length); map.set(lp, t); return { ...x, lp: t }; }
    return x;
  });
  return sortTree(renameInPreds(out, map));
}

/** Przesunięcie węzła wśród rodzeństwa o [delta] (−1 w górę, +1 w dół): litery w grupie zostają, zmienia się ich przydział (jak przy przeciąganiu). */
export function moveNode(nodes, key, delta) {
  const n = nodes.find((x) => x.key === key); if (!n) return nodes;
  const par = parentLp(n.lp);
  if (par == null) return nodes;
  const sibs = nodes.filter((x) => parentLp(x.lp) === par).sort((a, b) => lpCompare(a.lp, b.lp));
  const i = sibs.indexOf(n), j = i + delta;
  if (j < 0 || j >= sibs.length) return nodes;
  const letters = sibs.map((x) => x.lp.trim().slice(par.length));
  const order = sibs.slice(); [order[i], order[j]] = [order[j], order[i]];
  const map = new Map();
  order.forEach((s, k) => { const old = s.lp.trim(), neu = par + letters[k]; if (old !== neu) map.set(old, neu); });
  const out = nodes.map((x) => {
    const lp = x.lp.trim();
    for (const [o, ne] of map) { if (lp === o) return { ...x, lp: ne }; if (isUnder(lp, o)) return { ...x, lp: ne + lp.slice(o.length) }; }
    return x;
  });
  const full = new Map();   // pełna mapa (z potomkami) do poprawy zależności
  nodes.forEach((x, k) => { if (x.lp.trim() !== out[k].lp.trim()) full.set(x.lp.trim(), out[k].lp.trim()); });
  return sortTree(renameInPreds(out, full));
}

/** Nowe dziecko węzła: następna wolna litera (z pominięciem numerów w oknie i w bazie); null, gdy węzeł jest już na trzecim poziomie. */
export function addChild(nodes, key, existing = {}) {
  const n = nodes.find((x) => x.key === key); if (!n) return { nodes, error: 'Brak węzła' };
  const p = n.lp.trim();
  if (!ID_PATTERN.test(p)) return { nodes, error: `Najpierw popraw numer ${p || '(pusty)'}` };
  if (depthOf(p) >= 2) return { nodes, error: 'Subsuboperacja nie może mieć dzieci (najwyżej trzy poziomy)' };
  const taken = new Set([...nodes.map((x) => x.lp.trim()), ...Object.keys(existing)]);
  for (const l of 'abcdefghijklmnopqrstuvwxyz') if (!taken.has(p + l)) {
    const child = { ...emptyNode(p + l), station: n.station };
    return { nodes: sortTree([...nodes, child]), key: child.key };
  }
  return { nodes, error: 'Brak wolnych liter (a–z)' };
}

/** Usunięcie węzła razem z jego potomkami (z okna; w bazie dopiero po zapisie). */
export function removeNode(nodes, key) {
  const n = nodes.find((x) => x.key === key); if (!n) return nodes;
  const lp = n.lp.trim();
  return nodes.filter((x) => x.key !== key && !(lp && isUnder(x.lp.trim(), lp)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Notatnik: tekst z kolumnami oddzielonymi „|”, wcięcie pokazuje poziom
// ---------------------------------------------------------------------------------------------------------------------

const cell = (t) => String(t ?? '').replace(/\|/g, '¦').replace(/[\r\n]+/g, ' ').trim();

/** Gałąź jako tekst do notatnika (Notepad++ i podobne). */
export function treeToText(nodes, title = '') {
  const base = Math.min(...nodes.map((n) => depthOf(n.lp.trim()) || 0));
  const lines = [
    `# ${title || 'Gałąź operacji'} – edycja w notatniku. Kolumny oddziela znak |, wcięcie pokazuje poziom (nie jest wymagane).`,
    '# Numer: liczba = operacja, + litera = suboperacja, + dwie litery = subsuboperacja. Puste komis i klient = dziedziczone po operacji nadrzędnej.',
    '# Linia zaczynająca się od # jest komentarzem. Usunięcie linii usuwa operację (program pokaże listę zmian przed zapisem).',
    '# ' + TREE_COLUMNS.join(' | '),
  ];
  for (const n of nodes) lines.push('  '.repeat(Math.max(0, (depthOf(n.lp.trim()) || 0) - base)) + FIELDS.map((f) => cell(n[f])).join(' | ').replace(/( \| )+$/, ''));
  return lines.join('\n') + '\n';
}

/**
 * Tekst z notatnika → węzły. Węzeł z tym samym numerem co wcześniej to ta sama operacja; pozostałe nowe linie są parowane po kolei
 * z operacjami, których numer zniknął (zmiana numeru), reszta to nowe operacje. Zwraca {nodes, errors}.
 */
export function textToTree(text, prev = []) {
  const rows = [], errors = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\t/g, ' ').trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length > FIELDS.length) { errors.push(`Linia ${i + 1}: za dużo kolumn (${parts.length}); znak | oddziela kolumny`); return; }
    const r = { line: i + 1 };
    FIELDS.forEach((f, k) => { r[f] = (parts[k] ?? '').replace(/¦/g, '|'); });
    if (!r.lp) { errors.push(`Linia ${i + 1}: brak numeru operacji`); return; }
    rows.push(r);
  });
  const free = prev.filter((p) => !rows.some((r) => r.lp === p.lp.trim()));
  const used = new Set();
  const nodes = rows.map((r) => {
    let p = prev.find((x) => x.lp.trim() === r.lp && !used.has(x.key));
    if (!p) p = free.find((x) => !used.has(x.key));
    if (p) used.add(p.key);
    const { line, ...fields } = r;
    return { key: p ? p.key : newKey(), orig: p ? p.orig : null, line, ...fields };
  });
  return { nodes: sortTree(nodes), errors };
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan zapisu i kontrola logiki
// ---------------------------------------------------------------------------------------------------------------------

const cyclesOf = (ops) => new Set([...computeSchedule(Object.entries(ops).map(([lp, o]) => ({ lp, ...o })), {})].filter(([, r]) => r.state === 'cycle').map(([lp]) => lp));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Plan zapisu gałęzi. [origIds] – numery operacji, które były w gałęzi na początku (puste dla nowego drzewa), [nodes] – stan z okna.
 * Wynik: {errors, warnings, changes (opisy do podglądu), remove (numery do skasowania przed zapisem), sets ([numer, operacja])}.
 */
export function planTree(opsByLp, origIds, nodes, { stations = [], parseNum = (t) => Number(String(t).replace(',', '.')) } = {}) {
  const errors = [], warnings = [], changes = [];
  const where = (n) => (n.line ? `Linia ${n.line}` : `Operacja ${n.lp.trim() || '(bez numeru)'}`);
  const orig = new Set(origIds);
  const ids = nodes.map((n) => n.lp.trim());
  if (!nodes.length && !orig.size) errors.push('Brak operacji do zapisania');
  const seen = new Set();
  for (const n of nodes) {
    const lp = n.lp.trim();
    if (!lp) { errors.push(`${where(n)}: brak numeru`); continue; }
    if (isSyntheticId(lp)) errors.push(`${where(n)}: numery „s” + cyfry są zarezerwowane`);
    else if (!ID_PATTERN.test(lp)) errors.push(`${where(n)}: numer „${lp}” – liczba (operacja), liczba + litera (suboperacja) albo liczba + dwie litery (subsuboperacja)`);
    if (seen.has(lp)) errors.push(`${where(n)}: numer ${lp} powtarza się`);
    seen.add(lp);
    if (opsByLp[lp] && !orig.has(lp)) errors.push(`${where(n)}: numer ${lp} ma już inna operacja w harmonogramie`);
  }
  // usuwane operacje i zmiany numerów
  const kept = new Set(nodes.filter((n) => n.orig).map((n) => n.orig));
  const deleted = [...orig].filter((id) => !kept.has(id) && opsByLp[id]);
  const idMap = new Map(nodes.filter((n) => n.orig && n.orig !== n.lp.trim()).map((n) => [n.orig, n.lp.trim()]));
  // wynik: baza bez starej gałęzi + węzły z okna
  const sim = {};
  for (const [lp, op] of Object.entries(opsByLp)) if (!orig.has(lp)) sim[lp] = op;
  const finalOf = new Map();
  for (const n of nodes) {
    const lp = n.lp.trim(); if (!lp) continue;
    const base = n.orig && opsByLp[n.orig] ? opsByLp[n.orig] : { preds: [] };
    const op = { ...base, element: n.element.trim(), station: n.station.trim(), komis: n.komis.trim(), client: n.client.trim(), preds: n.preds.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean) };
    const h = String(n.hours ?? '').trim();
    if (h) { const v = parseNum(h); if (v == null || !Number.isFinite(v) || v < 0) errors.push(`${where(n)}: czas „${h}” to liczba godzin`); else op.hours = v; } else delete op.hours;
    if (op.preds.length > 4) errors.push(`${where(n)}: najwyżej 4 zależności (Z1–Z4)`);
    if (op.station && stations.length && !stations.includes(op.station)) warnings.push(`${where(n)}: stanowisko „${op.station}” nie jest na liście stanowisk`);
    sim[lp] = op; finalOf.set(n, op);
  }
  // poziomy: rodzic każdego węzła musi istnieć (w oknie albo w harmonogramie poza gałęzią)
  for (const n of nodes) {
    const lp = n.lp.trim(), par = parentLp(lp);
    if (par != null && ID_PATTERN.test(lp) && !sim[par]) errors.push(`${where(n)}: ${depthOf(lp) === 1 ? 'suboperacja' : 'subsuboperacja'} ${lp} wymaga ${depthOf(lp) === 1 ? 'operacji' : 'suboperacji'} ${par}`);
  }
  // odwołania spoza gałęzi: zmienione numery poprawiamy, usuwane blokują zapis
  const refs = [];
  for (const [lp, op] of Object.entries(sim)) {
    if (nodes.some((n) => n.lp.trim() === lp)) continue;
    const preds = op.preds || [];
    const bad = preds.filter((p) => deleted.includes(p));
    if (bad.length) errors.push(`Operacja ${lp} zależy od usuwanej ${bad.join(', ')}; usuń najpierw to powiązanie`);
    if (preds.some((p) => idMap.has(p))) { const fixed = preds.map((p) => idMap.get(p) ?? p); sim[lp] = { ...op, preds: fixed }; refs.push([lp, sim[lp]]); }
  }
  // zależności węzłów z okna
  for (const n of nodes) {
    const lp = n.lp.trim(), op = finalOf.get(n); if (!op) continue;
    const s = new Set();
    for (const p of op.preds) {
      if (s.has(p)) errors.push(`${where(n)}: zależność ${p} wpisana dwa razy`); s.add(p);
      if (p === lp) errors.push(`${where(n)}: operacja nie może zależeć od siebie`);
      else if (!sim[p]) errors.push(`${where(n)}: zależność ${p} – nie ma takiej operacji`);
      else if (isUnder(lp, p)) errors.push(`${where(n)}: zależność ${p} to operacja nadrzędna – tworzy cykl`);
      else if (isUnder(p, lp)) errors.push(`${where(n)}: zależność ${p} to jej własna suboperacja – tworzy cykl`);
    }
  }
  if (!errors.length) {
    const before = cyclesOf(opsByLp), back = new Map([...idMap].map(([a, b]) => [b, a]));
    const fresh = [...cyclesOf(sim)].filter((lp) => !before.has(back.get(lp) ?? lp));
    if (fresh.length) errors.push(`Zależności tworzą cykl (operacje: ${fresh.slice(0, 6).join(', ')})`);
  }
  // opis zmian do podglądu i zapis
  const sets = [], remove = new Set(deleted);
  const LABEL = { element: 'opis', station: 'stanowisko', hours: 'czas', preds: 'zależności', komis: 'komis', client: 'klient' };
  for (const n of nodes) {
    const lp = n.lp.trim(), op = finalOf.get(n); if (!op) continue;
    if (!n.orig) { changes.push(`Nowa ${depthOf(lp) === 0 ? 'operacja' : depthOf(lp) === 1 ? 'suboperacja' : 'subsuboperacja'} ${lp}${op.element ? ' – ' + op.element : ''}`); sets.push([lp, op]); continue; }
    const old = opsByLp[n.orig] || {};
    const diff = Object.keys(LABEL).filter((k) => !same(k === 'preds' ? old.preds || [] : old[k] ?? (k === 'hours' ? undefined : ''), k === 'preds' ? op.preds : op[k] ?? (k === 'hours' ? undefined : '')));
    if (n.orig !== lp) { changes.push(`Zmiana numeru ${n.orig} → ${lp}`); remove.add(n.orig); }
    for (const k of diff) changes.push(`${lp}: ${LABEL[k]} „${k === 'preds' ? (old.preds || []).join(', ') : old[k] ?? ''}” → „${k === 'preds' ? op.preds.join(', ') : op[k] ?? ''}”`);
    if (n.orig !== lp || diff.length) { sets.push([lp, op]); if (opsByLp[lp]) remove.add(lp); }
  }
  for (const id of deleted) changes.push(`Usunięcie ${id}${opsByLp[id].element ? ' – ' + opsByLp[id].element : ''}`);
  for (const [lp, op] of refs) { changes.push(`Poprawione zależności operacji ${lp}: ${op.preds.join(', ')}`); sets.push([lp, op]); }
  return { errors: [...new Set(errors)], warnings, changes, remove: [...remove], sets };
}
