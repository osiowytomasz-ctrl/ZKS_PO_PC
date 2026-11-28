// Ustawia motyw zanim ekran się narysuje (bez błysku jasnego tła). Ta sama zasada co logic/theme.js; plik klasyczny, bo CSP nie dopuszcza skryptów w treści strony.
(function () {
  var mode = 'light';
  try { mode = localStorage.getItem('zks.theme') || 'light'; } catch (e) { /* bez pamięci */ }
  var dark = mode === 'dark' || (mode === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  var t = dark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.colorScheme = t;
})();
