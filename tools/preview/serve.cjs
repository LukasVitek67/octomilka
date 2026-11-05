// Mini server pro náhled panelu: node tools/preview/serve.cjs → http://127.0.0.1:5178/view-main-dark.html
const http = require('http');
const fs = require('fs');
const path = require('path');
http
  .createServer((req, res) => {
    const f = path.join(__dirname, 'out', path.basename(decodeURIComponent(req.url.split('?')[0])) || 'view-main-dark.html');
    fs.readFile(f, (e, d) => {
      if (e) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(d);
    });
  })
  .listen(5178, '127.0.0.1');
