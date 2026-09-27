'use strict';

// Tests, die nur mit echter Datenbank Sinn ergeben. Laufen nur mit
// TEST_DB=mysql://benutzer:passwort@127.0.0.1:3306/datenbank.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mysql = require('mysql2/promise');
const { createMariaDbStore } = require('../src/store-mariadb');
const { startApp } = require('./helpers');
const jobs = require('../src/jobs');

const skip = !process.env.TEST_DB && 'nur mit TEST_DB (MariaDB)';

function dbConfig(extra = {}) {
  const url = new URL(process.env.TEST_DB);
  return {
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    tablePrefix: `m${process.pid}_${Math.random().toString(36).slice(2, 8)}_`,
    ...extra,
  };
}

async function withStore(fn, { importDir } = {}) {
  const store = createMariaDbStore(dbConfig(), { importDir });
  try {
    await store.ready();
    return await fn(store);
  } finally {
    await store.dropTables();
    await store.close();
  }
}

test('Aufträge stehen lesbar in der Tabelle, Emojis und Umlaute bleiben erhalten', { skip }, async () => {
  await withStore(async (store) => {
    const job = await store.updateData((data) => jobs.create(data, {
      title: 'Drache 🐉 für Jörg', requester: 'Oma Inge', quantity: 2, color: 'Grün', notes: 'Größe ~10 cm 👍',
      makerworldUrl: 'https://makerworld.com/de/models/1',
    }));
    await store.updateData((data) => {
      jobs.enqueue(data, job.id);
      jobs.markDone(data, job.id);
    });

    const { tablePrefix, ...access } = dbConfig(); // eslint-disable-line no-unused-vars
    const conn = await mysql.createConnection({ ...access, dateStrings: true });
    try {
      const [[row]] = await conn.query(`SELECT * FROM \`${store.tables.jobs}\` WHERE id = ?`, [job.id]);
      assert.equal(row.title, 'Drache 🐉 für Jörg');
      assert.equal(row.requester, 'Oma Inge');
      assert.equal(row.notes, 'Größe ~10 cm 👍');
      assert.equal(row.makerworld_url, 'https://makerworld.com/de/models/1');
      assert.equal(row.status, 'done');
      assert.match(row.finished_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    } finally {
      await conn.end();
    }

    const [back] = (await store.readData()).jobs;
    assert.equal(back.title, 'Drache 🐉 für Jörg');
    assert.match(back.finishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

test('Datum wird exakt gespeichert und gelesen', { skip }, async () => {
  await withStore(async (store) => {
    await store.updateData((data) => jobs.addPrinted(data, { title: 'Benchy', requester: 'Ich' }, '2024-05-17T12:00:00.000Z'));
    const [job] = (await store.readData()).jobs;
    assert.equal(job.finishedAt, '2024-05-17T12:00:00.000Z');
    assert.equal(job.createdAt, '2024-05-17T12:00:00.000Z');
  });
});

test('Gelöschte Auftragsnummern werden nicht neu vergeben', { skip }, async () => {
  await withStore(async (store) => {
    const a = await store.updateData((data) => jobs.create(data, { title: 'A', requester: 'x' }));
    const b = await store.updateData((data) => jobs.create(data, { title: 'B', requester: 'x' }));
    await store.updateData((data) => jobs.remove(data, b.id));
    const c = await store.updateData((data) => jobs.create(data, { title: 'C', requester: 'x' }));
    assert.deepEqual([a.id, b.id, c.id], [1, 2, 3]);
  });
});

test('Ein Fehler mitten im Speichern ändert nichts (Transaktion)', { skip }, async () => {
  await withStore(async (store) => {
    await store.updateData((data) => jobs.create(data, { title: 'A', requester: 'x' }));
    await assert.rejects(store.updateData((data) => {
      jobs.create(data, { title: 'B', requester: 'x' }); // wird erst gespeichert …
      jobs.create(data, { title: 'C', requester: 'x' }).status = 'kaputt'; // … dann scheitert C
    }));
    const data = await store.readData();
    assert.deepEqual(data.jobs.map((j) => [j.title, j.status]), [['A', 'pending']]);
  });
});

test('Viele gleichzeitige Änderungen gehen nicht verloren', { skip }, async () => {
  await withStore(async (store) => {
    await Promise.all(Array.from({ length: 30 }, (_, i) =>
      store.updateData((data) => jobs.create(data, { title: `Teil ${i}`, requester: 'x' }))));
    const ids = (await store.readData()).jobs.map((j) => j.id);
    assert.equal(ids.length, 30);
    assert.equal(new Set(ids).size, 30);
  });
});

test('Viele Wartende auf dieselbe Sperre blockieren den Inhaber nicht', { skip }, async () => {
  // Mehr Wartende als Verbindungen (5): Der Inhaber muss trotzdem lesen und schreiben können.
  await withStore(async (store) => {
    const started = Date.now();
    await Promise.all(Array.from({ length: 20 }, () => store.withLock('zaehler', async () => {
      const state = await store.readState('zaehler');
      const data = await store.readData();
      await store.writeState('zaehler', { n: (state.n || 0) + 1, jobs: data.jobs.length });
    })));
    assert.equal((await store.readState('zaehler')).n, 20);
    assert.ok(Date.now() - started < 10_000, 'kein Hängen bis zur Zeitüberschreitung');
  });
});

test('Alte Daten aus den JSON-Dateien werden einmalig übernommen', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'druck-import-'));
  const old = {
    nextId: 8,
    jobs: [
      { id: 3, title: 'Drache', requester: 'Leo', makerworldUrl: null, imageUrl: null, quantity: 1, color: 'Grün',
        notes: null, adminNote: 'PLA', status: 'done', position: null, createdAt: '2025-01-01T10:00:00.000Z',
        approvedAt: '2025-01-01T11:00:00.000Z', finishedAt: '2025-01-02T12:00:00.000Z' },
      { id: 7, title: 'Vase', requester: 'Oma', makerworldUrl: null, imageUrl: null, quantity: 2, color: null,
        notes: 'blau', adminNote: null, status: 'queued', position: 1, createdAt: '2026-09-01T10:00:00.000Z',
        approvedAt: '2026-09-01T11:00:00.000Z', finishedAt: null },
    ],
  };
  fs.writeFileSync(path.join(dir, 'auftraege.json'), JSON.stringify(old));
  fs.writeFileSync(path.join(dir, 'discord.json'), JSON.stringify({ lastTop: '[[7]]', lastSentAt: 'x' }));
  try {
    await withStore(async (store) => {
      const data = await store.readData();
      assert.deepEqual(data.jobs, old.jobs);
      assert.equal(data.nextId, 8);
      assert.deepEqual(await store.readState('discord'), { lastTop: '[[7]]', lastSentAt: 'x' });
      assert.ok(fs.existsSync(path.join(dir, 'auftraege.json.importiert')));
      assert.ok(!fs.existsSync(path.join(dir, 'auftraege.json')));
    }, { importDir: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Falsches Datenbank-Passwort: verständliche Fehlerseite statt Absturz', { skip }, async () => {
  const store = createMariaDbStore(dbConfig({ password: 'falsch' }));
  const env = await startApp({}, { store });
  try {
    const res = await env.client().get('/');
    assert.equal(res.status, 503);
    assert.match(res.text, /Benutzername oder Passwort der Datenbank stimmt nicht/);
    assert.doesNotMatch(res.text, /falsch/);
  } finally {
    await env.close();
  }
});
