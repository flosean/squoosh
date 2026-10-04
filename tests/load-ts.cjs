const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

module.exports = function loadTS(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  vm.runInNewContext(
    source,
    {
      exports,
      Blob,
      Response,
      DOMException,
      AbortController,
      Uint8Array,
      Uint8ClampedArray,
      DataView,
      setTimeout,
      clearTimeout,
      console,
      navigator: { userAgent: '' },
      ...globals,
      require(id) {
        if (id in mocks) return mocks[id];
        if (id.startsWith('.'))
          return module.exports(
            path.resolve(path.dirname(file), id + '.ts'),
            mocks,
            globals,
          );
        return require(id);
      },
    },
    { filename: file },
  );
  return exports;
};
