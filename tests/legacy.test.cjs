const fs = require('fs'),
  vm = require('vm'),
  ts = require('typescript'),
  { spawn } = require('child_process');
const results = {};
function load(code, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2019,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    { exports, ...globals },
  );
  return exports;
}
function declarations(file, names) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return source.statements
    .filter((x) => x.name && names.includes(x.name.text))
    .map((x) => 'export ' + x.getText(source))
    .join('\n');
}
const clean = load(
  fs.readFileSync('src/client/lazy-app/util/clean-modify.ts', 'utf8'),
);
const funcs = load(
  declarations('src/client/lazy-app/Compress/index.tsx', [
    'stateForNewSourceData',
    'processorStateEquivalent',
  ]),
  { cleanMerge: clean.cleanMerge, URL: { revokeObjectURL() {} } },
);
const state = {
  sides: [
    { file: 'left.jpg', downloadUrl: 'blob:left', data: 'left' },
    { file: 'right.jpg', downloadUrl: 'blob:right', data: 'right' },
  ],
};
results.oldEditorState = funcs.stateForNewSourceData(state);
const setting = { resize: { enabled: true, width: 100, height: 100 } };
results.oldEquivalent = funcs.processorStateEquivalent(setting, { ...setting });
const resizeCode = fs.readFileSync(
  'src/features/processors/resize/worker/resize.ts',
  'utf8',
);
const offsets = load(
  fs.readFileSync('src/features/processors/resize/shared/util.ts', 'utf8'),
);
class ImageData {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
}
const resize = load(resizeCode, {
  ImageData,
  require(id) {
    if (id.includes('shared/util')) return offsets;
    if (id === 'codecs/hqx/pkg')
      return {
        default: async () => {},
        resize: (pixels, w, h, f) => new Uint32Array(w * h * f * f),
      };
    if (id === 'codecs/resize/pkg')
      return {
        default: async () => {},
        resize: (pixels, w, h, dw, dh) => {
          results.hqxContainInput = {
            width: w,
            height: h,
            expectedWidth: 8,
            expectedHeight: 8,
          };
          return new Uint8ClampedArray(dw * dh * 4);
        },
      };
    throw Error(id);
  },
});
(async () => {
  await resize.default(new ImageData(new Uint8ClampedArray(2 * 4 * 4), 2, 4), {
    width: 8,
    height: 8,
    method: 'hqx',
    fitMethod: 'contain',
    premultiply: true,
    linearRGB: true,
  });

  const assert = require('node:assert/strict');
  assert.equal(results.oldEditorState.sides[0].file, undefined);
  assert.equal(results.oldEditorState.sides[1].file, undefined);
  assert.equal(results.oldEquivalent, true);
  assert.equal(results.hqxContainInput.width, 8);
  assert.equal(results.hqxContainInput.height, 8);
  console.log(
    'PASS original editor state, equivalent settings, HQX crop coordinates',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
