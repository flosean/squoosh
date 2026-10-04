// Repeatable local workload; reports observations, not a cross-machine speed claim.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.join(
    process.env.SQUOOSH_BUILD_ROOT || 'build',
    pathname === '/' ? 'index.html' : pathname,
  );
  fs.readFile(file, (error, data) => {
    res.writeHead(error ? 404 : 200, {
      'Content-Type': file.endsWith('.wasm')
        ? 'application/wasm'
        : file.endsWith('.js')
        ? 'text/javascript'
        : 'text/html',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end(data);
  });
});
let browser;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url =
    process.env.SQUOOSH_TEST_URL ||
    `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async (r) => {
    if (!r.request().url().startsWith(url)) return r.abort();
    if (!/features-worker-[^/]+\.js$/.test(r.request().url()))
      return r.continue();
    const response = await r.fetch();
    const instrumentation =
      "const BenchWorker=self.Worker;self.Worker=class extends BenchWorker{constructor(...args){super(...args);self.postMessage({bench:'created'});}terminate(){self.postMessage({bench:'closed'});super.terminate();}};\n";
    return r.fulfill({
      response,
      body: instrumentation + (await response.text()),
    });
  });
  await context.addInitScript(() => {
    window.bench = {
      created: 0,
      closed: 0,
      acknowledged: 0,
      roots: 0,
      peakRoots: 0,
    };
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        window.bench.peakRoots = Math.max(
          window.bench.peakRoots,
          ++window.bench.roots,
        );
        this.stopped = false;
        this.addEventListener('message', (e) => {
          if (e.data?.bench) window.bench[e.data.bench]++;
          if (e.data === 'squoosh-disposed') window.bench.acknowledged++;
        });
      }
      terminate() {
        if (!this.stopped) {
          this.stopped = true;
          window.bench.roots--;
        }
        super.terminate();
      }
    };
  });
  await context.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('benchmark', { create: true });
    };
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: '全部壓縮', exact: true }).waitFor();
  const samples = [],
    childWorkersPerBatch = [];
  let previousCreated = 0;
  for (let run = 0; run < 3; run++) {
    if (run)
      await page.getByRole('button', { name: '清空', exact: true }).click();
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(2048, 2048),
        ctx = canvas.getContext('2d');
      const data = ctx.createImageData(2048, 2048);
      for (let i = 0; i < data.data.length; i++)
        data.data[i] = i % 4 === 3 ? 255 : (i * 31 + (i >>> 12)) % 256;
      ctx.putImageData(data, 0, 0);
      const png = await canvas.convertToBlob({ type: 'image/png' });
      const files = new DataTransfer();
      for (let i = 0; i < 4; i++)
        files.items.add(
          new File([png], `large-${i}.png`, { type: 'image/png' }),
        );
      const input = document.querySelector('input[type=file]');
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const start = performance.now();
    await page.getByRole('button', { name: '全部壓縮', exact: true }).click();
    await page.getByText(/完成 4 張/).waitFor({ timeout: 120000 });
    if (
      (await page.locator('li').allTextContents()).some((t) =>
        t.includes('處理失敗'),
      )
    )
      throw Error('benchmark job failed');
    samples.push(Math.round(performance.now() - start));
    await page.waitForFunction(() => window.bench.roots === 0);
    const counts = await page.evaluate(() => window.bench);
    childWorkersPerBatch.push(counts.created - previousCreated);
    previousCreated = counts.created;
  }
  const result = {
    workload: '4 x 2048x2048 PNG, three batches',
    milliseconds: samples,
    medianMilliseconds: [...samples].sort((a, b) => a - b)[1],
    childWorkersPerBatch,
    cleanup: await page.evaluate(() => window.bench),
    hardware: await page.evaluate(() => ({
      cores: navigator.hardwareConcurrency,
      memoryGB: navigator.deviceMemory,
    })),
    browser: browser.version(),
  };
  if (!previousCreated) throw Error('Worker instrumentation unavailable');
  fs.writeFileSync(
    process.env.BENCHMARK_RESULT || '.tmp/performance.json',
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.close();
  });
