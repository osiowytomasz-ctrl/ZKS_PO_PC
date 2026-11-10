// Import danych wejściowych Harmonogramu z pliku wyeksportowanego z Arkuszy Google (TSV albo CSV).
// Czytane są TYLKO kolumny wpisywane ręcznie; kolumny wyliczane (start i koniec z formuł, końce poprzedników, klucz „Stat.”) są pomijane,
// bo program liczy je sam (logic/schedule.js).
//
// Kolumny (od A): A numer operacji, B–E poprzedniki Z1–Z4, F klient, G komis, H opis, J start ręczny (sztywny termin), K czas [h],
// L koniec ręczny (rzeczywisty), R termin zakończenia (wysyłka), T status („zak.”, „ocz”…), X dostawa materiału, AB stanowisko.

const COL = { lp: 0, z: [1, 2, 3, 4], client: 5, komis: 6, element: 7, startManual: 9, hours: 10, endManual: 11, wysylka: 17, status: 19, dostawa: 23, station: 27 };

/** Rozdziela tekst na wiersze i komórki (RFC 4180: cudzysłowy, podwójny cudzysłów, nowe linie w komórkach). Separator: tabulator, średnik albo przecinek. */
export function parseDelimited(text, delimiter) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const delim = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [], cell = '', quoted = false, i = 0;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === delim) { endCell(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

/** Najczęstszy separator w pierwszych liniach poza cudzysłowami. */
export function detectDelimiter(src) {
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let quoted = false, lines = 0;
  for (const ch of src) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted) { if (ch in counts) counts[ch]++; if (ch === '\n' && ++lines >= 12) break; }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Data „dd.MM.rrrr”, z godziną „GG:MM” albo samą godziną („07.02.2027  6”); także „rrrr-MM-dd”. Zwraca ms (czas lokalny jako UTC) albo null. */
export function parseDateTime(value) {
  const t = String(value ?? '').trim();
  if (!t) return null;
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?)?$/.exec(t);
  let y, mo, d, h = 0, mi = 0;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; h = m[4] ? +m[4] : 0; mi = m[5] ? +m[5] : 0; }
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?)?$/.exec(t))) { y = +m[1]; mo = +m[2]; d = +m[3]; h = m[4] ? +m[4] : 0; mi = m[5] ? +m[5] : 0; }
  else return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && h < 24 && mi < 60 ? ms : null;
}

/** Liczba z przecinkiem lub kropką dziesiętną; puste lub nieliczbowe = null. */
export function parseNumber(value) {
  const t = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!t || !/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * Operacje z pliku. Wiersz jest operacją, gdy ma numer (liczba w kolumnie A) i opis albo stanowisko.
 * Zwraca { operations, warnings }: ostrzeżenia dotyczą powtórzonych numerów, poprzedników, których nie ma w pliku, godzin i dat nie do odczytania.
 */
export function importOperations(text) {
  const rows = parseDelimited(text);
  const ops = [], warnings = [];
  const seen = new Map();
  rows.forEach((r, idx) => {
    const lp = String(r[COL.lp] ?? '').trim();
    if (!/^\d+$/.test(lp)) return;
    const station = String(r[COL.station] ?? '').trim();
    const element = String(r[COL.element] ?? '').trim();
    if (!station && !element) return;
    const line = idx + 1;
    const cell = (i) => String(r[i] ?? '').trim();
    const dates = {};
    for (const [key, i] of [['startManual', COL.startManual], ['endManual', COL.endManual], ['wysylka', COL.wysylka], ['dostawa', COL.dostawa]]) {
      const raw = cell(i);
      dates[key] = parseDateTime(raw);
      if (raw && dates[key] == null) warnings.push(`Wiersz ${line}, operacja ${lp}: nie rozpoznano daty „${raw}” (${key}).`);
    }
    const hoursRaw = cell(COL.hours);
    const hours = parseNumber(hoursRaw);
    if (hoursRaw && hours == null) warnings.push(`Wiersz ${line}, operacja ${lp}: nie rozpoznano czasu „${hoursRaw}”.`);
    if (hours != null && hours < 0) warnings.push(`Wiersz ${line}, operacja ${lp}: ujemny czas.`);
    if (!station) warnings.push(`Wiersz ${line}, operacja ${lp}: brak stanowiska.`);
    if (seen.has(lp)) warnings.push(`Wiersz ${line}: numer operacji ${lp} powtórzony (poprzednio w wierszu ${seen.get(lp)}). W obliczeniach liczy się pierwsza.`);
    else seen.set(lp, line);
    ops.push({
      lp, preds: COL.z.map(cell).filter(Boolean), client: cell(COL.client), komis: cell(COL.komis), element, station, hours,
      startManual: dates.startManual, endManual: dates.endManual, wysylka: dates.wysylka, dostawa: dates.dostawa, status: cell(COL.status),
    });
  });
  const known = new Set(ops.map((o) => o.lp));
  for (const o of ops) for (const p of o.preds) if (!known.has(p)) warnings.push(`Operacja ${o.lp}: poprzednik ${p} nie występuje w pliku.`);
  if (!ops.length) warnings.push('Nie znaleziono żadnych operacji (oczekiwane kolumny: A numer, H opis, AB stanowisko).');
  return { operations: ops, warnings };
}

/**
 * Operacje z odpowiedzi API getHarmData (wiersze arkusza od wiersza 14, pod nagłówkami). Do bazy trafiają WYŁĄCZNIE suche dane tekstowe
 * z kolumn A–H, J–L, R, X i AB: numer (A), poprzedniki (B–E), klient (F), komis (G), opis (H), start ręczny (J), godziny (K),
 * koniec ręczny (L), zakończenie/wysyłka (R), dostawa (X), stanowisko (AB). Kolumny wyliczane (I, M, S, T…) i kolory/czcionki nie są brane.
 */
export function opsFromSheetRows(rows) {
  const ops = [], warnings = [], seen = new Set();
  for (const r of rows || []) {
    const station = String(r.stanowisko ?? '').trim(), element = String(r.element ?? '').trim();
    if (!station && !element && !String(r.komis ?? '').trim()) continue;
    // Operacje zakończone często nie mają numeru w kolumnie A: dostają numer techniczny „s<wiersz arkusza>”.
    let lp = String(r.lp ?? '').trim();
    if (!lp) { if (r.rowIndex == null) continue; lp = 's' + r.rowIndex; }
    if (!/^(\d+|s\d+)$/.test(lp)) { warnings.push(`Pominięto wiersz z numerem „${lp}” (oczekiwana liczba).`); continue; }
    if (seen.has(lp)) { warnings.push(`Numer operacji ${lp} powtórzony (liczy się pierwsza).`); continue; }
    seen.add(lp);
    const dt = (key) => { const raw = String(r[key] ?? '').trim(); const v = parseDateTime(raw); if (raw && v == null) warnings.push(`Operacja ${lp}: nie rozpoznano daty „${raw}” (${key}).`); return v; };
    const hoursRaw = String(r.godziny ?? '').trim(), hours = parseNumber(hoursRaw);
    if (hoursRaw && hours == null) warnings.push(`Operacja ${lp}: nie rozpoznano czasu „${hoursRaw}”.`);
    ops.push({
      lp, preds: [r.z1, r.z2, r.z3, r.z4].map((x) => String(x ?? '').trim()).filter(Boolean), client: String(r.client ?? '').trim(),
      komis: String(r.komis ?? '').trim(), element, station, hours, startManual: dt('startManual'), endManual: dt('endManual'),
      wysylka: dt('wysylka'), dostawa: dt('dostawa'),
    });
  }
  const known = new Set(ops.map((o) => o.lp));
  for (const o of ops) for (const p of o.preds) if (!known.has(p)) warnings.push(`Operacja ${o.lp}: poprzednik ${p} nie występuje w danych.`);
  if (!ops.length) warnings.push('Nie znaleziono żadnych operacji.');
  return { operations: ops, warnings };
}
