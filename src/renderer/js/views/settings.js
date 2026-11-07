import { h, field, api, toast } from '../ui.js';
import { permissionsSummary } from '../logic/common.js';

export async function mountSettings(el, ctx) {
  const cfg = await window.zks.getSettings();
  const url = h('input', { type: 'text', value: cfg.url, placeholder: 'https://script.google.com/macros/s/…/exec', spellcheck: 'false' });
  const key = h('input', { type: 'password', value: cfg.key, placeholder: 'Klucz użytkownika', spellcheck: 'false', autocomplete: 'off' });
  const show = h('input', { type: 'checkbox', onchange: () => { key.type = show.checked ? 'text' : 'password'; } });
  const status = h('div', { class: 'muted', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } });

  const save = async () => {
    await window.zks.saveSettings({ url: url.value, key: key.value });
    toast('Zapisano ustawienia');
  };
  const check = async () => {
    await save();
    status.className = 'muted'; status.textContent = 'Sprawdzanie połączenia…';
    try {
      const user = await ctx.loadUser();
      if (!user) throw new Error(ctx.userError || 'Brak odpowiedzi.');
      status.className = ''; status.style.color = '#1b5e20';
      status.textContent = `Połączono jako ${user.name || user.email} (${user.email}).\nUprawnienia: ${permissionsSummary(user.permissions)}`;
    } catch (e) {
      status.className = 'err'; status.textContent = e.message;
    }
  };

  el.append(h('div', { class: 'panel', style: { maxWidth: '640px', margin: '20px auto' } },
    h('h2', {}, 'Połączenie z serwerem'),
    h('p', { class: 'muted' }, 'Adres i klucz są te same co w aplikacji na telefonie. Klucz jest przechowywany w pliku szyfrowanym przez system (gdy system to umożliwia) i jest wysyłany wyłącznie w treści żądania do podanego adresu.'),
    field('Adres API (…/exec)', url),
    field('Klucz użytkownika', key),
    h('label', { class: 'row muted' }, show, 'Pokaż klucz'),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn primary', onclick: check }, 'Zapisz i sprawdź połączenie'),
      h('button', { class: 'btn', onclick: async () => { await save(); await ctx.loadUser(); ctx.go('home'); } }, 'Zapisz i wróć')),
    status,
    h('p', { class: 'muted' }, window.zks ? '' : '')));
}
