const fs = require('fs');
const http = require('http');
const path = require('path');

const port = 5000;
const root = path.resolve(__dirname, 'build');
const contentTypes = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

http
  .createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      );
    } catch {
      response.writeHead(400).end('Bad Request');
      return;
    }
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(root, `.${requestedPath}`);

    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Type':
          contentTypes[path.extname(filePath)] || 'application/octet-stream',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      });
      response.end(data);
    });
  })
  .on('error', (error) => {
    console.error(`Unable to start Squoosh: ${error.message}`);
    process.exitCode = 1;
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Squoosh batch compressor: http://localhost:${port}`);
    console.log('Press Ctrl+C to stop.');
  });
