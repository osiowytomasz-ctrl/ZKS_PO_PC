// Buduje kod interaktywnego pliku HTML (src/renderer/js/report/runtime.js + logika programu) w jeden skrypt:
//  - src/renderer/js/report/runtime.bundle.js – moduł z tekstem skryptu (PC wkleja go do pliku HTML),
//  - src/renderer/report-runtime.js – sam skrypt (kopia do Androida: app/src/main/assets/report-runtime.js).
// Uruchom: npm run runtime (po każdej zmianie runtime.js albo logiki harmonogramu).
import { build } from 'esbuild';
import fs from 'node:fs';
const r = await build({ entryPoints: ['src/renderer/js/report/runtime.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2019', charset: 'utf8', legalComments: 'none' });
const code = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
fs.writeFileSync('src/renderer/report-runtime.js', code);
fs.writeFileSync('src/renderer/js/report/runtime.bundle.js', '// Wygenerowane przez scripts/build-runtime.mjs – nie edytuj ręcznie.\nexport const RUNTIME = ' + JSON.stringify(code) + ';\n');
console.log('runtime:', (code.length / 1024).toFixed(0), 'KB');
