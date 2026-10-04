const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const fixtures = path.resolve(__dirname, 'fixtures');
const root = path.resolve('build');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  fs.readFile(
    path.join(root, url.pathname === '/' ? 'index.html' : url.pathname),
    (error, data) => {
      res.writeHead(error ? 404 : 200, {
        'Content-Type':
          mime[
            path.extname(url.pathname === '/' ? 'index.html' : url.pathname)
          ] || 'application/octet-stream',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cache-Control': 'no-cache',
      });
      res.end(error ? 'Not found' : data);
    },
  );
});
let browser, url;
const results = [];
async function setup(context) {
  await context.addInitScript(() => {
    window.auditPickerCalls = 0;
    window.auditPermissionRequests = 0;
    window.showDirectoryPicker = async () => {
      window.auditPickerCalls++;
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle(window.auditPickName || 'output-a', {
        create: true,
      });
    };
    const proto = FileSystemDirectoryHandle.prototype;
    const query = proto.queryPermission,
      request = proto.requestPermission;
    proto.queryPermission = function (options) {
      return window.auditPermission
        ? Promise.resolve(window.auditPermission)
        : query.call(this, options);
    };
    proto.requestPermission = function (options) {
      window.auditPermissionRequests++;
      return window.auditPermission
        ? Promise.resolve(window.auditPermissionResult || 'granted')
        : request.call(this, options);
    };
  });
}
async function fresh(options = {}) {
  const context = await browser.newContext(options);
  await setup(context);
  return context;
}
async function open(context) {
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: '全部壓縮', exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="輸出資料夾設定"] button').disabled,
  );
  return page;
}
async function start(page, files) {
  await page
    .locator('input[type=file]')
    .setInputFiles(
      files.map((file) =>
        typeof file === 'string' ? path.join(fixtures, file) : file,
      ),
    );
  await page.getByRole('button', { name: '全部壓縮', exact: true }).click();
}
async function done(page) {
  await page.getByText(/完成 \d+ 張/).waitFor({ timeout: 60000 });
  return page.locator('li').allTextContents();
}
async function clear(page) {
  await page.getByRole('button', { name: '清空', exact: true }).click();
}
async function output(page, dir, name) {
  return page.evaluate(
    async ({ dir, name }) => {
      const root = await navigator.storage.getDirectory();
      const d = await root.getDirectoryHandle(dir);
      const f = await (await d.getFileHandle(name)).getFile();
      return Array.from(new Uint8Array(await f.arrayBuffer()));
    },
    { dir, name },
  );
}
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log('PASS', name);
}
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url =
    process.env.SQUOOSH_TEST_URL ||
    `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  await check(
    'themes persist, sync across tabs, and fit a mobile viewport',
    async () => {
      const context = await fresh({ colorScheme: 'dark' });
      const page = await open(context);
      assert.equal(
        await page.locator('html').getAttribute('data-theme'),
        'dark',
      );
      const other = await open(context);
      await page.getByLabel('外觀主題').selectOption('light');
      await other.waitForFunction(
        () => document.documentElement.dataset.theme === 'light',
      );
      await page.reload();
      await page.getByLabel('外觀主題').waitFor();
      assert.equal(await page.getByLabel('外觀主題').inputValue(), 'light');
      await page.screenshot({
        path: '.tmp/theme-light.png',
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByLabel('外觀主題').selectOption('dark');
      await page.screenshot({
        path: '.tmp/theme-dark.png',
        fullPage: true,
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(
        await page.evaluate(
          () => document.querySelector('main').scrollWidth <= innerWidth,
        ),
        true,
      );
      await context.close();
      const restricted = await fresh();
      await restricted.addInitScript(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException('denied', 'SecurityError');
        };
        Storage.prototype.getItem = () => {
          throw new DOMException('denied', 'SecurityError');
        };
      });
      const r = await open(restricted);
      await r.getByLabel('外觀主題').selectOption('dark');
      assert.equal(await r.locator('html').getAttribute('data-theme'), 'dark');
      await restricted.close();
    },
  );
  await check(
    'static codecs, compatible AVIF and animations preserved',
    async () => {
      const context = await fresh(),
        page = await open(context),
        external = [];
      context.on('request', (request) => {
        if (!request.url().startsWith(url)) external.push(request.url());
      });
      await start(page, [
        'photo.jpg',
        'still.png',
        'still.webp',
        'pillow.avif',
        'compatible-brand.avif',
        'animated.png',
        'animated.webp',
      ]);
      const rows = await done(page);
      assert.equal(rows.length, 7);
      assert.ok(rows.every((x) => !x.includes('處理失敗')));
      for (const ext of ['png', 'webp'])
        assert.deepEqual(
          Buffer.from(
            await output(page, 'output-a', `animated-compressed.${ext}`),
          ),
          fs.readFileSync(path.join(fixtures, `animated.${ext}`)),
        );
      assert.equal(await page.evaluate(() => window.auditPickerCalls), 1);
      assert.deepEqual(external, []);
      await context.close();
    },
  );
  await check(
    'saved directory survives reload, change, clear and permission prompts',
    async () => {
      const context = await fresh(),
        page = await open(context);
      await page
        .getByRole('button', { name: '選擇資料夾', exact: true })
        .click();
      await page
        .locator('[data-output-directory]')
        .filter({ hasText: 'output-a' })
        .waitFor();
      await page.reload();
      await page
        .getByRole('button', { name: '變更資料夾', exact: true })
        .waitFor();
      await page.evaluate(() => {
        window.auditPermission = 'prompt';
      });
      await start(page, ['photo.jpg']);
      assert.ok((await done(page))[0].includes('photo-compressed.jpg'));
      assert.equal(await page.evaluate(() => window.auditPickerCalls), 0);
      assert.equal(
        await page.evaluate(() => window.auditPermissionRequests),
        1,
      );
      await clear(page);
      await page.evaluate(() => {
        window.auditPermissionResult = 'denied';
      });
      await start(page, ['still.png']);
      await page.getByText(/尚未取得輸出資料夾的寫入權限/).waitFor();
      assert.equal(await page.evaluate(() => window.auditPickerCalls), 0);
      await page.waitForFunction(
        () =>
          !document.querySelector('[aria-label="輸出資料夾設定"] button')
            .disabled,
      );
      await page.evaluate(() => {
        window.auditPermission = undefined;
        window.auditPickName = 'output-b';
      });
      await page
        .getByRole('button', { name: '變更資料夾', exact: true })
        .click();
      await page
        .locator('[data-output-directory]')
        .filter({ hasText: 'output-b' })
        .waitFor();
      await page.getByRole('button', { name: '全部壓縮', exact: true }).click();
      await done(page);
      assert.ok(
        (await output(page, 'output-b', 'still-compressed.png')).length > 0,
      );
      await page.getByRole('button', { name: '清除設定', exact: true }).click();
      await page
        .getByRole('button', { name: '選擇資料夾', exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByRole('button', { name: '選擇資料夾', exact: true })
        .waitFor();
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        375,
      );
      await context.close();
    },
  );
  await check(
    'two windows and directory collisions retain both results',
    async () => {
      const context = await fresh({ serviceWorkers: 'block' }),
        [a, b] = await Promise.all([open(context), open(context)]);
      await a.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const d = await root.getDirectoryHandle('output-a', { create: true });
        await d.getDirectoryHandle('photo-compressed.jpg', { create: true });
      });
      await Promise.all([
        start(a, ['photo.jpg']),
        start(b, [
          {
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            buffer: fs.readFileSync(path.join(fixtures, 'other.jpg')),
          },
        ]),
      ]);
      const rows = await Promise.all([done(a), done(b)]);
      assert.ok(rows.flat().every((x) => !x.includes('處理失敗')));
      const first = await output(a, 'output-a', 'photo-compressed (2).jpg'),
        second = await output(a, 'output-a', 'photo-compressed (3).jpg');
      assert.notDeepEqual(first, second);
      await context.close();
    },
  );
  await check('all four static formats work on first offline use', async () => {
    const context = await fresh(),
      page = await open(context);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await start(page, ['photo.jpg', 'still.png', 'still.webp', 'pillow.avif']);
    const rows = await done(page);
    assert.ok(
      rows.every((x) => !x.includes('處理失敗')),
      rows.join('\n'),
    );
    await context.close();
  });
  await check('worker load failure ends the batch', async () => {
    const context = await fresh({ serviceWorkers: 'block' });
    await context.route('**/features-worker-*.js', (r) => r.abort());
    const page = await open(context);
    await start(page, ['photo.jpg']);
    assert.ok((await done(page))[0].includes('處理失敗'));
    assert.equal(
      await page
        .getByRole('button', { name: '全部壓縮', exact: true })
        .isEnabled(),
      true,
    );
    await context.close();
  });
  await check('cancel terminates a worker that never responds', async () => {
    const context = await fresh({ serviceWorkers: 'block' });
    await context.route('**/features-worker-*.js', (r) =>
      r.fulfill({
        contentType: 'text/javascript',
        headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' },
        body: 'setInterval(() => {}, 1000);',
      }),
    );
    const page = await open(context);
    await start(page, ['photo.jpg']);
    await page.getByRole('button', { name: '取消壓縮', exact: true }).click();
    await done(page);
    await page.getByText(/已停止，完成/).waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: '全部壓縮', exact: true })
        .isEnabled(),
      true,
    );
    await context.close();
  });
  await check('missing app chunk shows reload action', async () => {
    const context = await fresh({ serviceWorkers: 'block' });
    await context.route('**/BatchCompress-*.js', (r) => r.abort());
    const page = await context.newPage();
    await page.goto(url);
    await page
      .getByRole('alert')
      .filter({ hasText: '無法載入批次壓縮工具' })
      .waitFor();
    await page.getByRole('button', { name: '重新載入', exact: true }).waitFor();
    await context.close();
  });
  await browser.close();
  browser = undefined;
  await check(
    'directory preference survives closing and reopening the browser profile',
    async () => {
      const profile = fs.mkdtempSync(path.resolve('.tmp/browser-profile-'));
      for (let pass = 0; pass < 2; pass++) {
        const context = await chromium.launchPersistentContext(profile, {
          channel: process.env.BROWSER_CHANNEL || 'msedge',
          headless: true,
        });
        try {
          await setup(context);
          const page = await open(context);
          if (pass === 0) {
            await page
              .getByRole('button', { name: '選擇資料夾', exact: true })
              .click();
            await page
              .locator('[data-output-directory]')
              .filter({ hasText: 'output-a' })
              .waitFor();
            await page.waitForFunction(
              () =>
                !document.querySelector('[aria-label="輸出資料夾設定"] button')
                  .disabled,
            );
          } else {
            await page
              .getByRole('button', { name: '變更資料夾', exact: true })
              .waitFor();
            await start(page, ['photo.jpg']);
            await done(page);
            assert.equal(await page.evaluate(() => window.auditPickerCalls), 0);
            await page.screenshot({
              path: '.tmp/batch-updated.png',
              fullPage: true,
            });
          }
        } finally {
          await context.close();
        }
      }
    },
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.close();
    fs.writeFileSync(
      '.tmp/browser-regression-results.json',
      JSON.stringify(results, null, 2),
    );
  });
