import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { callApi } = require('../src/main/apiCore.cjs');

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s));
  });
}
const urlOf = (s) => `http://127.0.0.1:${s.address().port}/exec`;

test('callApi: poprawna odpowiedź, klucz w ciele, text/plain', async () => {
  let seen;
  const s = await server((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { body: JSON.parse(body), type: req.headers['content-type'], url: req.url };
      res.end(JSON.stringify({ ok: true, user: 'a@b', data: { x: 1 } }));
    });
  });
  const r = await callApi({ url: urlOf(s), key: 'k1' }, 'fn1', [1, 2]);
  s.close();
  assert.deepEqual(r, { ok: true, data: { x: 1 }, user: 'a@b' });
  assert.deepEqual(seen.body, { key: 'k1', fn: 'fn1', args: [1, 2] });
  assert.match(seen.type, /^text\/plain/);
  assert.ok(!seen.url.includes('k1'));
});

test('callApi: kody błędów', async () => {
  assert.equal((await callApi({ url: '', key: '' }, 'f')).code, 'NOT_CONFIGURED');
  assert.equal((await callApi({ url: 'nie-url', key: 'k' }, 'f')).code, 'BAD_URL');
  const s = await server((req, res) => res.end(JSON.stringify({ ok: false, code: 'BAD_KEY', error: 'x' })));
  assert.deepEqual(await callApi({ url: urlOf(s), key: 'k' }, 'f'), { ok: false, code: 'BAD_KEY', error: 'Nieprawidłowy lub nieaktywny klucz.' });
  s.close();
  const s2 = await server((req, res) => res.end('<html>logowanie Google</html>'));
  assert.equal((await callApi({ url: urlOf(s2), key: 'k' }, 'f')).code, 'BAD_RESPONSE');
  s2.close();
  const s3 = await server((req, res) => { res.statusCode = 500; res.end('x'); });
  assert.equal((await callApi({ url: urlOf(s3), key: 'k' }, 'f')).code, 'HTTP_500');
  s3.close();
  const s4 = await server((req, res) => res.end(JSON.stringify({ ok: false, code: 'ERROR', error: 'Zły zakres' })));
  assert.equal((await callApi({ url: urlOf(s4), key: 'k' }, 'f')).error, 'Zły zakres');
  s4.close();
  assert.equal((await callApi({ url: 'http://127.0.0.1:1/exec', key: 'k' }, 'f', [], { timeoutMs: 2000 })).code, 'NETWORK');
});

test('callApi: podąża za przekierowaniem', async () => {
  const target = await server((req, res) => res.end(JSON.stringify({ ok: true, data: 'ok' })));
  const s = await server((req, res) => { res.statusCode = 302; res.setHeader('Location', urlOf(target)); res.end(); });
  const r = await callApi({ url: urlOf(s), key: 'k' }, 'f');
  s.close(); target.close();
  assert.equal(r.data, 'ok');
});
