'use strict';

// Tests für die npm-Befehle: aktualisieren, passwort, pruefen, einstellen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');

const { applyUpdate, parseTar } = require('../scripts/aktualisieren');
const { updateEnvText, parseAssignments } = require('../scripts/einstellen');
const { parseEnvText } = require('../src/config');
const { createFileStore } = require('../src/store');
const { verifyPassword } = require('../src/users');

const ROOT = path.resolve(__dirname, '..');
const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `druck-${name}-`));

// --- kleines tar-Werkzeug für Test-Archive -------------------------------------------

function header(name, size, type) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'utf8');
  block.write('0000644\0', 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  block.write('00000000000\0', 136);
  block.write('        ', 148);
  block.write(type, 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

const pad = (data) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length) length++;
  return `${length}${body}`;
}

/** files: { 'pfad': 'inhalt' }; commit landet wie bei GitHub im globalen pax-Kopf. */
function makeTarGz(files, { commit = 'abc1234def', top = 'app-main' } = {}) {
  const parts = [];
  const global = Buffer.from(paxRecord('comment', commit));
  parts.push(header('pax_global_header', global.length, 'g'), pad(global));
  parts.push(header(`${top}/`, 0, '5'));
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const full = name.startsWith('/') ? name : `${top}/${name}`;
    if (full.length > 100) {
      const pax = Buffer.from(paxRecord('path', full));
      parts.push(header('PaxHeader', pax.length, 'x'), pad(pax));
      parts.push(header(full.slice(0, 99), data.length, '0'), pad(data));
    } else {
      parts.push(header(full, data.length, '0'), pad(data));
    }
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

const APP = { 'app.js': 'console.log(1)', 'package.json': '{"name":"x"}', 'src/a.js': 'a' };

// --- aktualisieren ----------------------------------------------------------------------

test('Aktualisieren spielt Dateien ein und lässt Daten, .env und node_modules in Ruhe', () => {
  const dir = tmpDir('update');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'auftraege.json'), 'meine Daten');
  fs.writeFileSync(path.join(dir, '.env'), 'DB_PASSWORD=bleibt');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'eigene-notiz.txt'), 'bleibt auch');

  const archive = makeTarGz({
    ...APP, 'data/auftraege.json': 'ÜBERSCHRIEBEN', '.env': 'ÜBERSCHRIEBEN', 'node_modules/x.js': 'x',
  }, { commit: 'c0ffee1' });
  const result = applyUpdate(archive, dir, { branch: 'main' });

  assert.equal(result.commit, 'c0ffee1');
  assert.equal(result.written, 3);
  assert.equal(result.packagesChanged, true);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'a');
  assert.equal(fs.readFileSync(path.join(dir, 'data', 'auftraege.json'), 'utf8'), 'meine Daten');
  assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'DB_PASSWORD=bleibt');
  assert.ok(!fs.existsSync(path.join(dir, 'node_modules', 'x.js')));
  assert.ok(fs.existsSync(path.join(dir, 'eigene-notiz.txt')));

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.aktualisierung.json'), 'utf8'));
  assert.deepEqual(manifest.files, ['app.js', 'package.json', 'src/a.js']);
  assert.equal(manifest.branch, 'main');

  // Gleiche Version nochmal: nichts zu tun.
  assert.deepEqual(applyUpdate(archive, dir), { commit: 'c0ffee1', written: 0, removed: 0, packagesChanged: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Aktualisieren entfernt nur Dateien, die es selbst gebracht hat', () => {
  const dir = tmpDir('update');
  applyUpdate(makeTarGz({ ...APP, 'src/alt.js': 'weg damit' }), dir);
  fs.writeFileSync(path.join(dir, 'src', 'eigene.js'), 'bleibt');
  const result = applyUpdate(makeTarGz({ ...APP, 'src/neu.js': 'neu' }), dir);
  assert.equal(result.removed, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'src', 'alt.js')));
  assert.ok(fs.existsSync(path.join(dir, 'src', 'neu.js')));
  assert.ok(fs.existsSync(path.join(dir, 'src', 'eigene.js')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Aktualisieren lehnt gefährliche oder falsche Archive ab, ohne etwas zu ändern', () => {
  const dir = tmpDir('update');
  const nothingWritten = () => assert.deepEqual(fs.readdirSync(dir), []);

  assert.throws(() => applyUpdate(makeTarGz({ ...APP, '../../boese.js': 'x' }), dir), /Unsicherer Pfad/);
  nothingWritten();
  assert.throws(() => applyUpdate(makeTarGz({ ...APP, '/etc/boese': 'x' }), dir), /Unsicherer Pfad/);
  nothingWritten();
  assert.throws(() => applyUpdate(makeTarGz({ 'README.md': 'x' }), dir), /sieht nicht nach dieser App aus/);
  nothingWritten();

  const broken = zlib.gunzipSync(makeTarGz(APP));
  broken[1024 + 10] ^= 0xff; // Kopf des Ordner-Eintrags (3. Block) beschädigen
  assert.throws(() => applyUpdate(zlib.gzipSync(broken), dir), /beschädigt/);
  nothingWritten();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Lange Pfade (pax) werden richtig gelesen', () => {
  const long = `src/${'sehr-langer-ordnername/'.repeat(5)}datei.js`;
  const { entries } = parseTar(zlib.gunzipSync(makeTarGz({ [long]: 'lang' })));
  assert.ok(entries.some((e) => e.name === `app-main/${long}` && e.data.toString() === 'lang'));
});

test('Echtes GitHub-Archiv (mit git archive gebaut) wird vollständig eingespielt', () => {
  const dir = tmpDir('update');
  const archive = execFileSync('git', ['archive', '--format=tar.gz', '--prefix=3d-druck-warteschlange-main/', 'HEAD'], { cwd: ROOT });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
  const result = applyUpdate(archive, dir);
  assert.equal(result.commit, commit);
  const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: ROOT }).toString().trim().split('\n');
  for (const file of tracked) assert.ok(fs.existsSync(path.join(dir, file)), file);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- einstellen ---------------------------------------------------------------------------

test('.env schreiben: ändern, ergänzen, entfernen – und zurücklesen ergibt dasselbe', () => {
  let text = '# Kommentar bleibt\nDB_NAME=alt\nDB_HOST=weg\n';
  text = updateEnvText(text, parseAssignments(['DB_NAME=neu', 'DB_PASSWORD=Zn"sc#gd M4.0', 'DB_HOST=']));
  assert.match(text, /^# Kommentar bleibt\n/);
  assert.deepEqual(parseEnvText(text), { DB_NAME: 'neu', DB_PASSWORD: 'Zn"sc#gd M4.0' });
  assert.throws(() => parseAssignments(['kleinbuchstaben=x']), /GROSSBUCHSTABEN/);
  assert.throws(() => parseAssignments(['OHNE_WERT']), /NAME=wert/);
});

// --- passwort & pruefen (als echte npm-Befehle) ------------------------------------------

function run(script, args, env) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 30_000,
  });
}

/** Umgebung für die Befehle – mit TEST_DB gegen MariaDB (eigene Tabellen), sonst Dateien. */
function commandEnv(name) {
  const dataDir = tmpDir(name);
  const env = { DATA_DIR: dataDir };
  let store;
  if (process.env.TEST_DB) {
    const url = new URL(process.env.TEST_DB);
    const db = {
      host: url.hostname, port: Number(url.port) || 3306, user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password), database: url.pathname.slice(1),
      tablePrefix: `s${process.pid}_${name}_`,
    };
    Object.assign(env, {
      DB_HOST: db.host, DB_PORT: String(db.port), DB_USER: db.user, DB_PASSWORD: db.password,
      DB_NAME: db.database, DB_TABLE_PREFIX: db.tablePrefix,
    });
    store = require('../src/store-mariadb').createMariaDbStore(db);
  } else {
    store = createFileStore(dataDir);
  }
  const cleanup = async () => {
    if (store.dropTables) await store.dropTables();
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { env, store, cleanup };
}

test('npm run passwort legt ein Konto an bzw. setzt ein neues Passwort', async () => {
  const { env, store, cleanup } = commandEnv('passwort');
  try {
    const usage = run('passwort.js', [], env);
    assert.equal(usage.status, 1);
    assert.match(usage.stdout, /Aufruf: npm run passwort <benutzername>/);

    const created = run('passwort.js', ['Tim', 'Tim', 'S.'], env);
    assert.equal(created.status, 0, created.stderr);
    const first = /\n {4}(\S+)\n/.exec(created.stdout)[1];
    let user = await store.findUser('tim');
    assert.equal(user.displayName, 'Tim S.');
    assert.ok(await verifyPassword(first, user.passwordHash));

    await store.updateUser(user.id, { failedLogins: 3, lockedUntil: new Date(Date.now() + 60_000).toISOString() });
    const reset = run('passwort.js', ['tim'], env);
    assert.equal(reset.status, 0, reset.stderr);
    const second = /\n {4}(\S+)\n/.exec(reset.stdout)[1];
    assert.notEqual(second, first);
    user = await store.findUser('tim');
    assert.ok(await verifyPassword(second, user.passwordHash));
    assert.equal(user.sessionVersion, 2); // alte Anmeldungen sind ungültig
    assert.equal(user.lockedUntil, null);

    assert.equal(run('passwort.js', ['x'], env).status, 1);
  } finally {
    await cleanup();
  }
});

test('npm run pruefen meldet den Zustand verständlich', async () => {
  const { env, cleanup } = commandEnv('pruefen');
  try {
    const good = run('pruefen.js', [], env);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /Aufträge: 0 warten auf Freigabe/);
    assert.match(good.stdout, /Alles in Ordnung/);

    if (process.env.TEST_DB) {
      const wrong = run('pruefen.js', [], { ...env, DB_PASSWORD: 'falsch' });
      assert.equal(wrong.status, 1);
      assert.match(wrong.stdout, /Benutzername oder Passwort der Datenbank stimmt nicht/);
      assert.doesNotMatch(wrong.stdout, /falsch/);
    }
  } finally {
    await cleanup();
  }
});
