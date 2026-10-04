const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const util = load('src/client/lazy-app/util/index.ts');
const image = load('src/client/lazy-app/util/image-container.ts');

test('large native images are rejected before allocating a canvas and their bitmap closes', async () => {
  let closed = false;
  const createImageBitmap = async () => ({
    width: 10000,
    height: 10000,
    close() {
      closed = true;
    },
  });
  const decoder = load(
    'src/client/lazy-app/util/index.ts',
    {},
    { self: { createImageBitmap }, createImageBitmap },
  );
  await assert.rejects(
    decoder.builtinDecode(new AbortController().signal, new Blob(), 32000000),
    /3200/,
  );
  assert.equal(closed, true);
});

test('the batch and thread budgets remain bounded on small and many-core devices', () => {
  const budget = load('src/shared/batch-budget.ts');
  for (const cores of [1, 2, 4, 8, 24, 128]) {
    for (const memory of [1, 2, 4, 8, 16]) {
      const parallel = budget.batchConcurrency(cores, memory);
      assert.ok(
        parallel * budget.codecThreads(cores) <=
          Math.max(1, Math.min(8, cores)),
      );
      if (memory < 8) assert.equal(parallel, 1);
    }
  }
});

test('cancelling native decode returns promptly and closes the late bitmap', async () => {
  let resolveDecode,
    closed = false;
  const createImageBitmap = () =>
    new Promise((resolve) => {
      resolveDecode = resolve;
    });
  const decodeUtil = load(
    'src/client/lazy-app/util/index.ts',
    {},
    { self: { createImageBitmap }, createImageBitmap },
  );
  const controller = new AbortController();
  const decoding = decodeUtil.builtinDecode(controller.signal, new Blob());
  controller.abort();
  await assert.rejects(decoding, { name: 'AbortError' });
  resolveDecode({
    close() {
      closed = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, true);
});

function ftyp(major, brands, extended = false) {
  const offset = extended ? 16 : 8;
  const bytes = Buffer.alloc(offset + 8 + brands.length * 4);
  bytes.writeUInt32BE(extended ? 1 : bytes.length);
  bytes.write('ftyp', 4);
  if (extended) bytes.writeUInt32BE(bytes.length, 12);
  bytes.write(major, offset);
  bytes.writeUInt32BE(1, offset + 4);
  brands.forEach((x, i) => bytes.write(x, offset + 8 + i * 4));
  return new Blob([bytes]);
}
test('AVIF compatible brands and extended ftyp are accepted', async () => {
  assert.equal(await util.sniffMimeType(ftyp('mif1', ['avif'])), 'image/avif');
  assert.equal(
    await util.sniffMimeType(ftyp('mif1', ['avif'], true)),
    'image/avif',
  );
  assert.equal(await util.sniffMimeType(ftyp('mif1', ['heic'])), '');
  assert.equal(
    await image.isAnimatedImage(ftyp('avif', ['avis']), 'image/avif'),
    true,
  );
});
test('abort listeners are released after successful work', async () => {
  const controller = new AbortController();
  let listeners = 0;
  const signal = {
    get aborted() {
      return controller.signal.aborted;
    },
    addEventListener() {
      listeners++;
    },
    removeEventListener() {
      listeners--;
    },
  };
  assert.equal(await util.abortable(signal, Promise.resolve(42)), 42);
  await Promise.resolve();
  assert.equal(listeners, 0);
});

function outputModule() {
  const stored = new Map();
  let queue = Promise.resolve();
  return load(
    'src/client/lazy-app/BatchCompress/output-directory.ts',
    {
      '../util': util,
      'idb-keyval': {
        get: async (k) => stored.get(k),
        set: async (k, v) => {
          stored.set(k, v);
        },
        del: async (k) => {
          stored.delete(k);
        },
      },
    },
    {
      navigator: {
        locks: {
          request(_name, _options, fn) {
            const next = queue.then(fn);
            queue = next.catch(() => {});
            return next;
          },
        },
      },
    },
  );
}
test('saved directory is reused, denied permission never selects a different directory', async () => {
  const output = outputModule();
  let requests = 0;
  const handle = {
    kind: 'directory',
    name: 'Images',
    queryPermission: async () => 'prompt',
    requestPermission: async () => {
      requests++;
      return 'denied';
    },
  };
  await output.rememberDirectory(handle);
  assert.equal(await output.loadDirectory(), handle);
  await assert.rejects(output.authorizeDirectory(handle), /寫入權限/);
  assert.equal(requests, 1);
  await output.forgetDirectory();
  assert.equal(await output.loadDirectory(), undefined);
});
test('concurrent output does not overwrite and skips directory collisions', async () => {
  const output = outputModule(),
    files = new Map([['photo.jpg', 'directory']]);
  const directory = {
    async getFileHandle(name, options) {
      if (files.get(name) === 'directory')
        throw new DOMException('', 'TypeMismatchError');
      if (!files.has(name) && !options?.create)
        throw new DOMException('', 'NotFoundError');
      return {
        async createWritable() {
          return {
            async write(data) {
              files.set(name, await data.text());
            },
            async close() {},
            async abort() {},
          };
        },
      };
    },
  };
  const names = await Promise.all(
    ['first', 'second'].map((x) =>
      output.writeUniqueFile(
        directory,
        'photo.jpg',
        new Blob([x]),
        new AbortController().signal,
      ),
    ),
  );
  assert.deepEqual(names, ['photo (2).jpg', 'photo (3).jpg']);
  assert.equal(files.get(names[0]), 'first');
  assert.equal(files.get(names[1]), 'second');
});
test('failed writes abort the stream and cancellation does not start writing', async () => {
  const output = outputModule();
  let aborted = false,
    created = false;
  const directory = {
    async getFileHandle(_name, options) {
      if (!options) throw new DOMException('', 'NotFoundError');
      created = true;
      return {
        async createWritable() {
          return {
            async write() {
              throw Error('disk full');
            },
            async close() {},
            async abort() {
              aborted = true;
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    output.writeUniqueFile(
      directory,
      'x.png',
      new Blob(),
      new AbortController().signal,
    ),
    /disk full/,
  );
  assert.equal(aborted, true);
  created = false;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    output.writeUniqueFile(directory, 'x.png', new Blob(), controller.signal),
    { name: 'AbortError' },
  );
  assert.equal(created, false);
});
