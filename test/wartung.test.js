'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const maintenance = require('../src/maintenance');
const { startApp } = require('./helpers');

let env;
beforeEach(async () => {
  env = await startApp();
});
afterEach(() => env.close());

const MAINT = /<h1>Wartungsarbeiten<\/h1>/;

async function switchOn(admin, extra = {}) {
  const res = await admin.post('/admin/wartung', { an: 'ja', nachricht: '', zugang: 'alle', ...extra });
  assert.equal(res.status, 303);
}

test('Wartung an: Besucher sehen nur die Wartungsseite, angemeldete Konten alles', async () => {
  const admin = await (await env.admin()).accept();
  const visitor = await env.client().accept();
  await switchOn(admin, { nachricht: 'Neuer Drucker kommt!\nBis Sonntag.' });

  for (const url of ['/', '/warteschlange', '/agb', '/datenschutz', '/admin', '/admin/archiv', '/gibtsnicht']) {
    const res = await visitor.get(url);
    assert.equal(res.status, 503, url);
    assert.match(res.text, MAINT, url);
    assert.match(res.text, /Neuer Drucker kommt!\nBis Sonntag\./);
    assert.doesNotMatch(res.text, /class="tabbar"|class="topnav"|Kräuter/, `${url}: kein Menü, keine Inhalte`);
  }
  // Auch Abschicken geht nicht.
  const blocked = await visitor.post('/auftrag', { requester: 'Oma', title: 'Vase', quantity: '1' });
  assert.equal(blocked.status, 503);
  assert.equal((await env.data()).jobs.length, 0);

  // Wer angemeldet ist, kommt überall hin – mit Hinweis oben.
  for (const url of ['/', '/warteschlange', '/admin', '/admin/archiv']) {
    const res = await admin.get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.text, /Wartungsmodus ist an\./, url);
  }
  assert.match((await admin.get('/admin')).text, /<span>Wartung an<\/span>/);

  // Dateien für App und Aussehen gehen weiter.
  for (const url of ['/style.css', '/sw.js', '/offline.html', '/manifest.webmanifest']) {
    assert.equal((await visitor.get(url)).status, 200, url);
  }
});

test('Versteckter Login auf der Wartungsseite', async () => {
  const admin = await (await env.admin()).accept();
  await switchOn(admin);
  const visitor = env.client();
  const page = (await visitor.get('/')).text;
  assert.match(page, /<details class="hidden-login appbar-action">/);
  assert.match(page, /<form method="post" action="\/admin\/login" class="hidden-login-panel form">/);
  assert.equal((await visitor.get('/admin/login')).status, 200, 'Login-Seite bleibt erreichbar');

  const res = await visitor.post('/admin/login', { username: 'admin', password: 'geheim123' });
  assert.equal(res.status, 303);
  assert.equal((await visitor.get('/warteschlange')).status, 200);
  await visitor.post('/admin/logout');
  visitor.token = null;
  assert.equal((await visitor.get('/warteschlange')).status, 503, 'nach dem Abmelden wieder draußen');
});

test('„Nur ich“: andere Konten sehen auch die Wartungsseite', async () => {
  const admin = await (await env.admin()).accept();
  await env.createUser('papa', 'papa-passwort', 'Papa');
  const papa = await env.client().login('papa', 'papa-passwort');
  assert.equal((await papa.get('/admin')).status, 200);

  await switchOn(admin, { zugang: 'ich' });
  const blocked = await papa.get('/admin');
  assert.equal(blocked.status, 503);
  assert.match(blocked.text, /während dieser Wartung hat aber nur Admin Zugang/);
  assert.doesNotMatch(blocked.text, /hidden-login/, 'Angemeldete sehen stattdessen „Abmelden“');
  assert.equal((await papa.post('/admin/wartung', { an: '' })).status, 503, 'kann nicht ausschalten');
  assert.equal((await maintenance.load(env.store)).on, true);
  assert.equal((await admin.get('/admin')).status, 200);
  assert.match((await admin.get('/admin')).text, /Nur Admin kommt rein/);
});

test('Ausschalten – über den Schalter oder den Knopf im Hinweis', async () => {
  const admin = await (await env.admin()).accept();
  const visitor = await env.client().accept();
  await switchOn(admin);
  assert.equal((await visitor.get('/')).status, 503);

  const off = await admin.post('/admin/wartung/aus', { back: '/admin/archiv' });
  assert.equal(off.location, '/admin/archiv');
  assert.equal((await visitor.get('/')).status, 200);
  assert.match((await admin.get('/admin')).text, /Wartungsmodus ist aus/);

  await switchOn(admin);
  await admin.post('/admin/wartung', { nachricht: 'egal', zugang: 'alle' }); // Schalter aus (Häkchen fehlt)
  assert.equal((await visitor.get('/')).status, 200);

  const log = (await env.store.listLog()).filter((e) => e.action.startsWith('wartung_')).map((e) => e.action);
  assert.deepEqual(log, ['wartung_aus', 'wartung_an', 'wartung_aus', 'wartung_an']);
  assert.match((await admin.get('/admin/verlauf')).text, /Wartungsmodus eingeschaltet/);
});

test('Nur Angemeldete können den Wartungsmodus schalten', async () => {
  const visitor = await env.client().accept();
  assert.equal((await visitor.post('/admin/wartung', { an: 'ja' })).location, '/admin/login');
  assert.equal((await maintenance.load(env.store)).on, false);
  assert.equal((await visitor.get('/')).status, 200);
});

test('Der Text der Wartungsseite wird sicher angezeigt; leer = Standardtext', async () => {
  const admin = await (await env.admin()).accept();
  await switchOn(admin, { nachricht: '<script>alert(1)</script>' });
  const page = (await env.client().get('/')).text;
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  await admin.post('/admin/wartung', { an: 'ja', nachricht: '' });
  assert.match((await env.client().get('/')).text, /wird gerade überarbeitet/);
  assert.doesNotMatch((await env.client().get('/')).text, /Emoji|\p{Extended_Pictographic}/u);
});

// --- Freigeschaltete Internet-Adressen -------------------------------------------------------

test('Freigeschaltete Adressen kommen ohne Anmeldung rein – IPv4 genau, IPv6 als Heimnetz', async () => {
  const admin = await (await env.admin()).accept();
  await switchOn(admin, { adressen: '203.0.113.7\n2001:db8:1:2::/64' });

  const me = await env.client({ 'x-forwarded-for': '203.0.113.7' }).accept();
  const page = await me.get('/warteschlange');
  assert.equal(page.status, 200);
  assert.match(page.text, /weil deine Internet-Adresse freigeschaltet ist/);
  assert.doesNotMatch(page.text, /Ausschalten/, 'ohne Anmeldung kein Ausschalten-Knopf');
  assert.equal((await me.submit({ title: 'Test während der Wartung' })).status, 303);
  assert.equal((await me.get('/admin')).location, '/admin/login', 'Admin-Bereich braucht trotzdem die Anmeldung');

  assert.equal((await env.client({ 'x-forwarded-for': '2001:db8:1:2:abcd::99' }).get('/')).status, 200);
  for (const other of ['203.0.113.8', '2001:db8:1:3::1', '198.51.100.1, 203.0.113.9']) {
    assert.equal((await env.client({ 'x-forwarded-for': other }).get('/')).status, 503, other);
  }
  // Vorne eingetragene (gefälschte) Adresse hilft nicht – es zählt die, die der Server anhängt.
  assert.equal((await env.client({ 'x-forwarded-for': '203.0.113.7, 198.51.100.1' }).get('/')).status, 503);
});

test('„Meine Adresse hinzufügen“ und Schutz vor zu offenen Einträgen', async () => {
  const admin = await (await env.admin()).accept();
  const phone = await env.client({ 'x-forwarded-for': '2001:db8:aa:bb:1234:5678:9abc:def0' }).login();
  const card = (await phone.get('/admin')).text;
  assert.match(card, /Deine Adresse gerade: <code>2001:db8:aa:bb::\/64<\/code>/);

  await phone.post('/admin/wartung', { an: 'ja', adressen: '203.0.113.7', meine_adresse: 'ja' });
  assert.deepEqual((await maintenance.load(env.store)).addresses, ['203.0.113.7', '2001:db8:aa:bb::/64']);

  // Adressen des Servers selbst oder riesige Bereiche würden alle reinlassen – abgelehnt.
  const res = await admin.post('/admin/wartung', {
    an: 'ja', adressen: '127.0.0.1\n10.0.0.0/8\n0.0.0.0/0\nquatsch\n198.51.100.0/24',
  });
  assert.equal(res.status, 303);
  assert.deepEqual((await maintenance.load(env.store)).addresses, ['198.51.100.0/24']);
  assert.match((await admin.get('/admin')).text, /Nicht übernommen: 127\.0\.0\.1, 10\.0\.0\.0\/8, 0\.0\.0\.0\/0, quatsch/);

  // Kommt die eigene Adresse beim Server nicht an (hier: nur 127.0.0.1), geht „hinzufügen“ nicht.
  assert.match((await admin.get('/admin')).text, /Deine Internet-Adresse kommt beim Server nicht an/);
  await admin.post('/admin/wartung', { an: 'ja', adressen: '', meine_adresse: 'ja' });
  assert.deepEqual((await maintenance.load(env.store)).addresses, []);
  assert.match((await admin.get('/admin')).text, /Freischalten per Adresse geht deshalb leider nicht/);
  assert.equal((await env.client().get('/')).status, 503, 'niemand kommt über 127.0.0.1 rein');
});
