'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { startApp } = require('./helpers');
const jobs = require('../src/jobs');

let env;
let admin;
beforeEach(async () => {
  env = await startApp();
  admin = await env.admin();
});
afterEach(() => env.close());

/** Reicht Aufträge ein, gibt sie frei und markiert sie als gedruckt. */
async function printAll(...entries) {
  for (const entry of entries) {
    const fields = typeof entry === 'string' ? { title: entry } : entry;
    await admin.submit(fields);
    const id = env.idOf(fields.title);
    await admin.post(`/admin/auftrag/${id}/approve`);
    await admin.post(`/admin/auftrag/${id}/done`);
  }
}

/** IDs der Archiv-Einträge, die gerade sichtbar sind. */
function visibleIds(page) {
  return [...page.matchAll(/<li class="job job-admin" id="auftrag-(\d+)"[^>]*>/g)]
    .filter(([tag]) => !/\shidden>$/.test(tag))
    .map(([, id]) => Number(id));
}

const archiveTitles = (page) => visibleIds(page).map((id) => env.data().jobs.find((j) => j.id === id).title);

test('Archiv braucht den Admin-Login', async () => {
  const res = await env.client().get('/admin/archiv');
  assert.equal(res.status, 303);
  assert.equal(res.location, '/admin/login');
  assert.equal((await env.client().get('/admin/archiv.csv')).status, 303);
});

test('Gedruckte Aufträge landen im Archiv, offene nicht', async () => {
  await printAll('Drache', { title: 'Kräuterschilder', requester: 'Mama', color: 'Grün' });
  await admin.submit({ title: 'Noch offen' });
  const page = (await admin.get('/admin/archiv')).text;
  assert.deepEqual(archiveTitles(page), ['Kräuterschilder', 'Drache']);
  assert.match(page, /<strong id="stat-drucke">2<\/strong>/);
  assert.match(page, /<strong id="stat-personen">2<\/strong>/);
});

test('Suche findet über alle Felder, auch ohne Umlaute', async () => {
  await printAll(
    { title: 'Kräuterschilder', requester: 'Mama', notes: 'Basilikum, Minze' },
    { title: 'Drache', requester: 'Oma Inge', color: 'Grün' },
    { title: 'Vase', requester: 'Papa' },
  );
  const search = async (q) => archiveTitles((await admin.get(`/admin/archiv?q=${encodeURIComponent(q)}`)).text);
  assert.deepEqual(await search('krauter'), ['Kräuterschilder']);
  assert.deepEqual(await search('MINZE'), ['Kräuterschilder']);
  assert.deepEqual(await search('grun'), ['Drache']);
  assert.deepEqual(await search('oma drache'), ['Drache']);
  assert.deepEqual(await search('oma vase'), []);
  assert.deepEqual(await search(String(new Date().getFullYear())).then((t) => t.length), 3);
  const empty = (await admin.get('/admin/archiv?q=gibtsnicht')).text;
  assert.match(empty, /<p class="empty" id="archiv-leer">Nichts gefunden/);
});

test('Filter nach Person und Sortierung', async () => {
  await printAll({ title: 'B-Teil', requester: 'Mama' }, { title: 'A-Teil', requester: 'Papa' },
    { title: 'C-Teil', requester: 'Mama' });
  const titles = async (query) => archiveTitles((await admin.get(`/admin/archiv?${query}`)).text);
  assert.deepEqual(await titles('person=mama'), ['C-Teil', 'B-Teil']);
  assert.deepEqual(await titles('sort=titel'), ['A-Teil', 'B-Teil', 'C-Teil']);
  assert.deepEqual(await titles('sort=alt'), ['B-Teil', 'A-Teil', 'C-Teil']);
  assert.deepEqual(await titles('sort=quatsch'), ['C-Teil', 'A-Teil', 'B-Teil']);
});

test('Früheren Druck nachtragen', async () => {
  const res = await admin.post('/admin/archiv/nachtragen', {
    requester: 'Ich', title: 'Benchy', quantity: '3', color: 'Orange', printed_at: '2024-05-17',
  });
  assert.equal(res.status, 303);
  const [job] = env.byStatus('done');
  assert.equal(job.title, 'Benchy');
  assert.equal(job.quantity, 3);
  assert.equal(job.finishedAt, '2024-05-17T12:00:00.000Z');
  const page = (await admin.get('/admin/archiv?q=2024')).text;
  assert.deepEqual(archiveTitles(page), ['Benchy']);
  assert.match(page, /17\.05\.2024/);
  assert.deepEqual(env.sent, []); // das Archiv berührt die Warteschlange nicht
});

test('Nachtragen mit falschem Datum wird abgelehnt', async () => {
  for (const printed_at of ['', '2024-13-01', '2099-01-01']) {
    const res = await admin.post('/admin/archiv/nachtragen', { requester: 'Ich', title: 'X', printed_at });
    assert.equal(res.status, 400, printed_at);
    assert.match(res.text, /gültiges Druckdatum/);
  }
  assert.equal(env.data().jobs.length, 0);
});

test('Mehrere Links auf einmal importieren', async () => {
  const res = await admin.post('/admin/archiv/import', {
    links: 'https://makerworld.com/de/models/111-a\nkein link\nmakerworld.com/de/models/222-b\nhttps://makerworld.com/de/models/111-a',
    requester: 'Leo',
    printed_at: '2025-12-24',
  });
  assert.equal(res.status, 303);
  const done = env.byStatus('done');
  assert.deepEqual(done.map((j) => j.title).sort(), ['MakerWorld-Modell 111', 'MakerWorld-Modell 222']);
  assert.ok(done.every((j) => j.requester === 'Leo' && j.finishedAt.startsWith('2025-12-24')));
  const page = (await admin.get('/admin/archiv')).text;
  assert.match(page, /2 Drucke ins Archiv übernommen/);
  assert.match(page, /Übersprungen \(kein gültiger Link\): kein link/);
});

test('Import ohne gültige Links zeigt Fehler und behält die Eingaben', async () => {
  const res = await admin.post('/admin/archiv/import', { links: 'quatsch', requester: 'Leo', printed_at: '2025-01-01' });
  assert.equal(res.status, 400);
  assert.match(res.text, /mindestens einen gültigen Link/);
  assert.match(res.text, /<details class="add-own" open>\s*<summary>📋/);
  assert.equal(env.data().jobs.length, 0);
});

test('„Nochmal drucken“ legt eine Kopie in die Warteschlange', async () => {
  await printAll({ title: 'Drache', requester: 'Leo', color: 'Grün', quantity: '2' });
  const original = env.byStatus('done')[0];
  const res = await admin.post(`/admin/auftrag/${original.id}/nochmal`, { back: '/admin/archiv?q=drache' });
  assert.equal(res.status, 303);
  assert.equal(res.location, `/admin/archiv?q=drache#auftrag-${original.id}`);

  const [copy] = jobs.queue(env.data());
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.title, 'Drache');
  assert.equal(copy.quantity, 2);
  assert.equal(copy.color, 'Grün');
  assert.equal(env.byStatus('done').length, 1); // das Original bleibt im Archiv
  assert.deepEqual(env.sent.at(-1).embeds.map((e) => e.title), ['Drache']);
  assert.match((await admin.get('/admin/archiv')).text, /steht als neuer Auftrag auf Platz 1/);

  // nur gedruckte Aufträge lassen sich so kopieren
  assert.equal((await admin.post(`/admin/auftrag/${copy.id}/nochmal`)).status, 404);
});

test('Druckdatum bearbeiten, Rücksprung ins Archiv', async () => {
  await printAll('Vase');
  const job = env.byStatus('done')[0];
  const form = (await admin.get(`/admin/auftrag/${job.id}/bearbeiten?back=${encodeURIComponent('/admin/archiv?q=vase')}`)).text;
  assert.match(form, /name="printed_at" type="date" required value="\d{4}-\d{2}-\d{2}"/);

  // Datum unverändert -> Uhrzeit bleibt erhalten
  const today = /name="printed_at" type="date" required value="([\d-]+)"/.exec(form)[1];
  await admin.post(`/admin/auftrag/${job.id}/bearbeiten`, {
    requester: 'Oma', title: 'Vase', printed_at: today, back: '/admin/archiv?q=vase',
  });
  assert.equal(env.byStatus('done')[0].finishedAt, job.finishedAt);

  const res = await admin.post(`/admin/auftrag/${job.id}/bearbeiten`, {
    requester: 'Oma', title: 'Vase groß', printed_at: '2023-03-03', back: '/admin/archiv?q=vase',
  });
  assert.equal(res.location, `/admin/archiv?q=vase#auftrag-${job.id}`);
  const edited = env.byStatus('done')[0];
  assert.equal(edited.title, 'Vase groß');
  assert.equal(edited.finishedAt, '2023-03-03T12:00:00.000Z');
});

test('Löschen aus dem Archiv führt zurück ins Archiv', async () => {
  await printAll('Vase');
  const job = env.byStatus('done')[0];
  const res = await admin.post(`/admin/auftrag/${job.id}/delete`, { back: '/admin/archiv?person=Oma' });
  assert.equal(res.location, '/admin/archiv?person=Oma');
  assert.equal(env.data().jobs.length, 0);
});

test('Rücksprung-Links nach außen werden ignoriert', async () => {
  await printAll('Vase');
  const job = env.byStatus('done')[0];
  for (const back of ['https://evil.example/', '//evil.example/admin', '/admin/archiv#x', '/adminx']) {
    const res = await admin.post(`/admin/auftrag/${job.id}/nochmal`, { back });
    assert.equal(res.location, `/admin/archiv#auftrag-${job.id}`, back);
  }
});

test('CSV-Export mit Filter und ohne Excel-Formeln', async () => {
  await printAll({ title: '=HYPERLINK("x")', requester: 'Mama' }, { title: 'Vase; "rund"', requester: 'Papa' });
  const all = await admin.get('/admin/archiv.csv');
  assert.equal(all.status, 200);
  const lines = all.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], '"Gedruckt am";"Titel";"Für";"Anzahl";"Farbe/Material";"Link";"Wünsche";"Notiz"');
  assert.equal(lines.length, 3);
  assert.ok(lines.some((line) => line.includes('"\'=HYPERLINK(""x"")"')));
  assert.ok(lines.some((line) => line.includes('"Vase; ""rund"""')));

  const filtered = await admin.get('/admin/archiv.csv?person=Papa');
  assert.equal(filtered.text.trim().split('\r\n').length, 2);
});
