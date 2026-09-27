'use strict';

// Alles für die installierbare App (PWA): Service Worker und Offline-Seite.
//
// Der Service Worker speichert nur Aussehen, Skripte und das Symbol – keine Seiten
// mit Aufträgen oder Namen. Seiten kommen immer frisch vom Server; ohne Internet
// erscheint stattdessen die Offline-Seite. Die Versionsnummer ergibt sich aus dem
// Inhalt der Dateien: Nach jedem Update lädt die App die neuen Dateien von selbst.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Werden in der Seite mit ?v=<Version> eingebunden – ein Update ändert also die Adresse.
const VERSIONED = ['/style.css', '/app.js', '/archiv.js'];
const STATIC = ['/favicon.svg'];
const OFFLINE_URL = '/offline.html';
// Bestimmen, wie die Seiten (und die Offline-Seite) aussehen.
const SOURCES = ['src/views.js', 'src/logo.js', 'src/icons.js', 'src/pwa.js'];

let version = null;

/** Kurzer Fingerabdruck von Aussehen und Skripten – ändert sich mit jedem Update daran. */
function assetVersion() {
  if (!version) {
    const hash = crypto.createHash('sha256');
    for (const asset of [...VERSIONED, ...STATIC]) hash.update(fs.readFileSync(path.join(ROOT, 'public', asset)));
    for (const file of SOURCES) hash.update(fs.readFileSync(path.join(ROOT, file)));
    version = hash.digest('hex').slice(0, 12);
  }
  return version;
}

/** Adresse einer Datei aus public/, wie die Seite sie einbindet. */
function assetUrl(asset, v = assetVersion()) {
  return VERSIONED.includes(asset) ? `${asset}?v=${v}` : asset;
}

function precacheList(v) {
  return [...VERSIONED, ...STATIC].map((asset) => assetUrl(asset, v)).concat(OFFLINE_URL);
}

function serviceWorker(v) {
  return `'use strict';
// Service Worker der 3D-Druck-Warteschlange – Version ${v}
const CACHE = 'druck-${v}';
const PRECACHE = ${JSON.stringify(precacheList(v))};
const OFFLINE_URL = '${OFFLINE_URL}';
const PATHS = PRECACHE.map((url) => url.split('?')[0]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('druck-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Seiten immer frisch vom Server – ohne Internet die Offline-Seite.
  // Downloads (CSV, HTML-Export) laufen ganz normal am Service Worker vorbei.
  if (request.mode === 'navigate') {
    if (/\\.(csv|html)$/.test(url.pathname)) return;
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  // Aussehen, Skripte, Symbol: aus dem Speicher. Eine neue Version hat eine
  // neue Adresse (?v=…) und kommt deshalb frisch vom Server.
  if (PATHS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
`;
}

module.exports = { VERSIONED, STATIC, OFFLINE_URL, assetVersion, assetUrl, precacheList, serviceWorker };
