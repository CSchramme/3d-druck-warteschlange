'use strict';

// npm run aktualisieren [branch]
//
// Holt die neueste Version der App von GitHub und spielt sie ein – ohne git,
// ohne ZIP-Hochladen. Danach werden (falls nötig) die Pakete installiert und die
// App neu gestartet. Deine Daten (Ordner data/, Datei .env) werden nie angefasst.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const REPO = 'CSchramme/3d-druck-warteschlange';
const DEFAULT_BRANCH = 'claude/3d-druck-auftraege-verwaltung-91x84h';
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = '.aktualisierung.json';
// Diese Pfade gehören dir bzw. dem Server und werden nie überschrieben oder gelöscht.
const KEEP = new Set(['data', '.env', 'node_modules', '.git', 'tmp', MANIFEST]);

// --- tar lesen (GitHub liefert .tar.gz) ---------------------------------------------

function parsePax(data) {
  const values = {};
  let rest = data.toString('utf8');
  while (rest.length) {
    const space = rest.indexOf(' ');
    const length = parseInt(rest.slice(0, space), 10);
    if (!length) break;
    const record = rest.slice(space + 1, length - 1); // ohne abschließendes \n
    const eq = record.indexOf('=');
    values[record.slice(0, eq)] = record.slice(eq + 1);
    rest = rest.slice(length);
  }
  return values;
}

/** Liest ein (entpacktes) tar-Archiv. Gibt { commit, entries: [{ name, type, data }] } zurück. */
function parseTar(buffer) {
  const entries = [];
  const globalPax = {};
  let nextPax = {};
  let longName = null;
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const field = (start, length) => {
      const raw = header.subarray(start, start + length);
      const end = raw.indexOf(0);
      return raw.subarray(0, end === -1 ? length : end).toString('utf8');
    };
    const expected = parseInt(field(148, 8).trim(), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== expected) throw new Error('Das heruntergeladene Archiv ist beschädigt (Prüfsumme falsch).');

    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    let name = field(0, 100);
    const prefix = field(257, 5) === 'ustar' ? field(345, 155) : '';
    if (prefix) name = `${prefix}/${name}`;
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'g') Object.assign(globalPax, parsePax(data));
    else if (type === 'x') nextPax = parsePax(data);
    else if (type === 'L') longName = data.toString('utf8').replace(/\0[\s\S]*$/, '');
    else {
      entries.push({ name: longName || nextPax.path || name, type, data });
      nextPax = {};
      longName = null;
    }
  }
  return { commit: globalPax.comment || null, entries };
}

// --- einspielen ----------------------------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Spielt ein .tar.gz von GitHub in root ein. Prüft erst alles, schreibt dann.
 * Gibt { commit, written, removed, packagesChanged } zurück.
 */
function applyUpdate(tarGz, root, { branch = null } = {}) {
  const { commit, entries } = parseTar(zlib.gunzipSync(tarGz));

  const files = [];
  for (const entry of entries) {
    const parts = entry.name.split('/').filter(Boolean);
    if (parts.some((part) => part === '..' || part === '.') || path.isAbsolute(entry.name)) {
      throw new Error(`Unsicherer Pfad im Archiv: ${entry.name} – nichts geändert.`);
    }
    parts.shift(); // oberster Ordner, z. B. „3d-druck-warteschlange-main“
    if (!parts.length || entry.type !== '0' || KEEP.has(parts[0])) continue;
    files.push({ rel: parts.join('/'), data: entry.data });
  }
  const names = new Set(files.map((file) => file.rel));
  if (!names.has('app.js') || !names.has('package.json')) {
    throw new Error('Das Archiv sieht nicht nach dieser App aus (app.js/package.json fehlen) – nichts geändert.');
  }

  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(root, rel));
    } catch {
      return null;
    }
  };
  const packagesChanged = ['package.json', 'package-lock.json'].some((rel) => {
    const incoming = files.find((file) => file.rel === rel);
    const current = read(rel);
    return incoming ? !current || !current.equals(incoming.data) : false;
  });

  let written = 0;
  for (const { rel, data } of files) {
    const target = path.join(root, rel);
    if (!target.startsWith(root + path.sep)) throw new Error(`Unsicherer Pfad: ${rel}`);
    const current = read(rel);
    if (current && current.equals(data)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.neu-${process.pid}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
    written++;
  }

  // Dateien, die beim letzten Aktualisieren kamen und jetzt nicht mehr dabei sind, entfernen.
  let removed = 0;
  const previous = readJson(path.join(root, MANIFEST), { files: [] });
  for (const rel of previous.files || []) {
    if (names.has(rel) || KEEP.has(rel.split('/')[0]) || rel.split('/').includes('..')) continue;
    try {
      fs.unlinkSync(path.join(root, rel));
      removed++;
    } catch {
      // schon weg
    }
  }

  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify({
    commit, branch, updatedAt: new Date().toISOString(), files: [...names].sort(),
  }, null, 2));
  return { commit, written, removed, packagesChanged };
}

function installPackages(root) {
  const npm = process.env.npm_execpath;
  const args = ['install', '--omit=dev', '--no-audit', '--no-fund'];
  const result = npm
    ? spawnSync(process.execPath, [npm, ...args], { cwd: root, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error('„npm install“ ist fehlgeschlagen – bitte in Plesk „NPM install“ klicken.');
}

/** Passenger (Plesk) startet die App neu, wenn sich tmp/restart.txt ändert. */
function requestRestart(root) {
  const file = path.join(root, 'tmp', 'restart.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, new Date().toISOString());
}

async function main() {
  const previous = readJson(path.join(ROOT, MANIFEST), {});
  const branch = process.argv[2] || process.env.UPDATE_BRANCH || previous.branch || DEFAULT_BRANCH;
  const url = process.env.UPDATE_SOURCE_URL
    || `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;

  console.log(`⬇️  Lade die neueste Version von GitHub (${REPO}, Branch „${branch}“) …`);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (response.status === 404) throw new Error(`Den Branch „${branch}“ gibt es auf GitHub nicht.`);
  if (!response.ok) throw new Error(`GitHub antwortete mit ${response.status}.`);
  const archive = Buffer.from(await response.arrayBuffer());

  const result = applyUpdate(archive, ROOT, { branch });
  const version = result.commit ? result.commit.slice(0, 7) : 'unbekannt';
  if (previous.commit && previous.commit === result.commit) {
    console.log(`✅ Du hast schon die neueste Version (${version}).`);
  } else {
    console.log(`✅ Version ${version} eingespielt: ${result.written} Dateien neu/geändert, ${result.removed} entfernt.`);
  }

  if (result.packagesChanged || !fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
    console.log('📦 Pakete haben sich geändert – installiere …');
    installPackages(ROOT);
  }
  requestRestart(ROOT);
  console.log('🔄 Fertig! Die App startet beim nächsten Seitenaufruf mit der neuen Version.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ Aktualisieren fehlgeschlagen: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseTar, applyUpdate, KEEP, MANIFEST };
