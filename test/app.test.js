'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { startApp } = require('./helpers');

let env;
beforeEach(async () => {
  env = await startApp();
});
afterEach(() => env.close());

const topTitles = (payload) => payload.embeds.map((embed) => embed.title);

async function approveAll(admin, ...titles) {
  for (const title of titles) {
    await admin.submit({ title });
    await admin.post(`/admin/auftrag/${env.idOf(title)}/approve`);
  }
}

// --- Einreichen -----------------------------------------------------------------

test('Einreichen legt einen wartenden Auftrag an', async () => {
  const client = env.client();
  const res = await client.submit({ title: 'Handyhalter', color: 'Rot', notes: 'fürs Auto' });
  assert.equal(res.status, 303);
  const [job] = env.byStatus('pending');
  assert.equal(job.title, 'Handyhalter');
  assert.equal(job.requester, 'Oma');
  assert.equal(job.makerworldUrl, null);
  const page = (await client.get('/')).text;
  assert.match(page, /Handyhalter/);
  assert.match(page, /Wartet auf Genehmigung/);
  assert.match(page, /ist eingegangen/);
  assert.deepEqual(env.sent, []); // Anfragen allein lösen nichts in Discord aus
});

test('Nur MakerWorld-Link reicht, Titel wird ergänzt', async () => {
  await env.client().submit({ makerworld_url: 'makerworld.com/de/models/123456-benchy' });
  const [job] = env.byStatus('pending');
  assert.equal(job.title, 'MakerWorld-Modell 123456');
  assert.equal(job.makerworldUrl, 'https://makerworld.com/de/models/123456-benchy');
});

test('Ohne Titel und ohne Link gibt es eine Fehlermeldung', async () => {
  const res = await env.client().submit();
  assert.equal(res.status, 400);
  assert.match(res.text, /was gedruckt werden soll/);
  assert.equal(env.data().jobs.length, 0);
});

test('Kaputte oder gefährliche Links werden abgelehnt', async () => {
  const client = env.client();
  for (const url of ['javascript:alert(1)', 'ftp://x.de/a', 'http://localhost']) {
    const res = await client.submit({ title: 'x', makerworld_url: url });
    assert.equal(res.status, 400, url);
  }
  assert.equal(env.data().jobs.length, 0);
});

test('Eingaben werden in der Seite maskiert', async () => {
  const client = env.client();
  await client.submit({ title: '<script>alert(1)</script>', requester: '<b>Hacker</b>' });
  const page = (await client.get('/')).text;
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('Honeypot-Feld verwirft Bot-Einsendungen', async () => {
  await env.client().submit({ title: 'Spam', website: 'http://spam.example' });
  assert.equal(env.data().jobs.length, 0);
});

test('POST ohne CSRF-Token wird abgelehnt', async () => {
  const res = await env.client().request('POST', '/auftrag', { requester: 'Oma', title: 'x' });
  assert.equal(res.status, 400);
  assert.equal(env.data().jobs.length, 0);
});

test('Zu viel Text ergibt eine verständliche Fehlerseite', async () => {
  const res = await env.client().submit({ title: 'x', notes: 'a'.repeat(100_000) });
  assert.equal(res.status, 413);
  assert.match(res.text, /zu viel Text/);
});

test('Viele gleichzeitige Einsendungen gehen nicht verloren', async () => {
  const client = env.client();
  await client.csrf();
  await Promise.all(Array.from({ length: 25 }, (_, i) => client.submit({ title: `Teil ${i}` })));
  const ids = env.data().jobs.map((job) => job.id);
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, 25);
});

// --- Zugang -----------------------------------------------------------------------

test('Admin-Bereich braucht das Passwort', async () => {
  const client = env.client();
  assert.equal((await client.get('/admin')).location, '/admin/login');
  const wrong = await client.post('/admin/login', { password: 'falsch' });
  assert.equal(wrong.status, 401);
  assert.match(wrong.text, /Falsches Passwort/);
  const right = await client.post('/admin/login', { password: 'geheim' });
  assert.equal(right.status, 303);
  assert.equal((await client.get('/admin')).status, 200);
  await client.post('/admin/logout');
  assert.equal((await client.get('/admin')).status, 303);
});

test('Manipuliertes Sitzungs-Cookie wird ignoriert', async () => {
  const client = env.client();
  await client.csrf();
  const [name, value] = client.cookie.split('=');
  const [, signature] = value.split('.');
  const forged = Buffer.from(JSON.stringify({ admin: true })).toString('base64url');
  client.cookie = `${name}=${forged}.${signature}`;
  assert.equal((await client.get('/admin')).status, 303);
});

test('Familien-Passwort schützt die Startseite', async () => {
  env.config.familyPassword = 'familie';
  const client = env.client();
  assert.equal((await client.get('/')).location, '/zugang');
  assert.equal((await client.submit({ title: 'x' })).location, '/zugang');
  assert.equal(env.data().jobs.length, 0);
  assert.equal((await client.post('/zugang', { password: 'falsch' })).status, 401);
  await client.post('/zugang', { password: 'familie' });
  assert.equal((await client.get('/')).status, 200);
});

// --- Genehmigen & Warteschlange -------------------------------------------------------

test('Discord bekommt nur dann eine Nachricht, wenn sich die Top 3 ändern', async () => {
  const admin = await env.admin();
  await approveAll(admin, 'A', 'B', 'C');
  assert.deepEqual(env.sent.map(topTitles), [['1. A'], ['1. A', '2. B'], ['1. A', '2. B', '3. C']]);

  await approveAll(admin, 'D', 'E'); // landen auf Platz 4 und 5
  assert.equal(env.sent.length, 3);

  await admin.post(`/admin/auftrag/${env.idOf('E')}/up`); // tauscht Platz 4 und 5
  assert.deepEqual(env.queueTitles(), ['A', 'B', 'C', 'E', 'D']);
  assert.equal(env.sent.length, 3);

  await admin.post(`/admin/auftrag/${env.idOf('D')}/top`);
  assert.deepEqual(env.queueTitles(), ['D', 'A', 'B', 'C', 'E']);
  assert.deepEqual(topTitles(env.sent.at(-1)), ['1. D', '2. A', '3. B']);

  await admin.post(`/admin/auftrag/${env.idOf('D')}/done`);
  assert.deepEqual(env.queueTitles(), ['A', 'B', 'C', 'E']);
  assert.deepEqual(topTitles(env.sent.at(-1)), ['1. A', '2. B', '3. C']);
  assert.equal(env.sent.length, 5);

  await admin.post(`/admin/auftrag/${env.idOf('E')}/delete`);
  assert.equal(env.sent.length, 5);
});

test('Ablehnen einer Anfrage schickt nichts an Discord', async () => {
  const admin = await env.admin();
  await admin.submit({ title: 'Nope' });
  await admin.post(`/admin/auftrag/${env.idOf('Nope')}/reject`);
  assert.equal(env.byStatus('rejected')[0].title, 'Nope');
  assert.deepEqual(env.sent, []);
});

test('Bearbeiten eines Top-Auftrags schickt ihn neu', async () => {
  const admin = await env.admin();
  await approveAll(admin, 'A');
  await admin.post(`/admin/auftrag/${env.idOf('A')}/bearbeiten`, {
    requester: 'Oma', title: 'A', quantity: '2', admin_note: 'PETG',
  });
  assert.equal(env.sent.length, 2);
  assert.match(env.sent[1].embeds[0].description, /2×/);
  assert.match(env.sent[1].embeds[0].description, /PETG/);
});

test('Admin kann eigene Aufträge direkt einreihen', async () => {
  const admin = await env.admin();
  await admin.post('/admin/auftrag/neu', { requester: 'Ich', title: 'Eigenes Teil' });
  assert.deepEqual(env.queueTitles(), ['Eigenes Teil']);
  assert.equal(env.sent.length, 1);
});

test('Zurückholen und Genehmigung zurücknehmen', async () => {
  const admin = await env.admin();
  await approveAll(admin, 'A', 'B');
  await admin.post(`/admin/auftrag/${env.idOf('A')}/done`);
  await admin.post(`/admin/auftrag/${env.idOf('A')}/restore`);
  assert.deepEqual(env.queueTitles(), ['B', 'A']);
  await admin.post(`/admin/auftrag/${env.idOf('B')}/unapprove`);
  assert.deepEqual(env.queueTitles(), ['A']);
  assert.deepEqual(env.byStatus('pending').map((job) => job.title), ['B']);
});

test('Unmögliche Aktionen werden verweigert', async () => {
  const admin = await env.admin();
  await admin.submit({ title: 'A' });
  await admin.post(`/admin/auftrag/${env.idOf('A')}/done`);
  assert.equal(env.byStatus('pending')[0].title, 'A');
  assert.equal((await admin.post('/admin/auftrag/999/approve')).status, 404);
  assert.equal((await admin.post(`/admin/auftrag/${env.idOf('A')}/quatsch`)).status, 404);
});

// --- Discord ----------------------------------------------------------------------------

test('Fehlgeschlagener Discord-Versand wird bei der nächsten Änderung wiederholt', async () => {
  const admin = await env.admin();
  const working = env.post;
  env.post = async () => {
    throw new Error('Discord antwortete mit 500');
  };
  await approveAll(admin, 'A');
  assert.match((await admin.get('/admin')).text, /Discord antwortete mit 500/);

  env.post = working;
  await approveAll(admin, 'B');
  assert.deepEqual(topTitles(env.sent.at(-1)), ['1. A', '2. B']);
  assert.doesNotMatch((await admin.get('/admin')).text, /Discord antwortete/);
});

test('„Jetzt senden“ schickt auch ohne Änderung', async () => {
  const admin = await env.admin();
  await approveAll(admin, 'A');
  await admin.post('/admin/discord/senden');
  assert.equal(env.sent.length, 2);
});

test('Ohne Webhook wird nichts gesendet', async () => {
  env.config.discordWebhookUrl = '';
  const admin = await env.admin();
  await approveAll(admin, 'A');
  assert.deepEqual(env.sent, []);
  assert.match((await admin.get('/admin')).text, /noch kein Discord-Webhook/);
});
