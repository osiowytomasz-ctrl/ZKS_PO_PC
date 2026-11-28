// `BarcodeDetector` dla przeglądarek, które go nie mają (Safari na iPhone'ie): odczyt kodów QR i kreskowych z klatki wideo biblioteką ZXing.
// Ten sam interfejs co w Chrome (detect(źródło) → [{ rawValue, format, cornerPoints }]), więc skaner z programu PC działa bez zmian.

const FORMATS = ['QR_CODE', 'CODE_128', 'CODE_39', 'CODE_93', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'DATA_MATRIX', 'PDF_417', 'AZTEC', 'ITF'];
// Odczyt jest wieloprzebiegowy (kolejno, do pierwszego trafienia): jeden rozmiar obrazu nie pasuje do każdego kodu – zbyt duży ma szum
// z matrycy, zbyt mały rozmywa moduły kodu. Dlatego próbujemy kilku skal i wycinków (środek kadru, bo tam trzyma się kod, i cała klatka),
// a co drugą klatkę dodatkowo „w negatywie” (jasny kod na ciemnym tle).
const PASSES = [{ crop: 0.7, side: 800 }, { crop: 1, side: 1100 }, { crop: 0.7, side: 560 }, { crop: 0.5, side: 700 }];   // crop – część klatki wokół środka, side – dłuższy bok po zmniejszeniu (px)

/** Tworzy klasę BarcodeDetector na bazie biblioteki ZXing ([ZX] – obiekt globalny z zxing.min.js). */
export function makeDetectorClass(ZX, doc = globalThis.document, passes = PASSES) {
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, FORMATS.map((f) => ZX.BarcodeFormat[f]).filter((x) => x !== undefined));
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.MultiFormatReader();
  reader.setHints(hints);
  let canvas = null, frame = 0;

  /** Wycinek źródła (sx, sy, sw, sh) zmniejszony do [maxSide] → jasności pikseli; null, gdy nic nie ma. */
  function grab(source, sx, sy, sw, sh, maxSide) {
    const k = Math.min(1, maxSide / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    canvas = canvas || doc.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, lum = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) lum[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    return { lum, w, h, k, sx, sy };
  }
  function decode(img, invert) {
    try {
      let src = new ZX.RGBLuminanceSource(img.lum, img.w, img.h);
      if (invert && ZX.InvertedLuminanceSource) src = new ZX.InvertedLuminanceSource(src);
      const res = reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(src)));
      const pts = (res.getResultPoints() || []).map((p) => ({ x: p.getX() / img.k + img.sx, y: p.getY() / img.k + img.sy }));
      // prostokąt obejmujący punkty kodu (jak cornerPoints w Chrome) – skaner używa go do wyboru kodu pod celownikiem
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const pad = 6 / img.k, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
      const cornerPoints = pts.length ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] : [];
      return { rawValue: res.getText(), format: String(res.getBarcodeFormat()), cornerPoints, boundingBox: null };
    } catch (e) { return null; }   // NotFoundException i inne – brak kodu w tym przebiegu
    finally { reader.reset && reader.reset(); }
  }

  return class BarcodeDetector {
    static async getSupportedFormats() { return FORMATS.map((f) => f.toLowerCase()); }
    async detect(source) {
      const sw = source.videoWidth || source.naturalWidth || source.width || 0, sh = source.videoHeight || source.naturalHeight || source.height || 0;
      if (!sw || !sh) return [];
      frame++;
      let hit = null, first = null;
      for (const p of passes) {
        const cw = Math.round(sw * p.crop), ch = Math.round(sh * p.crop);
        const img = grab(source, Math.round((sw - cw) / 2), Math.round((sh - ch) / 2), cw, ch, p.side);
        first = first || img;
        if ((hit = decode(img, false))) break;
      }
      if (!hit && frame % 2 === 0) hit = decode(first, true);
      return hit ? [hit] : [];
    }
  };
}

/** Instaluje window.BarcodeDetector, jeśli przeglądarka go nie ma i załadowano ZXing. Zwraca true, gdy zainstalowano. */
export function installBarcodeDetector(win = globalThis.window) {
  if (!win || win.BarcodeDetector || !win.ZXing) return false;
  win.BarcodeDetector = makeDetectorClass(win.ZXing, win.document);
  return true;
}
