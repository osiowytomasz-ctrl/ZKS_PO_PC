// `BarcodeDetector` dla przeglądarek, które go nie mają (Safari na iPhone'ie): odczyt kodów QR i kreskowych z klatki wideo biblioteką ZXing.
// Ten sam interfejs co w Chrome (detect(źródło) → [{ rawValue, format, cornerPoints }]), więc skaner z programu PC działa bez zmian.

const FORMATS = ['QR_CODE', 'CODE_128', 'CODE_39', 'CODE_93', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'DATA_MATRIX', 'PDF_417', 'AZTEC', 'ITF'];
const MAX_W = 960;   // klatka zmniejszana do tej szerokości (szybciej na telefonie)

/** Tworzy klasę BarcodeDetector na bazie biblioteki ZXing ([ZX] – obiekt globalny z zxing.min.js). */
export function makeDetectorClass(ZX, doc = globalThis.document) {
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, FORMATS.map((f) => ZX.BarcodeFormat[f]).filter((x) => x !== undefined));
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.MultiFormatReader();
  reader.setHints(hints);
  let canvas = null;
  return class BarcodeDetector {
    static async getSupportedFormats() { return FORMATS.map((f) => f.toLowerCase()); }
    async detect(source) {
      const sw = source.videoWidth || source.naturalWidth || source.width || 0, sh = source.videoHeight || source.naturalHeight || source.height || 0;
      if (!sw || !sh) return [];
      const k = Math.min(1, MAX_W / sw), w = Math.round(sw * k), h = Math.round(sh * k);
      canvas = canvas || doc.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(source, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data, lum = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) lum[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      try {
        const res = reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(lum, w, h))));
        const pts = (res.getResultPoints() || []).map((p) => ({ x: p.getX() / k, y: p.getY() / k }));
        // prostokąt obejmujący punkty kodu (jak cornerPoints w Chrome) – skaner używa go do wyboru kodu pod celownikiem
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const pad = 6 / k, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
        const cornerPoints = pts.length ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] : [];
        return [{ rawValue: res.getText(), format: String(res.getBarcodeFormat()), cornerPoints, boundingBox: null }];
      } catch (e) { return []; }   // NotFoundException i inne – brak kodu w klatce
      finally { reader.reset && reader.reset(); }
    }
  };
}

/** Instaluje window.BarcodeDetector, jeśli przeglądarka go nie ma i załadowano ZXing. Zwraca true, gdy zainstalowano. */
export function installBarcodeDetector(win = globalThis.window) {
  if (!win || win.BarcodeDetector || !win.ZXing) return false;
  win.BarcodeDetector = makeDetectorClass(win.ZXing, win.document);
  return true;
}
