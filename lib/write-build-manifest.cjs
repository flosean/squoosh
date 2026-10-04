const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sourceFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(
    (p) =>
      /^(src\/|lib\/|codecs\/|.*config.*|package.*json$|windows-launcher.cs$)/.test(
        p,
      ) && fs.existsSync(p),
  )
  .sort();
const sourceHash = hash(
  sourceFiles.map((p) => p + ':' + hash(fs.readFileSync(p))).join('\n'),
);
const files = {};
for (const entry of fs.readdirSync('build', {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile() || entry.name === 'build-manifest.json') continue;
  const file = path.join(entry.parentPath, entry.name);
  files[path.relative('build', file).split(path.sep).join('/')] = hash(
    fs.readFileSync(file),
  );
}
fs.writeFileSync(
  'build/build-manifest.json',
  JSON.stringify(
    {
      sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      sourceHash,
      files,
    },
    null,
    2,
  ) + '\n',
);
