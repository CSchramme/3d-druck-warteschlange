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
const text = (payload) => JSON.stringify(payload);

async function approveAll(admin, ...titles) {
  for (const title of titles) {
    await admin.submit({ title });
    await admin.post(`/admin/auftrag/${await env.idOf(title)}/approve`);
  }
}

// --- Einreichen -----------------------------------------------------------------

test('Einreichen legt eine Anfrage an, die öffentlich noch nicht auftaucht', async () => {
  const client = env.client();
  const res = await client.submit({ title: 'Kabelhalter', color: 'Rot', notes: 'fürs Auto' });
  assert.equal(res.status, 303);
  const [job] = (await env.byStatus('pending'));
  assert.equal(job.title, 'Kabelhalter');
  assert.equal(job.requester, 'Oma');
  assert.equal(job.makerworldUrl, null);

  const afterSubmit = (await client.get('/')).text;
  assert.match(afterSubmit, /Deine Anfrage „Kabelhalter“ ist angekommen/);
  const later = (await client.get('/')).text;
  assert.doesNotMatch(later, /Kabelhalter/);
  assert.match(later, /Gerade ist nichts in der Warteschlange/);
  assert.deepEqual(env.sent, []); // die Warteschlange hat sich nicht geändert
});

test('Neue Anfrage wird dir per Discord gemeldet', async () => {
  env.config.publicUrl = 'https://druck.example';
  env.config.discordPingUserId = '123456789012345678';
  await env.client().submit({
    title: 'Drache', makerworld_url: 'https://makerworld.com/de/models/42', quantity: '2', color: 'Grün',
  });
  await env.settle();
  assert.equal(env.requests.length, 1);
  const [payload] = env.requests;
  const [embed] = payload.embeds;
  assert.match(payload.content, /^<@123456789012345678> 🆕 \*\*Neue Anfrage\*\* von \*\*Oma\*\*: Drache/);
  assert.deepEqual(payload.allowed_mentions, { parse: [], users: ['123456789012345678'] });
  assert.equal(embed.title, 'Drache');
  assert.equal(embed.url, 'https://makerworld.com/de/models/42');
  assert.match(embed.author.name, /wartet auf deine Freigabe/);
  assert.match(embed.description, /\(https:\/\/druck\.example\/admin#auftrag-\d+\)/);
  assert.deepEqual(embed.fields.slice(0, 3).map((f) => f.value), ['Oma', '2×', 'Grün']);
  assert.equal(env.sent.length, 0);
});

test('Ohne eigenen Anfragen-Kanal landen Anfragen im normalen Webhook', async () => {
  env.config.discordRequestsWebhookUrl = '';
  await env.client().submit({ title: 'Vase' });
  await env.settle();
  assert.equal(env.sent.length, 1);
  assert.match(env.sent[0].content, /Neue Anfrage/);
});

test('Fehler bei der Anfrage-Meldung erscheint im Admin-Bereich', async () => {
  env.post = async () => {
    throw new Error('Discord antwortete mit 404: Unknown Webhook');
  };
  await env.client().submit({ title: 'Vase' });
  await env.settle();
  const admin = await env.admin();
  assert.match((await admin.get('/admin')).text, /Unknown Webhook/);
});

test('Nur MakerWorld-Link reicht, Titel wird ergänzt', async () => {
  await env.client().submit({ makerworld_url: 'makerworld.com/de/models/123456-benchy' });
  const [job] = (await env.byStatus('pending'));
  assert.equal(job.title, 'MakerWorld-Modell 123456');
  assert.equal(job.makerworldUrl, 'https://makerworld.com/de/models/123456-benchy');
});

test('Ohne Titel und ohne Link gibt es eine Fehlermeldung', async () => {
  const res = await env.client().submit();
  assert.equal(res.status, 400);
  assert.match(res.text, /was gedruckt werden soll/);
  assert.equal((await env.data()).jobs.length, 0);
});

test('Kaputte oder gefährliche Links werden abgelehnt', async () => {
  const client = env.client();
  for (const url of ['javascript:alert(1)', 'ftp://x.de/a', 'http://localhost']) {
    const res = await client.submit({ title: 'x', makerworld_url: url });
    assert.equal(res.status, 400, url);
  }
  assert.equal((await env.data()).jobs.length, 0);
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
  assert.equal((await env.data()).jobs.length, 0);
});

test('POST ohne CSRF-Token wird abgelehnt', async () => {
  const res = await env.client().request('POST', '/auftrag', { requester: 'Oma', title: 'x' });
  assert.equal(res.status, 400);
  assert.equal((await env.data()).jobs.length, 0);
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
  const ids = (await env.data()).jobs.map((job) => job.id);
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, 25);
});

// --- Zugang -----------------------------------------------------------------------

test('Admin-Bereich braucht eine Anmeldung', async () => {
  await env.createUser('admin', 'geheim123', 'Admin');
  const client = env.client();
  assert.equal((await client.get('/admin')).location, '/admin/login');
  const wrong = await client.post('/admin/login', { username: 'admin', password: 'falsch' });
  assert.equal(wrong.status, 401);
  assert.match(wrong.text, /Benutzername oder Passwort stimmt nicht/);
  const unknown = await client.post('/admin/login', { username: 'gibtsnicht', password: 'geheim123' });
  assert.equal(unknown.status, 401);
  const right = await client.post('/admin/login', { username: 'ADMIN ', password: 'geheim123' });
  assert.equal(right.status, 303);
  assert.equal((await client.get('/admin')).status, 200);
  await client.post('/admin/logout');
  assert.equal((await client.get('/admin')).status, 303);
});

test('Manipuliertes Sitzungs-Cookie wird ignoriert', async () => {
  const user = await env.createUser('admin', 'geheim123', 'Admin');
  const client = env.client();
  await client.csrf();
  const [name, value] = client.cookie.split('=');
  const [, signature] = value.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: user.id, v: user.sessionVersion })).toString('base64url');
  client.cookie = `${name}=${forged}.${signature}`;
  assert.equal((await client.get('/admin')).status, 303);
});

test('Die Startseite ist ohne Anmeldung offen', async () => {
  const client = env.client();
  const page = await client.get('/');
  assert.equal(page.status, 200);
  assert.match(page.text, /Druckauftrag einreichen/);
  assert.equal((await client.submit({ title: 'Vase' })).status, 303);
  assert.equal((await env.data()).jobs.length, 1);
  assert.equal((await client.get('/zugang')).status, 404);
});

// --- Freigeben & Warteschlange -------------------------------------------------------

test('Discord bekommt nur dann eine Nachricht, wenn sich die Top 3 ändern', async () => {
  const admin = await env.admin();
  await approveAll(admin, 'A', 'B', 'C');
  assert.deepEqual(env.sent.map(topTitles), [['A'], ['A', 'B'], ['A', 'B', 'C']]);
  assert.deepEqual(env.sent[2].embeds.map((e) => e.author.name),
    ['🥇 Platz 1 · als Nächstes drucken', '🥈 Platz 2', '🥉 Platz 3']);
  await env.settle();
  assert.equal(env.requests.length, 3); // jede Anfrage wurde einzeln gemeldet

  await approveAll(admin, 'D', 'E'); // landen auf Platz 4 und 5
  assert.equal(env.sent.length, 3);

  await admin.post(`/admin/auftrag/${await env.idOf('E')}/up`); // tauscht Platz 4 und 5
  assert.deepEqual((await env.queueTitles()), ['A', 'B', 'C', 'E', 'D']);
  assert.equal(env.sent.length, 3);

  await admin.post(`/admin/auftrag/${await env.idOf('D')}/top`);
  assert.deepEqual((await env.queueTitles()), ['D', 'A', 'B', 'C', 'E']);
  assert.deepEqual(topTitles(env.sent.at(-1)), ['D', 'A', 'B']);
  assert.match(env.sent.at(-1).content, /als Nächstes: \*\*D\*\*/);

  await admin.post(`/admin/auftrag/${await env.idOf('D')}/done`);
  assert.deepEqual((await env.queueTitles()), ['A', 'B', 'C', 'E']);
  assert.deepEqual(topTitles(env.sent.at(-1)), ['A', 'B', 'C']);
  assert.equal(env.sent.length, 5);

  await admin.post(`/admin/auftrag/${await env.idOf('E')}/delete`);
  assert.equal(env.sent.length, 5);
});

test('Ablehnen einer Anfrage schickt nichts an Discord', async () => {
  const admin = await env.admin();
  await admin.submit({ title: 'Nope' });
  await admin.post(`/admin/auftrag/${await env.idOf('Nope')}/reject`);
  assert.equal((await env.byStatus('rejected'))[0].title, 'Nope');
  assert.deepEqual(env.sent, []);
});

test('Bearbeiten eines Top-Auftrags schickt ihn neu', async () => {
  const admin = await env.admin();
  await approveAll(admin, 'A');
  await admin.post(`/admin/auftrag/${await env.idOf('A')}/bearbeiten`, {
    requester: 'Oma', title: 'A', quantity: '2', admin_note: 'PETG',
  });
  assert.equal(env.sent.length, 2);
  assert.match(text(env.sent[1].embeds[0]), /2×/);
  assert.match(text(env.sent[1].embeds[0]), /PETG/);
});

test('Admin kann eigene Aufträge direkt einreihen', async () => {
  const admin = await env.admin();
  await admin.post('/admin/auftrag/neu', { requester: 'Ich', title: 'Eigenes Teil' });
  assert.deepEqual((await env.queueTitles()), ['Eigenes Teil']);
  assert.equal(env.sent.length, 1);
});

test('Zurückholen und Freigabe zurücknehmen', async () => {
  const admin = await env.admin();
  await approveAll(admin, 'A', 'B');
  await admin.post(`/admin/auftrag/${await env.idOf('A')}/done`);
  await admin.post(`/admin/auftrag/${await env.idOf('A')}/restore`);
  assert.deepEqual((await env.queueTitles()), ['B', 'A']);
  await admin.post(`/admin/auftrag/${await env.idOf('B')}/unapprove`);
  assert.deepEqual((await env.queueTitles()), ['A']);
  assert.deepEqual((await env.byStatus('pending')).map((job) => job.title), ['B']);
});

test('Unmögliche Aktionen werden verweigert', async () => {
  const admin = await env.admin();
  await admin.submit({ title: 'A' });
  await admin.post(`/admin/auftrag/${await env.idOf('A')}/done`);
  assert.equal((await env.byStatus('pending'))[0].title, 'A');
  assert.equal((await admin.post('/admin/auftrag/999/approve')).status, 404);
  assert.equal((await admin.post(`/admin/auftrag/${await env.idOf('A')}/quatsch`)).status, 404);
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
  assert.deepEqual(topTitles(env.sent.at(-1)), ['A', 'B']);
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
  env.config.discordRequestsWebhookUrl = '';
  const admin = await env.admin();
  await approveAll(admin, 'A');
  await env.settle();
  assert.deepEqual(env.sent, []);
  assert.deepEqual(env.requests, []);
  assert.match((await admin.get('/admin')).text, /Discord ist noch nicht eingerichtet/);
});

// --- Design ---------------------------------------------------------------------------

test('Keine Emojis auf den Seiten – nur Icons', async () => {
  const admin = await env.admin();
  await admin.submit({ title: 'Vase', makerworld_url: 'https://makerworld.com/de/models/1', color: 'Blau', notes: 'hoch' });
  await admin.submit({ title: 'Knopf', quantity: '2' });
  const id = await env.idOf('Vase');
  await admin.post(`/admin/auftrag/${id}/approve`);
  await admin.post(`/admin/archiv/eintragen`, { requester: 'Ich', title: 'Benchy', printed_at: '2024-05-17' });
  const pages = ['/', '/warteschlange', '/admin', '/admin/archiv', '/admin/verlauf', '/admin/nutzer',
    `/admin/auftrag/${id}/bearbeiten`, '/admin/archiv.html'];
  for (const url of pages) {
    const page = await admin.get(url);
    assert.equal(page.status, 200, url);
    const found = page.text.match(/\p{Extended_Pictographic}/gu);
    assert.equal(found, null, `${url} enthält Emojis: ${found && found.join(' ')}`);
    if (url !== '/admin/archiv.html') assert.match(page.text, /<svg class="icon"/, url);
  }
  for (const url of ['/', '/warteschlange', '/admin/login', '/gibtsnicht']) {
    const found = (await env.client().get(url)).text.match(/\p{Extended_Pictographic}/gu);
    assert.equal(found, null, `${url} enthält Emojis: ${found && found.join(' ')}`);
  }
});

test('Öffentliche Warteschlangen-Seite und Navigation', async () => {
  const admin = await env.admin();
  await approveAll(admin, 'A', 'B');
  await env.client().submit({ title: 'Wartet noch' });

  const page = (await env.client().get('/warteschlange')).text;
  assert.match(page, /<h3 class="job-title">A<\/h3>/);
  assert.doesNotMatch(page, /Wartet noch/);
  assert.match(page, /class="tab is-active" href="\/warteschlange" aria-current="page"/);

  const dashboard = (await admin.get('/admin')).text;
  assert.match(dashboard, /class="tab is-active" href="\/admin"/);
  assert.match(dashboard, /<span class="nav-badge" aria-label="1 offen">1<\/span>/);
});
