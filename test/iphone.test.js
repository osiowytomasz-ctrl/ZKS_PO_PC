// Wersja na iPhone'a: zastępnik window.zks (zapytania do API, adres z bazy, samonaprawa) i BarcodeDetector na bazie ZXing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createZks, checkLink, shouldAdopt } from '../iphone/shim.js';
import { makeDetectorClass, installBarcodeDetector } from '../iphone/barcode-shim.js';

const GOOD = 'https://script.google.com/macros/s/AKfycbyAAAAAAAAAAAAAAAAAAAAAAAAAA/exec';
const NEW = 'https://script.google.com/macros/s/BBBBBBBBBBBBBBBBBBBBBBBBBBBBB/exec';
const mem = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, dump: () => m }; };
const json = (o, status = 200) => ({ ok: status === 200, status, json: async () => o, text: async () => JSON.stringify(o) });

test('wywołanie API: klucz w treści (nie w adresie), nagłówek bez zapytania wstępnego, wynik i błędy jak w programie PC', async () => {
  const seen = [];
  const z = createZks({ storage: mem({ 'zks.ios.url': GOOD, 'zks.ios.key': ' K-123 ' }), fetchImpl: async (u, o) => { seen.push([u, o]); return json({ ok: true, data: [1, 2] }); } });
  assert.deepEqual(await z.call('getProductCodes', ['x']), { ok: true, data: [1, 2], user: null });
  assert.equal(seen[0][0], GOOD); assert.equal(seen[0][1].method, 'POST'); assert.match(seen[0][1].headers['Content-Type'], /^text\/plain/);
  assert.deepEqual(JSON.parse(seen[0][1].body), { key: 'K-123', fn: 'getProductCodes', args: ['x'] });
  const z2 = createZks({ storage: mem(), fetchImpl: async () => json({}) });
  assert.equal((await z2.call('x')).code, 'NOT_CONFIGURED');
  const z3 = createZks({ storage: mem({ 'zks.ios.url': GOOD, 'zks.ios.key': 'k' }), fetchImpl: async () => json({ ok: false, code: 'BAD_KEY' }) });
  assert.deepEqual(await z3.call('x'), { ok: false, code: 'BAD_KEY', error: 'Nieprawidłowy lub nieaktywny klucz.' });
});

test('adres API z bazy: przyjmowany przy pierwszym uruchomieniu, klucz zostaje; samonaprawa po błędzie połączenia', async () => {
  const doc = (url, ver) => ({ fields: { url: { stringValue: url }, ver: { integerValue: String(ver) }, updatedAt: { integerValue: '1' }, updatedBy: { stringValue: 'Admin' } } });
  const st = mem({ 'zks.ios.key': 'klucz' });
  let remote = doc(GOOD, 1);
  const hits = [];
  const z = createZks({ storage: st, fetchImpl: async (u) => {
    hits.push(u);
    if (u.startsWith('https://firestore.googleapis.com/')) return json(remote);
    if (u === GOOD) throw new Error('offline');     // stary adres przestał działać
    return json({ ok: true, data: 'ok z nowego' });
  } });
  assert.equal((await z.syncLink()).changed, true);
  assert.deepEqual(await z.getSettings(), { url: GOOD, key: 'klucz', linkVer: 1 });
  remote = doc(NEW, 2);                                              // administrator opublikował nowe wdrożenie
  const r = await z.call('api_whoami');
  assert.deepEqual([r.ok, r.data], [true, 'ok z nowego']);          // błąd sieci → pobranie adresu z bazy → ponowienie
  assert.equal((await z.getSettings()).url, NEW);
});

test('składnia adresu i zasady przyjmowania jak w programie PC', () => {
  assert.equal(checkLink(` ${GOOD}/?a=1 `).url, GOOD); assert.equal(checkLink('http://x').ok, false); assert.equal(checkLink(GOOD.replace('/exec', '/dev')).ok, false);
  assert.ok(shouldAdopt({ url: GOOD, ver: 3 }, { url: '', linkVer: 0 })); assert.ok(!shouldAdopt({ url: GOOD, ver: 3 }, { url: NEW, linkVer: 3 }));
  assert.ok(shouldAdopt({ url: GOOD, ver: 3 }, { url: NEW, linkVer: 3 }, true));
});

test('BarcodeDetector na bazie ZXing: instaluje się tylko, gdy przeglądarka go nie ma; zwraca rawValue i narożniki', async () => {
  const pt = (x, y) => ({ getX: () => x, getY: () => y });
  class Reader { setHints() {} reset() {} decode() { return { getText: () => '*K1*$R$', getBarcodeFormat: () => 11, getResultPoints: () => [pt(100, 50), pt(200, 50), pt(100, 150)] }; } }
  const ZX = { DecodeHintType: { POSSIBLE_FORMATS: 1, TRY_HARDER: 2 }, BarcodeFormat: { QR_CODE: 11, CODE_128: 5 }, MultiFormatReader: Reader, BinaryBitmap: class { constructor(b) { this.b = b; } }, HybridBinarizer: class { constructor(s) { this.s = s; } }, RGBLuminanceSource: class { constructor(l, w, h) { this.l = l; this.w = w; this.h = h; } } };
  const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) }) };
  const D = makeDetectorClass(ZX, doc);
  const found = await new D().detect({ videoWidth: 1920, videoHeight: 1080 });
  assert.equal(found[0].rawValue, '*K1*$R$'); assert.equal(found[0].cornerPoints.length, 4);
  assert.deepEqual(await new D().detect({ videoWidth: 0, videoHeight: 0 }), []);
  const win = { ZXing: ZX, document: doc }; assert.equal(installBarcodeDetector(win), true); assert.ok(win.BarcodeDetector);
  assert.equal(installBarcodeDetector({ ZXing: ZX, BarcodeDetector: class {} }), false);   // natywny zostaje
  assert.equal(installBarcodeDetector({}), false);                                          // bez biblioteki – nic
});

test('powłoka iPhone\'a: karty Grafik i Plan z tych samych widoków co w programie PC, z uprawnieniami (Plan CLERIK/TOURIST tylko do odczytu)', async () => {
  const fs = await import('node:fs');
  const js = fs.readFileSync(new URL('../iphone/mobile.js', import.meta.url), 'utf8');
  assert.match(js, /views\/grafik\.js/); assert.match(js, /views\/plan\.js/); assert.match(js, /ctx\.grafikAcc/);
  assert.match(js, /editPlan/);
  for (const f of ['src/renderer/js/views/grafik.js', 'src/renderer/js/views/plan.js']) assert.ok(fs.existsSync(new URL('../' + f, import.meta.url)));
});

test('BarcodeDetector: wieloprzebiegowy odczyt – kolejne skale/wycinki do pierwszego trafienia, współrzędne w układzie całej klatki, negatyw co drugą klatkę', async () => {
  const pt = (x, y) => ({ getX: () => x, getY: () => y });
  const calls = []; let okAt = 2;
  class Reader { setHints() {} reset() {} decode(bitmap) { calls.push(bitmap.w); if (calls.length === okAt || bitmap.inv) return { getText: () => 'OK', getBarcodeFormat: () => 11, getResultPoints: () => [pt(10, 10), pt(30, 10), pt(30, 30)] }; throw new Error('nf'); } }
  class Src { constructor(l, w, h) { this.l = l; this.w = w; this.h = h; } }
  class Inv extends Src { constructor(s) { super(s.l, s.w, s.h); this.inv = true; } }
  const ZX = { DecodeHintType: { POSSIBLE_FORMATS: 1, TRY_HARDER: 2 }, BarcodeFormat: { QR_CODE: 11 }, MultiFormatReader: Reader, RGBLuminanceSource: Src, InvertedLuminanceSource: Inv, HybridBinarizer: class { constructor(s) { this.s = s; } }, BinaryBitmap: class { constructor(b) { this.w = b.s.w; this.inv = b.s.inv; } } };
  const doc = { createElement: () => { const c = { width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(c.width * c.height * 4) }) }) }; return c; } };
  const passes = [{ crop: 1, side: 400 }, { crop: 0.5, side: 300 }];
  const D = makeDetectorClass(ZX, doc, passes);
  const r = await new D().detect({ videoWidth: 1600, videoHeight: 800 });   // 1. przebieg (400 px) nie trafia, 2. (300 px) trafia
  assert.deepEqual(calls, [400, 300]); assert.equal(r[0].rawValue, 'OK');
  // wycinek ½ klatki zaczyna się w (400, 200): punkt (10,10) przy skali 300/800 → 400 + 10/0.375
  assert.ok(Math.abs(r[0].cornerPoints[0].x - (400 + 10 / 0.375 - 6 / 0.375)) < 1);
});
