import { h, clear, field, api, apiCached, toast, alertBox, confirmBox } from '../ui.js';
import { resolveCode, filterCodes, parseQuantity, LOCK_SECONDS } from '../logic/scanner.js';

export function mountScanner(el, ctx) {
  let codes = [];
  let timer = null;
  let stream = null;

  const code = h('input', { type: 'text', placeholder: 'Kod produktu (zeskanuj lub wpisz)', autocomplete: 'off', spellcheck: 'false' });
  const qty = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Ilość', value: '1' });
  const sugg = h('div', { class: 'opts', style: { maxHeight: '180px', background: '#fff' } });
  const msg = h('div', { style: { margin: '8px 0', whiteSpace: 'pre-wrap' } });
  const save = h('button', { class: 'btn primary', onclick: submit }, 'Zapisz');
  const video = h('video', { style: { width: '100%', maxHeight: '300px', background: '#000', display: 'none' }, muted: true, playsinline: true });
  const camBtn = h('button', { class: 'btn', onclick: toggleCamera }, 'Skanuj kamerą');

  const redraw = () => {
    clear(sugg);
    const list = code.value.trim() && codes.includes(code.value.trim()) ? [] : filterCodes(code.value, codes);
    sugg.style.display = list.length ? '' : 'none';
    for (const s of list.slice(0, 500)) sugg.append(h('div', { style: { padding: '3px 6px', cursor: 'pointer', borderBottom: '1px solid #eee' }, onclick: () => { code.value = s; redraw(); qty.focus(); qty.select(); } }, s));
  };
  code.addEventListener('input', redraw);
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const r = resolveCode(code.value, codes); if (r) code.value = r; redraw(); qty.focus(); qty.select(); } });
  qty.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  async function submit() {
    msg.className = ''; msg.textContent = '';
    const resolved = resolveCode(code.value, codes);
    if (!code.value.trim()) { msg.className = 'err'; msg.textContent = 'Podaj kod produktu.'; return; }
    if (!resolved) { msg.className = 'err'; msg.textContent = 'Tego kodu nie ma na liście produktów.'; return; }
    const q = parseQuantity(qty.value);
    if (!q) { msg.className = 'err'; msg.textContent = 'Nieprawidłowa ilość (musi być większa od zera).'; return; }
    if (!(await confirmBox('Potwierdzić pobranie?', `Kod: ${resolved}\nIlość: ${q}`, 'Zapisz'))) return;
    save.disabled = true;
    try {
      const r = await api('processForm', [{ productCode: resolved, quantity: q }]);
      msg.className = ''; msg.style.color = '#1b5e20';
      msg.textContent = (r && r.message && String(r.message).trim()) || 'Zapisano.';
      code.value = ''; qty.value = '1'; redraw(); lock();
      return;
    } catch (e) {
      // Przy braku sieci nie wiadomo, czy serwer zdążył zapisać; nie ponawiamy po cichu.
      const hint = e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Sprawdź arkusz, zanim spróbujesz ponownie.' : '';
      msg.className = 'err'; msg.style.color = ''; msg.textContent = 'Błąd: ' + e.message + hint;
    }
    save.disabled = false;
  }

  function lock() {
    let left = LOCK_SECONDS;
    const tick = () => {
      if (left <= 0) { save.disabled = false; save.textContent = 'Zapisz'; return; }
      save.textContent = `Zapisz (${left} s)`; left -= 1; timer = setTimeout(tick, 1000);
    };
    save.disabled = true; tick();
  }

  async function toggleCamera() {
    if (stream) { stopCamera(); return; }
    if (!('BarcodeDetector' in window)) { toast('Ta wersja nie obsługuje skanowania kamerą. Użyj skanera USB lub wpisz kod.', true); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (e) { toast('Brak dostępu do kamery.', true); return; }
    video.srcObject = stream; video.style.display = 'block'; await video.play(); camBtn.textContent = 'Zatrzymaj kamerę';
    const detector = new BarcodeDetector();
    const loop = async () => {
      if (!stream) return;
      try {
        const found = await detector.detect(video);
        if (found.length) {
          const raw = found[0].rawValue;
          const r = resolveCode(raw, codes);
          code.value = r || raw; redraw(); stopCamera(); qty.focus(); qty.select(); return;
        }
      } catch (e) { /* kolejna próba */ }
      setTimeout(loop, 250);
    };
    loop();
  }
  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; video.srcObject = null; video.style.display = 'none'; camBtn.textContent = 'Skanuj kamerą';
  }

  el.append(h('div', { class: 'panel', style: { maxWidth: '560px', margin: '20px auto' } },
    h('h2', {}, 'Skaner – pobranie części'),
    h('p', { class: 'muted' }, 'Zeskanuj kod (skaner USB działa jak klawiatura i kończy Enterem) albo wpisz go. Serwer zmniejszy stan w arkuszu i doda wiersz do ZP.'),
    field('Kod produktu', code), sugg, field('Ilość', qty), video, msg,
    h('div', { class: 'row' }, save, camBtn)));
  code.focus();

  apiCached('getProductCodes', [], (list) => { codes = (list || []).filter((c) => String(c).trim()); redraw(); })
    .catch((e) => { msg.className = 'err'; msg.textContent = 'Nie wczytano listy kodów: ' + e.message; });

  return () => { clearTimeout(timer); stopCamera(); };
}
