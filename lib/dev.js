const { spawn, spawnSync } = require('child_process');
const path = require('path');
const port = process.env.DEV_PORT || '5000';
const env = { ...process.env, DEV_PORT: port };
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else child.kill();
  }
  process.exitCode = code;
}
function run(entry, args) {
  const child = spawn(process.execPath, [require.resolve(entry), ...args], {
    env,
    stdio: 'inherit',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code) => stop(code || 0));
}
if (process.argv.includes('--watch'))
  run(path.join(path.dirname(require.resolve('rollup')), 'bin', 'rollup'), [
    '-cw',
    '--bundleConfigAsCjs',
  ]);
run('serve/build/main.js', [
  '--listen',
  `tcp://127.0.0.1:${port}`,
  '--no-clipboard',
  '--config',
  path.resolve('serve.json'),
  '.tmp/build/static',
]);
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
