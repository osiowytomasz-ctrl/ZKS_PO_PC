// Skrzynka donosów i pochwał (żartobliwa): gotowe formuły, punkty autora i ranking „Walka o donosiciela”. Czyste funkcje – testy: test/skrzynka.test.js.
// Dane w Firestore: skrzynka/{rrrr-mm} = { e: { id: zgłoszenie } } (czyta tylko MASTER i GOD, dopisuje każdy zalogowany),
//                   skrzynka_punkty/{uid} = { name, total, donosy, pochwaly, months: { 'rrrr-mm': { pts, donosy, pochwaly } }, days: { 'rrrr-mm-dd': liczba } }.

export const DAILY_LIMIT = 5;   // za tyle zgłoszeń dziennie dostaje się punkty (reszta – tylko satysfakcja)

/** Gotowe formuły. {cel} zastępuje wybraną osobę; zdania bez form rodzaju („zgłaszam:”, „sprawa:”), żeby pasowały do każdego. pts – punkty autora. */
export const FORMULAS = [
  // donosy – od drobnych do kryminalnych
  { id: 'd1', kind: 'donos', level: 'drobny', pts: 2, text: 'Zgłaszam: {cel} i ostatni pączek – pączka już nie ma, świadków brak.' },
  { id: 'd2', kind: 'donos', level: 'drobny', pts: 2, text: 'Sygnalizuję: {cel} przy ekspresie dłużej, niż przewiduje norma czasowa.' },
  { id: 'd3', kind: 'donos', level: 'drobny', pts: 2, text: 'Sprawa {cel}: nakrętka odkręcona, przykręcić zapomniano. Tak się nie robi.' },
  { id: 'd4', kind: 'donos', level: 'średni', pts: 3, text: 'Donoszę: klucz 17 u {cel}, na tablicy pusto. Poszukiwany żywy lub odłożony.' },
  { id: 'd5', kind: 'donos', level: 'średni', pts: 3, text: 'Trociny na podłodze, a {cel} twierdzi, że to nie jego sprawa. Mamy zdjęcia.' },
  { id: 'd6', kind: 'donos', level: 'średni', pts: 3, text: 'Z cichego źródła: cudza kawa wypita, a w kuchni ślad po {cel}. Sprawa jest w toku.' },
  { id: 'd7', kind: 'donos', level: 'średni', pts: 3, text: 'Maszyna uruchomiona na zimno, {cel} udaje, że tak miało być.' },
  { id: 'd8', kind: 'donos', level: 'ciężki', pts: 4, text: 'Zbieramy dowody: miejsce mistrza zajęte, trop prowadzi do {cel}. Już po raz drugi.' },
  { id: 'd9', kind: 'donos', level: 'ciężki', pts: 4, text: 'Poprawka w programie bez słowa „przepraszam”. Podejrzany: {cel}.' },
  { id: 'd10', kind: 'donos', level: 'ciężki', pts: 4, text: '{cel}: „to tylko pięć minut”. Minęły trzy godziny. Nie wierzcie temu człowiekowi.' },
  { id: 'd11', kind: 'donos', level: 'kryminał', pts: 5, text: 'Alarm: ostatnia płytka zniknęła „na czarną godzinę”, trop prowadzi do {cel}. Śledztwo trwa.' },
  { id: 'd12', kind: 'donos', level: 'kryminał', pts: 5, text: 'Wiadomo, gdzie jest brakujący kod QR – wie {cel} i milczy jak grób.' },
  // pochwały
  { id: 'p1', kind: 'pochwala', level: 'miła', pts: 1, text: 'Dzień uratowany dzięki {cel} – nawet o tym nie wie.' },
  { id: 'p2', kind: 'pochwala', level: 'miła', pts: 1, text: 'Narzędzie odłożone na miejsce przez {cel}. Cud nad Wisłą.' },
  { id: 'p3', kind: 'pochwala', level: 'serdeczna', pts: 2, text: 'Maszyna wyczyszczona, zanim ktokolwiek kazał – robota {cel}. Szacun.' },
  { id: 'p4', kind: 'pochwala', level: 'serdeczna', pts: 2, text: 'Kawa dla całej zmiany od {cel}. Proponuję stanowisko dyrektora do spraw kofeiny.' },
  { id: 'p5', kind: 'pochwala', level: 'serdeczna', pts: 2, text: 'Pomiarówka pożyczona od {cel} i oddana w komplecie. Takich ludzi już nie robią.' },
  { id: 'p6', kind: 'pochwala', level: 'wzruszająca', pts: 3, text: 'Błąd w programie znaleziony przed pierwszym detalem – dzięki {cel}. Order Uśmiechu!' },
  { id: 'p7', kind: 'pochwala', level: 'wzruszająca', pts: 3, text: 'Zlecenie uratowane przez {cel} i nikt nie szukał winnych. Łezka się kręci.' },
];
export const KINDS = { donos: { label: 'Donos', icon: '🕵️', title: 'Donosy' }, pochwala: { label: 'Pochwała', icon: '👏', title: 'Pochwały' } };
export const formulaById = (id) => FORMULAS.find((f) => f.id === id) || null;
/** Treść formuły dla osoby [cel] (puste – „ktoś”). */
export const fillFormula = (f, cel) => String(f.text).replace(/\{cel\}/g, String(cel || '').trim() || 'ktoś');

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const dayKey = (d = new Date()) => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
const norm = (s) => String(s || '').trim().toLowerCase();

/** Zgłoszenie do zapisu albo { error }: formuła i cel są wymagane; nie można zgłaszać siebie. */
export function makeEntry({ formulaId, target, extra = '', by, uid, now = Date.now() }) {
  const f = formulaById(formulaId);
  if (!f) return { error: 'Wybierz gotową formułę.' };
  if (!String(target || '').trim()) return { error: 'Wskaż osobę, której dotyczy zgłoszenie.' };
  if (norm(target) === norm(by)) return { error: f.kind === 'donos' ? 'Donos na samego siebie? To już nie donos, tylko spowiedź. Wybierz kogoś innego.' : 'Chwalenie samego siebie jest zabronione (nawet w skrzynce).' };
  const text = fillFormula(f, target) + (String(extra).trim() ? ' Dopisek: ' + String(extra).trim().slice(0, 200) : '');
  return { entry: { id: `${now.toString(36)}_${String(uid || '').slice(0, 6)}`, kind: f.kind, formula: f.id, level: f.level, pts: f.pts, target: String(target).trim(), text, by: String(by || ''), uid: String(uid || ''), at: now } };
}

/** Nowy stan punktów autora po zgłoszeniu [entry]; punkty tylko za pierwsze [DAILY_LIMIT] zgłoszeń dnia. Wynik: { doc, gained, limited }. */
export function applyPoints(prev, entry, name, d = new Date(entry.at)) {
  const doc = JSON.parse(JSON.stringify(prev || {}));
  doc.name = String(name || doc.name || '');
  doc.total = doc.total || 0; doc.donosy = doc.donosy || 0; doc.pochwaly = doc.pochwaly || 0; doc.months = doc.months || {}; doc.days = doc.days || {};
  const mk = monthKey(d), dk = dayKey(d);
  const today = doc.days[dk] || 0, limited = today >= DAILY_LIMIT, gained = limited ? 0 : entry.pts;
  doc.days[dk] = today + 1;
  // dni starsze niż 40 dni są usuwane z licznika (dokument ma zostać mały)
  for (const k of Object.keys(doc.days)) if (new Date(k).getTime() < d.getTime() - 40 * 86400000) delete doc.days[k];
  const m = doc.months[mk] = doc.months[mk] || { pts: 0, donosy: 0, pochwaly: 0 };
  m.pts += gained; doc.total += gained;
  if (entry.kind === 'donos') { m.donosy++; doc.donosy++; } else { m.pochwaly++; doc.pochwaly++; }
  return { doc, gained, limited };
}

/** Tytuły w rankingu „Walka o donosiciela” (miejsca od 1). */
export const TITLES = ['Donosiciel Miesiąca 🏆', 'Wicedonosiciel 🥈', 'Młodszy kapuś 🥉', 'Agent w trakcie szkolenia', 'Podejrzany o uczynność', 'Szara eminencja', 'Nowicjusz skrzynki'];
export const titleFor = (rank, pts) => (pts <= 0 ? 'Jeszcze nic nie zgłosił – podejrzanie spokojny' : TITLES[Math.min(rank, TITLES.length) - 1]);

/**
 * Ranking: [docs] = skrzynka_punkty; [month] – 'rrrr-mm' (liczone punkty miesiąca) albo null (razem). Sortowanie: punkty, potem donosy, potem nazwisko.
 * Wynik: [{ rank, name, pts, donosy, pochwaly, title }].
 */
export function ranking(docs, month = null) {
  const rows = (docs || []).map((d) => {
    const m = month ? ((d.months || {})[month] || { pts: 0, donosy: 0, pochwaly: 0 }) : { pts: d.total || 0, donosy: d.donosy || 0, pochwaly: d.pochwaly || 0 };
    return { name: d.name || '—', pts: m.pts || 0, donosy: m.donosy || 0, pochwaly: m.pochwaly || 0 };
  }).filter((r) => r.pts > 0 || r.donosy > 0 || r.pochwaly > 0);
  rows.sort((a, b) => b.pts - a.pts || b.donosy - a.donosy || a.name.localeCompare(b.name, 'pl'));
  return rows.map((r, i) => ({ ...r, rank: i + 1, title: titleFor(i + 1, r.pts) }));
}
