const fs = require('fs'),
  vm = require('vm'),
  path = require('path');
(async () => {
  const p = path.resolve('codecs/visdif/visdif.js');
  const src = fs
    .readFileSync(p, 'utf8')
    .replace(/export default Module;?/, 'module.exports=Module;')
    .replaceAll(
      'import.meta.url',
      JSON.stringify(require('url').pathToFileURL(p).href),
    );
  const m = { exports: {} };
  vm.runInNewContext(src, {
    module: m,
    exports: m.exports,
    require,
    process,
    console,
    TextDecoder,
    Buffer,
    URL,
    Uint8Array,
    __dirname: path.dirname(p),
  });
  const mod = await m.exports({
    wasmBinary: fs.readFileSync(p.replace('.js', '.wasm')),
  });
  const x = new Uint8Array(32 * 32 * 4).fill(255),
    d = new mod.VisDiff(x, 32, 32);
  if (d.distance(x) !== 0) throw Error('identical image distance');
  d.delete();
  console.log('PASS rebuilt Butteraugli distance is zero for identical pixels');
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
