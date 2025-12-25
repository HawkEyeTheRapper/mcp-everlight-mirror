// javascript
// scripts/build-logs.js
const fs = require('fs').promises;
const path = require('path');
const {marked} = require('marked');

const BASE_URL = 'https://mcp.everlightos.com/logs/';

(async () => {
  const srcDir = path.join(__dirname, '..', 'everlight-context', 'logs');
  const outDir = path.join(__dirname, '..', 'dist', 'logs');
  await fs.mkdir(outDir, { recursive: true });

  const files = (await fs.readdir(srcDir)).filter(f => f.endsWith('.md'));
  
  const pages = files.map(f => {
    const name = path.basename(f, '.md');
    const outName = name + '.html';
    const firstChar = name.trim().charAt(0).toLowerCase();
    let subdir = 'other';
    if (firstChar >= 'a' && firstChar <= 'z') {
        subdir = firstChar;
    } else if (firstChar >= '0' && firstChar <= '9') {
        subdir = '0-9';
    }
    return { src: path.join(srcDir, f), name, outName, subdir };
  });

  const allSubdirs = [...new Set(pages.map(p => p.subdir))];
  for (const subdir of allSubdirs) {
    await fs.mkdir(path.join(outDir, subdir), { recursive: true });
  }

  const navLinks = pages.map(p => `<li><a href="/logs/${p.subdir}/${p.outName}">${p.name}</a></li>`).join('');
  const navHtml = `<nav><ul>${navLinks}</ul></nav>`;

  for (const p of pages) {
    const md = await fs.readFile(p.src, 'utf8');
    const body = marked(md);
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${p.name}</title>
  <style>/* minimal styling */ body{font-family:system-ui,Segoe UI,Helvetica,Arial} nav{margin-bottom:1rem}</style>
</head>
<body>
  ${navHtml}
  <main>${body}</main>
</body>
</html>`;
    await fs.writeFile(path.join(outDir, p.subdir, p.outName), html, 'utf8');
  }

  const indexHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logs index</title></head><body>
  <h1>Logs</h1>
  ${navHtml}
</body></html>`;
  await fs.writeFile(path.join(outDir, 'index.html'), indexHtml, 'utf8');

  const today = new Date().toISOString().split('T')[0];
  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}index.html</loc>
    <lastmod>${today}</lastmod>
  </url>`;

  for (const p of pages) {
    sitemap += `
  <url>
    <loc>${BASE_URL}${p.subdir}/${p.outName}</loc>
    <lastmod>${today}</lastmod>
  </url>`;
  }

  sitemap += `
</urlset>`;

  await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8');

  console.log('Built', pages.length, 'pages and sitemap.xml →', outDir);
})();
