'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pwa = require('../src/pwa');
const { startApp } = require('./helpers');

const PUBLIC = path.join(__dirname, '..', 'public');

let env;
beforeEach(async () => {
  env = await startApp();
});
afterEach(() => env.close());

async function fetchRaw(url) {
  const res = await fetch(env.client().base + url);
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

/** Breite × Höhe aus einer PNG- oder JPEG-Datei. */
function imageSize(buf) {
  if (buf.subarray(1, 4).toString() === 'PNG') return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'weder PNG noch JPEG');
  let offset = 2;
  while (offset < buf.length) {
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return `${buf.readUInt16BE(offset + 7)}x${buf.readUInt16BE(offset + 5)}`;
    }
    offset += 2 + length;
  }
  throw new Error('JPEG ohne Größenangabe');
}

test('Manifest: vollständig, und alle Bilder gibt es in der angegebenen Größe', async () => {
  const res = await fetchRaw('/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = JSON.parse(res.body.toString('utf8'));

  assert.equal(manifest.name, '3D-Druck-Warteschlange');
  assert.equal(manifest.short_name, '3D-Druck');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'de');
  const purposes = (size, purpose) => manifest.icons.some((i) => i.sizes === size && i.purpose === purpose);
  for (const size of ['192x192', '512x512']) {
    assert.ok(purposes(size, 'any'), `Symbol ${size} (any) fehlt`);
    assert.ok(purposes(size, 'maskable'), `Symbol ${size} (maskable) fehlt`);
  }
  assert.deepEqual(manifest.shortcuts.map((s) => s.url), ['/', '/warteschlange', '/admin']);
  assert.ok(manifest.screenshots.some((s) => s.form_factor === 'narrow'));
  assert.ok(manifest.screenshots.some((s) => s.form_factor === 'wide'));

  const images = [
    ...manifest.icons,
    ...manifest.shortcuts.flatMap((s) => s.icons),
    ...manifest.screenshots,
  ];
  for (const image of images) {
    const file = await fetchRaw(image.src);
    assert.equal(file.status, 200, image.src);
    assert.equal(file.headers.get('content-type'), image.type, image.src);
    assert.equal(imageSize(file.body), image.sizes, image.src);
  }
});

test('Symbole für iPhone und Browser', async () => {
  assert.equal(imageSize(fs.readFileSync(path.join(PUBLIC, 'apple-touch-icon.png'))), '180x180');
  assert.equal(imageSize(fs.readFileSync(path.join(PUBLIC, 'favicon-32.png'))), '32x32');
  for (const url of ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/favicon-32.png']) {
    assert.equal((await fetchRaw(url)).status, 200, url);
  }
  const svg = fs.readFileSync(path.join(PUBLIC, 'favicon.svg'), 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
});

test('Service Worker: nie zwischengespeichert, gültiges JavaScript, alle Dateien erreichbar', async () => {
  const res = await fetchRaw('/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/javascript/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const source = res.body.toString('utf8');
  assert.doesNotThrow(() => new vm.Script(source), 'sw.js lässt sich nicht übersetzen');

  const version = pwa.assetVersion();
  assert.match(version, /^[0-9a-f]{12}$/);
  assert.match(source, new RegExp(`const CACHE = 'druck-${version}'`));
  const precache = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(source)[1]);
  assert.deepEqual(precache, pwa.precacheList(version));
  assert.ok(precache.includes('/offline.html'));
  for (const url of precache) assert.equal((await fetchRaw(url)).status, 200, url);
});

test('Seiten binden Manifest, Symbole und die aktuelle Version von Aussehen und Skript ein', async () => {
  const version = pwa.assetVersion();
  const admin = await env.admin();
  for (const [client, url] of [[env.client(), '/'], [env.client(), '/warteschlange'], [env.client(), '/admin/login'],
    [admin, '/admin'], [admin, '/admin/archiv']]) {
    const page = (await client.get(url)).text;
    assert.match(page, /<link rel="manifest" href="\/manifest.webmanifest">/, url);
    assert.match(page, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/, url);
    assert.ok(page.includes(`href="/style.css?v=${version}"`), `${url}: style.css ohne Version`);
    assert.ok(page.includes(`src="/app.js?v=${version}" defer`), `${url}: app.js fehlt`);
    assert.match(page, /<aside class="install" id="install" hidden/, `${url}: Installations-Hinweis fehlt`);
    assert.match(page, /<span class="brand-mark"><svg[^>]*aria-hidden="true"/, `${url}: Logo fehlt`);
  }
  const archive = (await admin.get('/admin/archiv')).text;
  assert.ok(archive.includes(`src="/archiv.js?v=${version}"`));
});

test('Offline-Seite: eigenes Aussehen, ohne Menü und ohne Installations-Hinweis', async () => {
  const res = await fetchRaw('/offline.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const page = res.body.toString('utf8');
  assert.match(page, /Keine Verbindung/);
  assert.match(page, /Nochmal versuchen/);
  assert.ok(page.includes(`href="/style.css?v=${pwa.assetVersion()}"`));
  assert.doesNotMatch(page, /class="tabbar"|class="topnav"|id="install"/);
  assert.doesNotMatch(page, /\p{Extended_Pictographic}/u);
});

test('Service Worker und Offline-Seite gehen auch, wenn die Datenbank nicht erreichbar ist', async () => {
  const down = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const broken = await startApp({}, { store: { kind: 'mariadb', ready: () => Promise.reject(down), close: async () => {} } });
  try {
    const base = broken.client().base;
    assert.equal((await fetch(`${base}/`)).status, 503);
    assert.equal((await fetch(`${base}/sw.js`)).status, 200);
    assert.equal((await fetch(`${base}/offline.html`)).status, 200);
    assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 200);
  } finally {
    await broken.close();
  }
});
