// Runs only owned, hidden child processes and refuses to replace a service on port 5000.
const fs = require('fs'),
  path = require('path'),
  http = require('http'),
  net = require('net');
const { spawn } = require('child_process');
const assert = require('node:assert/strict');
const exe = path.resolve(
  process.env.SQUOOSH_EXE || 'Squoosh-Batch-Windows.exe',
);
const children = new Set();
let otherServer;
function launch(file, args, env = process.env) {
  const child = spawn(file, args, { env, windowsHide: true, stdio: 'inherit' });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}
function exited(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const end = exited(child);
  child.kill();
  await end;
}
async function ready(endpoint) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(endpoint);
      if (r.ok) return r;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Server did not become ready');
}
(async () => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(5000, '127.0.0.1', resolve);
  });
  await new Promise((r) => probe.close(r));
  let app = launch(exe, ['--no-browser']);
  const version = await (
    await ready('http://127.0.0.1:5000/_squoosh/version')
  ).text();
  assert.match(version, /^SquooshBatch:[a-f0-9]{32}$/);
  const duplicate = launch(exe, ['--no-browser']);
  assert.equal(await exited(duplicate), 0);
  const runner = launch(process.execPath, ['tests/browser.cjs'], {
    ...process.env,
    SQUOOSH_TEST_URL: 'http://localhost:5000/',
  });
  assert.equal(await exited(runner), 0);
  const file = fs
    .readdirSync('build/c')
    .find((name) => name.startsWith('BatchCompress-'));
  const assetPath = path.join(
    process.env.LOCALAPPDATA,
    'SquooshBatch',
    version.split(':')[1],
    'build',
    'c',
    file,
  );
  const expected = fs.readFileSync(path.join('build/c', file));
  assert.deepEqual(fs.readFileSync(assetPath), expected);
  await stop(app);
  // Only remove a verified generated asset; the next launch must repair it.
  fs.unlinkSync(assetPath);
  try {
    app = launch(exe, ['--no-browser']);
    await ready('http://127.0.0.1:5000/_squoosh/version');
    assert.deepEqual(fs.readFileSync(assetPath), expected);
  } finally {
    if (!fs.existsSync(assetPath)) fs.writeFileSync(assetPath, expected);
    await stop(app);
  }
  console.log(
    'PASS EXE identity, duplicate launch, browser suite and missing asset repair',
  );
  const corrupt = Buffer.from(expected);
  corrupt[0] ^= 1;
  fs.writeFileSync(assetPath, corrupt);
  try {
    app = launch(exe, ['--no-browser']);
    await ready('http://127.0.0.1:5000/_squoosh/version');
    assert.deepEqual(fs.readFileSync(assetPath), expected);
  } finally {
    fs.writeFileSync(assetPath, expected);
    await stop(app);
  }
  console.log('PASS same-size corrupt asset is repaired');
  otherServer = http.createServer((_req, res) =>
    res.end('Another application'),
  );
  await new Promise((r) => otherServer.listen(5000, '127.0.0.1', r));
  assert.equal(await exited(launch(exe, ['--no-browser'])), 1);
  await new Promise((r) => otherServer.close(r));
  otherServer = undefined;
  console.log('PASS unrelated port owner is rejected');
  const legacy = launch(process.execPath, [
    'Squoosh-Batch-Windows-2026-08-10/local-server.js',
  ]);
  await ready('http://127.0.0.1:5000/');
  assert.equal((await fetch('http://127.0.0.1:5000/%')).status, 400);
  assert.equal((await fetch('http://127.0.0.1:5000/')).status, 200);
  await stop(legacy);
  console.log(
    'PASS malformed URI returns 400 and Node server remains available',
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const child of children) await stop(child);
    if (otherServer) otherServer.close();
  });
