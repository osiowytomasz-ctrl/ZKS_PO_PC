import { h, field, api, toast, confirmBox, modal } from '../ui.js';
import { permissionsSummary } from '../logic/common.js';
import { firebase, resetFirestoreCache } from '../fb.js';
import { defaultRange } from '../logic/grafik.js';
import { holidaysPanel } from './holidays.js';
import { stationsPanel } from './stationsPanel.js';
import { toolLook, setToolLook } from './toolViews.js';
import { themeMode, setThemeMode } from '../theme.js';
import { THEME_MODES, THEME_LABELS } from '../logic/theme.js';
import { invalidateConfirmed } from '../catalog.js';
import { ndImport } from '../ndStore.js';
import { importKartyFromSheet } from '../pomiaryStore.js';
import { importFromSheet as importGrafikFromSheet } from '../grafikStore.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { openGrafikCodes } from './grafikCodes.js';
import { openUsersAdmin } from './usersAdmin.js';
import { accessButton } from './accessAdmin.js';
import { accessMatrixPanel } from './accessMatrixView.js';
import { publishLink, readLinkHistory } from '../linkStore.js';
import { toolroomAccess, toolroomLevelOf, appAccess } from '../logic/toolroomAccess.js';

export async function mountSettings(el, ctx) {
  const cfg = await window.zks.getSettings();
  const url = h('input', { type: 'text', value: cfg.url, placeholder: 'https://script.google.com/macros/s/…/exec', spellcheck: 'false' });
  const key = h('input', { type: 'password', value: cfg.key, placeholder: 'Klucz użytkownika', spellcheck: 'false', autocomplete: 'off' });
  const show = h('input', { type: 'checkbox', onchange: () => { key.type = show.checked ? 'text' : 'password'; } });
  const status = h('div', { class: 'muted', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } });

  // poziom: z zalogowanego użytkownika, a gdy serwer nie odpowiada – ostatnio zapamiętany (żeby administrator z nieaktualnym adresem mógł go poprawić)
  let remembered = 'none'; try { remembered = localStorage.getItem('zks.level') || 'none'; } catch { /* bez pamięci */ }
  const levelNow = ctx.user ? grafikLevelOf(ctx.user) : remembered;
  const acc = appAccess(levelNow);   // zakres Ustawień i adres API wg poziomu z „Grafik dostęp”
  const isAdmin = () => acc.apiLink;
  // adres API widzi i zmienia tylko GOD; reszta go nie widzi (program pobiera go z bazy). Wyjątek: gdy w ogóle nie ma adresu, pole jest potrzebne do pierwszego uruchomienia
  const showUrl = acc.apiLink || !cfg.url;
  // TOURIST (i brak dostępu): w Ustawieniach tylko klucz, jego zatwierdzenie i sekcja aktualizacji
  const limited = !acc.fullSettings;
  // Adres API jest w bazie: zwykły użytkownik go nie wpisuje (program pobiera go sam przy starcie i po błędzie połączenia),
  // zapisuje go administrator (GOD) z programu PC. Pole jest zablokowane tylko, gdy wiemy, że to nie administrator.
  const linkInfo = h('div', { class: 'muted', style: { fontSize: '12px', margin: '2px 0 6px' } });
  const paintLink = async () => {
    let r = null; try { r = await window.zks.remoteLink(); } catch { /* bez połączenia */ }
    const l = r && r.ok ? r.link : null;
    const locked = !!l && !!ctx.user && !isAdmin();
    if (!showUrl) return;
    url.disabled = locked;
    linkInfo.textContent = !r || !r.ok ? 'Adres z bazy: brak połączenia z bazą – używany jest adres zapamiętany w programie.'
      : !l ? 'Adres z bazy: jeszcze nie zapisany. Administrator (GOD) wpisuje go tu raz i zapisuje – potem wszystkie programy pobierają go z bazy.'
      : `Adres z bazy: wersja ${l.ver}, zapisał ${l.updatedBy || '—'}, ${l.updatedAt ? new Date(l.updatedAt).toLocaleString('pl-PL') : ''}. ` + (locked ? 'Program pobiera go automatycznie – nie trzeba nic wpisywać.' : '');
  };
  const save = async () => {
    if (url.value.trim()) {
      const c = await window.zks.checkLink(url.value);
      if (!c.ok) { status.className = 'err'; status.textContent = c.error; throw new Error(c.error); }
      url.value = c.url;
    }
    await window.zks.saveSettings({ url: url.value, key: key.value });
    toast('Zapisano ustawienia');
  };
  const check = async () => {
    try { await save(); } catch { return; }
    status.className = 'muted'; status.textContent = 'Sprawdzanie połączenia…';
    try {
      const user = await ctx.loadUser({ fresh: true });
      if (!user) throw new Error(ctx.userError || 'Brak odpowiedzi.');
      status.className = ''; status.style.color = '#1b5e20';
      const gl = user.grafikLevel ? `${String(user.grafikLevel).toUpperCase()} (z kolumny „Grafik dostęp”)` : `serwer nie podaje poziomu – w Apps Script nie ma nowej wersji Api.gs i Firebase.gs (program przyjmuje ${grafikAccess(grafikLevelOf(user)).label} z kolumny „Grafik”)`;
      status.textContent = `Połączono jako ${user.name || user.email} (${user.email}).\nUprawnienia: ${permissionsSummary(user.permissions)}\nGrafik i Kompetencje: ${gl}`;
      if (isAdmin()) {
        // administrator: poprawny, działający adres zapisujemy w bazie (bez duplikatów) – stąd czytają go wszystkie programy
        try {
          const c = await window.zks.checkLink(url.value);
          const r = await publishLink(c.url, user.name || user.email);
          await window.zks.syncLink(false);
          status.textContent += r.changed ? `\nAdres API zapisany w bazie (wersja ${r.ver}). Inne programy pobiorą go przy starcie.` : `\nAdres API jest już zapisany w bazie (wersja ${r.ver}).`;
        } catch (e2) { status.textContent += '\nNie udało się zapisać adresu w bazie: ' + (e2.code || '') + ' ' + (e2.message || e2); }
      }
      paintLink();
    } catch (e) {
      status.className = 'err'; status.textContent = e.message;
    }
  };

  const speed = h('div', { class: 'muted', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } });
  const fmt = (ms) => (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s');
  const timed = async (fn, args) => { const t = performance.now(); const r = await window.zks.call(fn, args, { timeoutMs: 180000 }); return { ms: performance.now() - t, ok: r.ok, err: r.error, bytes: r.ok ? JSON.stringify(r.data).length : 0 }; };
  const speedTest = async () => {
    await save();
    speed.className = 'muted'; speed.textContent = 'Mierzenie… (kilka sekund)';
    const [s, e] = defaultRange();
    const tests = [['Puste wywołanie (api_whoami), 1', 'api_whoami', []], ['Puste wywołanie (api_whoami), 2', 'api_whoami', []], ['Grafik (getGrData)', 'getGrData', [s, e, 'fresh']]];
    const out = []; const res = {};
    for (const [label, fn, args] of tests) {
      const r = await timed(fn, args); res[label] = r;
      out.push(`${label}: ${r.ok ? fmt(r.ms) + (r.bytes ? `, odpowiedź ${(r.bytes / 1024).toFixed(0)} KB` : '') : 'błąd: ' + r.err}`);
    }
    const floor = Math.min(res['Puste wywołanie (api_whoami), 1'].ms, res['Puste wywołanie (api_whoami), 2'].ms);
    const gr = res['Grafik (getGrData)'];
    out.push('');
    out.push(`Minimalny czas serwera Apps Script (puste wywołanie): ${fmt(floor)}.`);
    if (gr.ok) out.push(`Czas czytania arkusza w Grafiku: ok. ${fmt(Math.max(0, gr.ms - floor))} (reszta to stały narzut serwera).`);
    speed.textContent = out.join('\n');
  };
  const fbOut = h('div', { class: 'muted', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } });
  const fbTest = async () => {
    await save();
    fbOut.className = 'muted'; fbOut.textContent = 'Łączenie z Firebase…';
    try {
      const t0 = performance.now();
      const { sdk, db } = await firebase();
      const t1 = performance.now();
      const ref = sdk.doc(db, 'test', 'ping');
      await sdk.setDoc(ref, { at: Date.now() });
      const t2 = performance.now();
      const snap = await sdk.getDoc(ref);
      const t3 = performance.now();
      fbOut.textContent = `Firebase działa.\nLogowanie: ${fmt(t1 - t0)}\nZapis: ${fmt(t2 - t1)}\nOdczyt: ${fmt(t3 - t2)} (dokument ${snap.exists() ? 'jest' : 'brak'})`;
    } catch (e) {
      fbOut.className = 'muted err'; fbOut.textContent = 'Błąd Firebase: ' + (e.code || '') + ' ' + (e.message || e);
    }
  };
  el.append(h('div', { class: 'panel', style: { maxWidth: '640px', margin: '20px auto' } },
    h('h2', {}, 'Połączenie z serwerem'),
    h('p', { class: 'muted' }, !showUrl ? 'Wpisz swój klucz użytkownika i zatwierdź go. Klucz jest przechowywany w pliku szyfrowanym przez system (gdy system to umożliwia) i jest wysyłany wyłącznie w treści żądania do serwera.' : 'Adres i klucz są te same co w aplikacji na telefonie. Klucz jest przechowywany w pliku szyfrowanym przez system (gdy system to umożliwia) i jest wysyłany wyłącznie w treści żądania do podanego adresu.'),
    showUrl ? field('Adres API (…/exec)', url) : null,
    showUrl ? linkInfo : null,
    isAdmin() ? h('button', { class: 'btn small', style: { marginBottom: '6px' }, title: 'Ostatnie zapisane adresy API (kto i kiedy)', onclick: async () => {
      try { const hist = await readLinkHistory(10); const m = modal('Historia adresów API', h('div', {}, ...(hist.length ? hist.map((x) => h('div', { style: { fontFamily: 'monospace', fontSize: '12px', margin: '4px 0', wordBreak: 'break-all' } }, `v${x.ver} · ${new Date(x.ts).toLocaleString('pl-PL')} · ${x.by || '—'}\n${x.url}`)) : [h('p', {}, 'Brak wpisów.')]), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true }); }
      catch (e) { toast('Nie wczytano historii: ' + (e.message || e), true); } } }, 'Historia adresów') : null,
    field('Klucz użytkownika', key),
    h('label', { class: 'row muted' }, show, 'Pokaż klucz'),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn primary', onclick: check }, 'Zapisz i sprawdź połączenie'),
      limited ? null : h('button', { class: 'btn', title: 'Mierzy czas odpowiedzi serwera dla pustego wywołania, Grafiku i Harmonogramu', onclick: speedTest }, 'Test szybkości'),
      limited ? null : h('button', { class: 'btn', title: 'Sprawdza logowanie i zapis/odczyt w bazie Firebase', onclick: fbTest }, 'Test Firebase'),
      h('button', { class: 'btn', onclick: async () => { await save(); await ctx.loadUser(); ctx.go('home'); } }, 'Zapisz i wróć'),
      h('button', { class: 'btn', title: 'Otwiera stronę z najnowszą wersją aplikacji (plik .exe)', onclick: () => window.zks.openExternal('https://github.com/osiowytomasz-ctrl/ZKS_PO/releases/tag/latest') }, 'Aktualizuj'),
      limited ? null : h('button', { class: 'btn', title: 'Usuwa zapamiętane dane z arkusza (listy, grafik, katalog narzędzi)', onclick: async () => { await window.zks.cacheClear(); toast('Wyczyszczono pamięć podręczną'); } }, 'Wyczyść pamięć podręczną'),
      limited ? null : h('button', { class: 'btn', title: 'Usuwa lokalną kopię bazy Firebase (Grafik, Harmonogram, Kompetencje, Workflow) i przeładowuje program – dane pobiorą się od nowa z serwera. Gdy na tym komputerze brakuje danych, które inni widzą.', onclick: async () => {
        if (!(await confirmBox('Pamięć bazy', 'Usunąć lokalną kopię bazy Firebase na tym komputerze i przeładować program? Dane w bazie zostają; pobiorą się od nowa.', 'Wyczyść i przeładuj'))) return;
        await resetFirestoreCache('ręcznie z Ustawień', true);
      } }, 'Wyczyść pamięć bazy')),
    status, speed, fbOut,
    (paintLink(), null),
    // Dostęp: klucze do programu (administrator) i kody do Grafiku na telefonie (MASTER, GOD)
    !limited && cfg.url && cfg.key && (grafikAccess(grafikLevelOf(ctx.user)).manage) ? h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Dostęp'),
      h('p', { class: 'muted' }, 'Klucze dostępu do programu (PC i Android) nadaje administrator. Kody iPhone – osobiste kody pracowników do Grafiku i Planu do wglądu w przeglądarce telefonu (strona …/exec?p=grafik).'),
      h('div', { class: 'row' },
        grafikLevelOf(ctx.user) === 'god' ? h('button', { class: 'btn', title: 'Konta z zakładki Uzytkownicy: klucze, nowi użytkownicy (tylko administrator)', onclick: () => openUsersAdmin() }, 'Użytkownicy i klucze') : null,
        h('button', { class: 'btn', title: 'Osobiste kody pracowników do Grafiku na telefonie (iPhone, przeglądarka)', onclick: async () => {
          try {
            const { sdk, db } = await firebase();
            const m = await sdk.getDoc(sdk.doc(db, 'gr_meta', 'main'));
            const people = (m.exists() && m.data().people) || [];
            await openGrafikCodes({ people: () => people, user: ctx.user });
          } catch (e) { toast('Kody iPhone: ' + (e.message || e), true); }
        } }, 'Kody iPhone'))) : null,
    !limited && cfg.url && cfg.key ? holidaysPanel() : null,
    !limited && cfg.url && cfg.key ? stationsPanel() : null,
    themePanel(),
    limited ? null : toolLookPanel(toolroomAccess(toolroomLevelOf(ctx.user)).editContours),
    !limited && cfg.url && cfg.key && toolroomAccess(toolroomLevelOf(ctx.user)).editContours ? ndPanel(ctx) : null,
    // Dostęp: poziomy modułów każdego użytkownika – tylko GOD
    !limited && cfg.url && cfg.key && grafikLevelOf(ctx.user) === 'god' ? accessButton(ctx) : null,
    // Uprawnienia – tabela: prawa elementów każdego modułu dla poziomów GOD … PEASANT (tylko GOD)
    !limited && cfg.url && cfg.key && grafikLevelOf(ctx.user) === 'god' ? accessMatrixPanel(ctx) : null,
    // Grafik: import z karty G arkusza (GOD) – wcześniej przycisk w module Grafik
    !limited && cfg.url && cfg.key && grafikAccess(grafikLevelOf(ctx.user)).importG ? h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Grafik'),
      h('p', { class: 'muted' }, 'Grafik zapisuje się w bazie Firebase. Jednorazowy albo awaryjny import z karty G arkusza zastępuje cały grafik w bazie (pracownicy, miejsca pracy, urlopy, kody, komentarze, święta).'),
      h('button', { class: 'btn', title: 'Zastąp grafik w bazie danymi z karty G arkusza (tylko GOD)', onclick: async () => {
        if (!(await confirmBox('Import z arkusza G', 'Grafik w bazie zostanie zastąpiony danymi z karty G (pracownicy, miejsca pracy, urlopy, kody, komentarze, święta). Kontynuować?', 'Importuj'))) return;
        toast('Import z karty G…');
        try { const r = await importGrafikFromSheet((ctx.user && (ctx.user.name || ctx.user.email)) || ''); toast(`Zaimportowano: pracowników ${r.people}, miesięcy ${r.months}, wpisów ${r.cells}, komentarzy ${r.notes}` + (r.holidays ? `, świąt ${r.holidays}` : '')); }
        catch (e) { toast('Import nieudany: ' + (e.code === 'permission-denied' ? 'brak uprawnień (reguły Firestore)' : e.message || e), true); }
      } }, 'Import Grafiku z karty G')) : null,
    // Pomiary: karty są w bazie Firebase; jednorazowe przeniesienie dawnych kart z arkusza „Karty pomiarowe” (GOD)
    !limited && cfg.url && cfg.key && grafikLevelOf(ctx.user) === 'god' ? h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Pomiary'),
      h('p', { class: 'muted' }, 'Karty pomiaru zapisują się w bazie Firebase (bez arkusza). Dawne karty z arkusza „Karty pomiarowe” można raz przenieść do bazy.'),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmBox('Pomiary', 'Przenieść wszystkie karty z arkusza „Karty pomiarowe” do bazy? Karty już przeniesione zostaną nadpisane danymi z arkusza; karty zapisane w programie zostają.', 'Przenieś'))) return;
        try { toast('Przeniesiono kart: ' + (await importKartyFromSheet(ctx.user && ctx.user.email))); } catch (e) { toast('Nie przeniesiono: ' + (e.message || e), true); }
      } }, 'Przenieś karty z arkusza do bazy')) : null,
    h('p', { class: 'muted' }, window.zks ? '' : '')));
}

/** Narzędziownia – dane konturów w bazie Firebase (MASTER / GOD): przesłanie z arkusza (PSWT D:N, BH/BC/BE, „kontury”, ND_CACHE V). */
function ndPanel(ctx) {
  const info = h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Sprawdzanie bazy…');
  const show = async () => {
    try {
      const { sdk, db } = await firebase();
      const m = await sdk.getDoc(sdk.doc(db, 'nd_meta', 'main'));
      info.textContent = m.exists() ? `W bazie: ${m.data().count || 0} narzędzi, przesłane ${new Date(m.data().updatedAt || 0).toLocaleString('pl-PL')}${m.data().updatedBy ? ' (' + m.data().updatedBy + ')' : ''}.` : 'W bazie nie ma jeszcze danych konturów – program czyta je z arkusza.';
    } catch (e) { info.textContent = 'Baza niedostępna: ' + (e.message || e); }
  };
  const btn = h('button', { class: 'btn', onclick: async () => {
    btn.disabled = true; info.textContent = 'Przesyłanie z arkusza do bazy…';
    try { const n = await ndImport({ user: (ctx.user && (ctx.user.name || ctx.user.email)) || '' }); invalidateConfirmed(); toast(`Przesłano dane ${n} narzędzi`); } catch (e) { toast('Nie przesłano: ' + (e.message || e), true); }
    btn.disabled = false; show();
  } }, 'Prześlij dane konturów z arkusza do bazy');
  show();
  return h('div', { style: { marginTop: '10px' } }, h('h3', {}, 'Narzędziownia – dane konturów w bazie'),
    h('p', { class: 'muted', style: { margin: '2px 0' } }, 'Program czyta parametry narzędzi (PSWT D:N), zatwierdzone kontury (BH, BC, BE), mocowania („kontury”) i kontury robocze (ND_CACHE V) z bazy Firebase, a kontury liczy sam. Zatwierdzenia w programie trafiają do arkusza i od razu do bazy. Zmiany wpisane wprost w arkuszu przechodzą do bazy tym przyciskiem albo same raz na dobę (przy otwarciu narzędziowni przez MASTER / GOD).'),
    btn, info);
}

/** Motyw kolorystyczny tego komputera: jasny, ciemny albo zgodny z systemem (Windows – Personalizacja → Kolory). */
function themePanel() {
  const sel = h('select', { onchange: () => { setThemeMode(sel.value); toast(`Motyw: ${THEME_LABELS[sel.value]}`); } },
    ...THEME_MODES.map((m) => h('option', { value: m, selected: m === themeMode() }, THEME_LABELS[m])));
  return h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Motyw kolorystyczny (ten komputer)'),
    h('label', { class: 'row', style: { gap: '8px' } }, 'Wygląd programu:', sel),
    h('p', { class: 'muted', style: { margin: '2px 0 0' } }, 'Ciemny motyw zmienia tła i tekst; kolory znaczące (operacje, lokalizacje, stany, gradienty) zostają jak w jasnym. Szybka zmiana: przycisk ◐ / ☀ / ☾ w górnym pasku.'));
}

/** Narzędziownia – wygląd na tym komputerze: ramka w kolorze lokalizacji (kolory stanowisk wyżej), poświata (glow) i jej kolor. */
function toolLookPanel(isGod = false) {
  const look = toolLook();
  const frame = h('input', { type: 'checkbox', checked: look.frame, onchange: () => setToolLook({ frame: frame.checked }) });
  const gen = h('input', { type: 'checkbox', checked: look.gen, onchange: () => { setToolLook({ gen: gen.checked }); invalidateConfirmed(); toast(gen.checked ? 'Kontury z wewnętrznego generatora – otwórz moduł narzędziowni ponownie' : 'Kontury z kolumny T'); } });
  const glow = h('input', { type: 'checkbox', checked: look.glow, onchange: () => setToolLook({ glow: glow.checked }) });
  const locG = h('input', { type: 'checkbox', checked: look.glowColor === 'loc', onchange: () => { color.disabled = locG.checked; setToolLook({ glowColor: locG.checked ? 'loc' : color.value }); } });
  const color = h('input', { type: 'color', value: look.glowColor === 'loc' ? '#00c853' : look.glowColor, disabled: look.glowColor === 'loc', style: { width: '40px', height: '24px', padding: 0, border: 0 },
    oninput: () => setToolLook({ glowColor: color.value }) });
  return h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Narzędziownia – wygląd (ten komputer)'),
    h('p', { class: 'muted' }, 'Kolor lokalizacji narzędzia bierze się z kolorów stanowisk (Union – 2Un, Correa – 3Co, Schiess – 1Si, Narzędziownia – Narz; pozostałe – kolory domyślne).'),
    h('label', { class: 'row', style: { gap: '6px' } }, frame, 'Ramka w kolorze lokalizacji (wiersze i kafelki narzędzi)'),
    h('label', { class: 'row', style: { gap: '6px' } }, glow, 'Poświata (glow) wokół narzędzia'),
    h('div', { class: 'row', style: { gap: '6px', marginLeft: '22px' } }, h('label', { class: 'row', style: { gap: '4px' } }, locG, 'w kolorze lokalizacji'), h('span', { class: 'muted' }, 'albo kolor:'), color),
    ...(isGod ? [
      h('h3', { style: { marginTop: '12px' } }, 'Narzędziownia – kontury narzędzi (ten komputer)'),
      h('label', { class: 'row', style: { gap: '6px' } }, gen, 'Kontury z wewnętrznego generatora (PSWT D:N + zakładka „kontury”) zamiast kolumny T arkusza ND_CACHE'),
      h('p', { class: 'muted', style: { margin: '2px 0 0 22px' } }, 'Kolejność: zatwierdzony kontur (PSWT BC) → roboczy (ND_CACHE V) → generator; gdy generator nie ma reguły dla narzędzia – kolumna T. Dotyczy ToolBuildera, Assem.Tool, Części i Konturów; zmiana działa po ponownym otwarciu modułu. Kontury z generatora poprawia się w Konturach i zatwierdza.')] : [h('p', { class: 'muted', style: { marginTop: '12px' } }, 'Kontury narzędzi: wewnętrzny generator jest włączony na stałe (wyłączyć może tylko GOD).')]));
}
