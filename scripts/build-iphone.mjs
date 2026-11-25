// Składa stronę wersji na iPhone'a do katalogu _site: współdzielony kod programu PC (css, js, vendor/firebase.js, img) + pliki z iphone/.
// Użycie: node scripts/build-iphone.mjs [katalog_wyjściowy]  (domyślnie _site). Publikuje ją workflow .github/workflows/iphone-pages.yml (GitHub Pages).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '_site'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const cp = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });

cp('src/renderer/css', 'css');
cp('src/renderer/js', 'js');
cp('src/renderer/img', 'img');
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(root, 'src/renderer/vendor/firebase.js'), path.join(out, 'vendor/firebase.js'));   // bez three.js (3D niepotrzebne w skanerze i komunikatorze)
for (const f of ['index.html', 'mobile.js', 'mobile.css', 'shim.js', 'barcode-shim.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(root, 'iphone', f), path.join(out, f));
fs.copyFileSync(path.join(root, 'iphone/vendor/zxing.min.js'), path.join(out, 'zxing.min.js'));
fs.writeFileSync(path.join(out, 'version.js'), `export const VERSION = ${JSON.stringify(pkg.version)};\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Strona na iPhone'a (wersja ${pkg.version}) zapisana w ${out}`);
