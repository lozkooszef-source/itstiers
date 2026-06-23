const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const apiHandler = require('./api/[...path].js');

const root = __dirname;
const port = Number.parseInt(process.env.PORT || '3111', 10);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

function staticPath(urlPath) {
  if (urlPath === '/' || urlPath.startsWith('/ranking/')) {
    return path.join(root, 'index.html');
  }

  return path.join(root, urlPath);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    apiHandler(req, res);
    return;
  }

  const url = new URL(req.url, `http://localhost:${port}`);
  const filePath = staticPath(url.pathname);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    res.writeHead(200, {
      'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream'
    });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`ItsSubTiers preview: http://localhost:${port}/ranking/overall`);
});
