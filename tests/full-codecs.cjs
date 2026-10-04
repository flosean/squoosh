// Run after a SQUOOSH_FULL_CODECS=1 build. Exercises legacy codecs/processors too.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = process.cwd();
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const headers = {
    'Content-Type': pathname.endsWith('.wasm')
      ? 'application/wasm'
      : 'text/javascript',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  };
  if (pathname === '/') {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html' });
    return res.end('<!doctype html><title>Codec regression</title>');
  }
  const file = path.resolve(
    root,
    '.' + (pathname.startsWith('/c/') ? '/build' : '') + pathname,
  );
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    res.writeHead(error ? 404 : 200, headers);
    res.end(data);
  });
});
let browser;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('BROWSER', e.message));
  page.on('console', (m) => {
    if (m.text().startsWith('CHECK') || m.type() === 'error')
      console.log(m.text());
  });
  if (process.env.DEBUG_CODEC)
    await page.route('**/c/*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({
        response,
        body:
          `if(!self._debugWorker){self._debugWorker=true;const W=self.Worker;self.Worker=class extends W{constructor(...args){super(...args);console.error('NEW_WORKER',String(args[0]));this.addEventListener('error',e=>console.error('WORKER_ERROR',e.message,e.filename,e.lineno));this.addEventListener('message',e=>console.error('WORKER_MESSAGE',e.data.cmd));}};}\n` +
          body,
      });
    });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const workerFile = fs
    .readdirSync('build/c')
    .find((p) => p.startsWith('features-worker-'));
  const results = await page.evaluate(async (workerFile) => {
    const { wrap } = await import('/node_modules/comlink/dist/esm/comlink.mjs');
    const worker = new Worker('/c/' + workerFile);
    const api = wrap(worker);
    const results = [];
    const task = async () => {
      const image = new ImageData(32, 24);
      for (let i = 0; i < image.data.length; i++)
        image.data[i] = i % 4 === 3 ? 255 : (i * 31) % 256;
      for (const [name, method] of [
        ['qoi', 'qoi'],
        ['webP', 'webp'],
        ['avif', 'avif'],
        ['jxl', 'jxl'],
        ['wp2', 'wp2'],
        ['mozJPEG', 'mozjpeg'],
        ['oxiPNG', 'oxipng'],
      ]) {
        console.log('CHECK', name);
        const { defaultOptions } = await import(
          '/.tmp/ts/src/features/encoders/' + name + '/shared/meta.js'
        );
        const encoded = await api[method + 'Encode'](image, defaultOptions);
        console.log('CHECK encoded', name);
        if (!encoded.byteLength) throw Error(name + ' returned empty data');
        if (['qoi', 'webp', 'avif', 'jxl', 'wp2'].includes(method)) {
          const decode = async (data) =>
            api[method + 'Decode'](new Blob([data]));
          let decoded = await decode(encoded);
          console.log('CHECK decoded', name);
          if (decoded.width !== 32 || decoded.height !== 24)
            throw Error(name + ' roundtrip dimensions');
          let seed = 173;
          const next = () =>
            (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
          for (let i = 0; i < 64; i++) {
            const bad =
              i < 32
                ? new Uint8Array(encoded).slice(0, i)
                : Uint8Array.from(
                    { length: next() % 128 },
                    () => next() >>> 24,
                  );
            try {
              await decode(bad);
            } catch {}
          }
          decoded = await decode(encoded);
          if (decoded.width !== 32)
            throw Error(name + ' failed recovery after malformed inputs');
        } else {
          const bitmap = await createImageBitmap(new Blob([encoded]));
          if (bitmap.width !== 32 || bitmap.height !== 24)
            throw Error(name + ' dimensions');
          bitmap.close();
        }
        for (const [width, height] of [
          [1, 1],
          [17, 9],
          [513, 257],
        ]) {
          console.log('CHECK variant', name, width, height);
          const variant = new ImageData(width, height);
          for (let i = 0; i < variant.data.length; i++)
            variant.data[i] = i % 4 === 3 ? 128 : (i * 31) % 256;
          const bytes = await api[method + 'Encode'](variant, defaultOptions);
          if (!bytes.byteLength)
            throw Error(name + ' failed ' + width + 'x' + height);
          const decoded = ['qoi', 'webp', 'avif', 'jxl', 'wp2'].includes(method)
            ? await api[method + 'Decode'](new Blob([bytes]))
            : await createImageBitmap(new Blob([bytes]));
          if (decoded.width !== width || decoded.height !== height)
            throw Error(name + ' variant dimensions');
          if ('close' in decoded) decoded.close();
        }
        if (method === 'wp2') {
          const pixel = new ImageData(
            new Uint8ClampedArray([200, 80, 40, 128]),
            1,
            1,
          );
          const bytes = await api.wp2Encode(pixel, {
            ...defaultOptions,
            quality: 100,
            alpha_quality: 100,
          });
          const decoded = await api.wp2Decode(new Blob([bytes]));
          if (
            Math.abs(decoded.data[0] - 200) > 2 ||
            Math.abs(decoded.data[3] - 128) > 1
          )
            throw Error(
              'WP2 straight alpha changed colors: ' + Array.from(decoded.data),
            );
        }
        results.push(name + ' encode/decode, alpha, dimensions and recovery');
      }
      const rotated = await api.rotate(image, { rotate: 90 });
      if (rotated.width !== 24 || rotated.height !== 32)
        throw Error('rotation');
      const r = {
        width: 64,
        height: 64,
        method: 'hqx',
        fitMethod: 'contain',
        premultiply: true,
        linearRGB: true,
      };
      const resized = await api.resize(image, r);
      if (resized.width !== 64 || resized.data.length !== 64 * 64 * 4)
        throw Error('HQX resize');
      const quantized = await api.quantize(image, {
        maxNumColors: 16,
        dither: 1,
        zx: false,
      });
      if (quantized.data.length !== image.data.length) throw Error('quantize');
      const png = await import('/codecs/png/pkg/squoosh_png.js');
      await png.default();
      const pngBytes = png.encode(image.data, 32, 24);
      if (png.decode(pngBytes).width !== 32) throw Error('Rust PNG');
      for (let n = 0; n < 64; n++) {
        try {
          png.decode(pngBytes.slice(0, n));
        } catch {}
      }
      if (png.decode(pngBytes).height !== 24) throw Error('Rust PNG recovery');
      results.push('rotate, HQX, resize, imagequant, Rust PNG');
      return results;
    };
    let timer;
    try {
      return await Promise.race([
        task(),
        new Promise(
          (_, reject) =>
            (timer = setTimeout(
              () => reject(Error('codec regression timeout')),
              120000,
            )),
        ),
      ]);
    } finally {
      clearTimeout(timer);
      worker.terminate();
    }
  }, workerFile);
  assert.equal(results.length, 8);
  results.forEach((r) => console.log('PASS', r));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.close();
  });
