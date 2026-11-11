// Pobieranie z wyprzedzeniem i odświeżanie w tle: Grafik ma być gotowy, zanim użytkownik w niego wejdzie (Harmonogram jest w Firebase).
// Najwolniejszy jest serwer (Apps Script), więc ukrywamy jego czas, a nie próbujemy go skracać po stronie aplikacji.
import { apiCached } from './ui.js';
import { defaultRange } from './logic/grafik.js';

export const GR_MAX_AGE = 30000;      // dane Grafiku młodsze niż 30 s są świeże (można edytować od razu)
export const HARM_MAX_AGE = 120000;   // Harmonogram jest tylko do odczytu
const INTERVAL_MS = 90000;            // odświeżanie w tle co 90 s, gdy okno jest widoczne
let timer = null;
let lastRun = 0;

/** Rozgrzewa pamięć podręczną Grafiku (domyślny zakres). Błędy są ciche; wspólne wywołanie w toku nie dubluje zapytań. */
export function prefetchHot(canGrafik = true) {
  lastRun = Date.now();
  const quiet = (p) => p.catch(() => {});
  if (canGrafik) { const [s, e] = defaultRange(); quiet(apiCached('getGrData', [s, e], () => {}, { maxAge: GR_MAX_AGE / 2, silent: true })); }
}

/** Start po zalogowaniu: pierwsze pobranie od razu, potem co 90 s i po powrocie do okna (najwyżej raz na 20 s). */
export function startBackgroundRefresh(getCanGrafik) {
  stopBackgroundRefresh();
  prefetchHot(getCanGrafik());
  timer = setInterval(() => { if (document.visibilityState === 'visible') prefetchHot(getCanGrafik()); }, INTERVAL_MS);
  window.addEventListener('focus', onFocus);
  function onFocus() { if (Date.now() - lastRun > 20000) prefetchHot(getCanGrafik()); }
  startBackgroundRefresh._off = () => window.removeEventListener('focus', onFocus);
}
export function stopBackgroundRefresh() {
  if (timer) clearInterval(timer);
  timer = null;
  if (startBackgroundRefresh._off) { startBackgroundRefresh._off(); startBackgroundRefresh._off = null; }
}
