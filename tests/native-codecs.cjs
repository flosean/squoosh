// Exercise the actual generated WASM wrappers in isolated browser workers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = process.cwd();
const server = http.createServer((req, res) => {
  const file = path.resolve(
    root,
    '.' + new URL(req.url, 'http://localhost').pathname,
  );
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    res.writeHead(error ? 404 : 200, {
      'Content-Type': file.endsWith('.wasm')
        ? 'application/wasm'
        : 'text/javascript',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end(error ? '' : data);
  });
});
let browser;
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
  });
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${server.address().port}/tests/fixtures/still.png`,
  );
  for (const [codec, fixture] of [
    ['qoi', 'sample.qoi'],
    ['webp', 'still.webp'],
    ['avif', 'pillow.avif'],
  ]) {
    const result = await page.evaluate(
      async ({ codec, fixture }) => {
        const base = location.origin;
        const source = `import init from '${base}/codecs/${codec}/dec/${codec}_dec.js';
        const module = await init();
        const valid = new Uint8Array(await (await fetch('${base}/tests/fixtures/${fixture}')).arrayBuffer());
        const decoded = module.decode(valid);
        if (!decoded || !decoded.width || !decoded.height) throw Error('valid fixture failed');
        let count = 0;
        function check(bytes) { const result = module.decode(bytes); if (result && (!result.width || !result.height)) throw Error('invalid image result'); count++; }
        for (let n = 0; n < Math.min(valid.length, 128); n++) check(valid.slice(0, n));
        let seed = 420;
        const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
        for (let n = 0; n < 256; n++) { const bytes = new Uint8Array(next() % 256); for (let i=0; i<bytes.length;i++) bytes[i] = next() >>> 24; check(bytes); }
        // Mutate compressed payload only, keeping dimensions bounded.
        for (let n=0; n<128; n++) { const bytes=valid.slice(); const i=Math.min(bytes.length-1, Math.max(32, Math.floor(bytes.length/2)) + next()%Math.max(1, Math.floor(bytes.length/2)-1)); bytes[i] ^= 1 << (next()%8); check(bytes); }
        if (!module.decode(valid)) throw Error('decoder not reusable after malformed data');
        postMessage({ count, width: decoded.width, height: decoded.height });`;
        const workerURL = URL.createObjectURL(
          new Blob([source], { type: 'text/javascript' }),
        );
        const worker = new Worker(workerURL, { type: 'module' });
        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error('decoder timed out')),
              60000,
            );
            worker.onmessage = (e) => {
              clearTimeout(timer);
              resolve(e.data);
            };
            worker.onerror = (e) => {
              clearTimeout(timer);
              reject(Error(e.message));
            };
          });
        } finally {
          worker.terminate();
          URL.revokeObjectURL(workerURL);
        }
      },
      { codec, fixture },
    );
    assert.ok(result.count >= 384);
    console.log(
      `PASS ${codec}: ${result.count} bounded malformed cases; valid ${result.width}x${result.height} before/after`,
    );
  }
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.close();
  });
