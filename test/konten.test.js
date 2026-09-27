'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { startApp } = require('./helpers');

let env;
beforeEach(async () => {
  env = await startApp();
});
afterEach(() => env.close());

const account = (extra = {}) => ({
  username: 'tim', display_name: 'Tim', password: 'sehr-geheim', password_repeat: 'sehr-geheim', ...extra,
});

// --- Ersteinrichtung ------------------------------------------------------------

test('Ohne Konto führt der Login zur Ersteinrichtung', async () => {
  const client = env.client();
  assert.equal((await client.get('/admin')).location, '/admin/login');
  assert.equal((await client.get('/admin/login')).location, '/admin/einrichten');
  assert.match((await client.get('/admin/einrichten')).text, /Einrichtungs-Code/);
});

test('Ersteinrichtung nur mit dem richtigen Code, und nur einmal', async () => {
  const client = env.client();
  const wrong = await client.post('/admin/einrichten', account({ setup_code: 'falsch' }));
  assert.equal(wrong.status, 400);
  assert.match(wrong.text, /Einrichtungs-Code stimmt nicht/);
  assert.equal(await env.store.countUsers(), 0);

  const right = await client.post('/admin/einrichten', account({ setup_code: 'einrichtungs-code' }));
  assert.equal(right.status, 303);
  const dashboard = await client.get('/admin');
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Willkommen, Tim!/);

  // Ein zweites Mal geht nicht – auch nicht mit dem Code.
  const again = await env.client().post('/admin/einrichten', account({ username: 'boese', setup_code: 'einrichtungs-code' }));
  assert.equal(again.location, '/admin/login');
  assert.equal(await env.store.countUsers(), 1);
});

test('Ohne ADMIN_PASSWORD gibt es keine Ersteinrichtung', async () => {
  env.config.adminPassword = '';
  const client = env.client();
  assert.match((await client.get('/admin/einrichten')).text, /Trag in Plesk bei den\s+Umgebungsvariablen/);
  const res = await client.post('/admin/einrichten', account({ setup_code: '' }));
  assert.equal(res.status, 400);
  assert.equal(await env.store.countUsers(), 0);
});

test('Passwort wird nur als Hash gespeichert', async () => {
  await env.client().post('/admin/einrichten', account({ setup_code: 'einrichtungs-code' }));
  const user = await env.store.findUser('tim');
  assert.match(user.passwordHash, /^scrypt\$/);
  assert.doesNotMatch(user.passwordHash, /sehr-geheim/);
});

test('Formularfehler bei der Einrichtung', async () => {
  const res = await env.client().post('/admin/einrichten', account({
    setup_code: 'einrichtungs-code', username: 'x', password: 'kurz', password_repeat: 'anders',
  }));
  assert.equal(res.status, 400);
  assert.match(res.text, /Benutzername braucht 3–40 Zeichen/);
  assert.match(res.text, /mindestens 8 Zeichen/);
  assert.match(res.text, /stimmen nicht überein/);
});

// --- Anmelden -----------------------------------------------------------------------

test('Nach 5 Fehlversuchen ist das Konto kurz gesperrt', async () => {
  await env.createUser('admin', 'geheim123', 'Admin');
  const client = env.client();
  for (let i = 0; i < 5; i++) {
    assert.equal((await client.post('/admin/login', { username: 'admin', password: 'falsch' })).status, 401);
  }
  const locked = await client.post('/admin/login', { username: 'admin', password: 'geheim123' });
  assert.equal(locked.status, 429);
  assert.match(locked.text, /kurz gesperrt/);

  await env.store.updateUser((await env.store.findUser('admin')).id, { lockedUntil: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await client.post('/admin/login', { username: 'admin', password: 'geheim123' })).status, 303);
});

// --- Konten verwalten -----------------------------------------------------------------

test('Konto anlegen, damit anmelden, löschen – dann ist die Sitzung weg', async () => {
  const admin = await env.admin();
  const created = await admin.post('/admin/nutzer/neu', account({ username: 'Helfer', display_name: 'Papa' }));
  assert.equal(created.status, 303);
  assert.match((await admin.get('/admin/nutzer')).text, /Konto für Papa angelegt/);

  const papa = await env.client().login('helfer', 'sehr-geheim');
  assert.equal((await papa.get('/admin')).status, 200);

  const duplicate = await admin.post('/admin/nutzer/neu', account({ username: 'helfer' }));
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.text, /gibt es schon/);

  const id = (await env.store.findUser('helfer')).id;
  await admin.post(`/admin/nutzer/${id}/loeschen`);
  assert.equal((await papa.get('/admin')).location, '/admin/login');
});

test('Das eigene Konto kann man nicht löschen', async () => {
  const admin = await env.admin();
  const me = await env.store.findUser('admin');
  await admin.post(`/admin/nutzer/${me.id}/loeschen`);
  assert.equal(await env.store.countUsers(), 1);
  assert.match((await admin.get('/admin/nutzer')).text, /eigenes Konto kannst du nicht löschen/);
});

test('Eigenes Passwort ändern meldet andere Geräte ab', async () => {
  const laptop = await env.admin();
  const phone = await env.client().login();
  const me = await env.store.findUser('admin');

  const wrongCurrent = await laptop.post(`/admin/nutzer/${me.id}/passwort`, {
    current_password: 'falsch', password: 'ganz-neu-123', password_repeat: 'ganz-neu-123',
  });
  assert.equal(wrongCurrent.status, 400);
  assert.match(wrongCurrent.text, /bisheriges Passwort stimmt nicht/);

  const ok = await laptop.post(`/admin/nutzer/${me.id}/passwort`, {
    current_password: 'geheim123', password: 'ganz-neu-123', password_repeat: 'ganz-neu-123',
  });
  assert.equal(ok.status, 303);
  assert.equal((await laptop.get('/admin')).status, 200); // wer geändert hat, bleibt angemeldet
  assert.equal((await phone.get('/admin')).location, '/admin/login'); // das andere Gerät nicht
  await assert.rejects(env.client().login('admin', 'geheim123'));
  await env.client().login('admin', 'ganz-neu-123');
});

test('Passwort für jemand anderen neu setzen (ohne dessen altes Passwort)', async () => {
  const admin = await env.admin();
  const other = await env.createUser('oma', 'altes-passwort', 'Oma');
  const res = await admin.post(`/admin/nutzer/${other.id}/passwort`, { password: 'neues-passwort', password_repeat: 'neues-passwort' });
  assert.equal(res.status, 303);
  await env.client().login('oma', 'neues-passwort');
});

// --- Verlauf ----------------------------------------------------------------------------

test('Der Verlauf zeigt, wer was gemacht hat', async () => {
  const admin = await env.admin();
  await env.client().submit({ title: '<b>Vase</b>', requester: 'Lena' });
  const id = await env.idOf('<b>Vase</b>');
  await admin.post(`/admin/auftrag/${id}/approve`);
  await admin.post(`/admin/auftrag/${id}/done`);

  const entries = await env.store.listLog();
  assert.deepEqual(entries.map((e) => [e.action, e.userName]), [
    ['gedruckt', 'Admin'],
    ['freigegeben', 'Admin'],
    ['anfrage', 'Lena (öffentlich)'],
    ['login', 'Admin'],
  ]);
  assert.ok(entries.slice(0, 3).every((e) => e.jobId === id && e.jobTitle === '<b>Vase</b>'));

  const page = (await admin.get('/admin/verlauf')).text;
  assert.match(page, /Freigegeben <strong>&lt;b&gt;Vase&lt;\/b&gt;<\/strong>/);
  assert.match(page, /Lena \(öffentlich\)/);
  assert.equal((await env.client().get('/admin/verlauf')).location, '/admin/login');
});

test('Fehlgeschlagene Anmeldungen landen im Verlauf', async () => {
  await env.createUser('admin', 'geheim123', 'Admin');
  await env.client().post('/admin/login', { username: 'admin', password: 'falsch' });
  const [entry] = await env.store.listLog();
  assert.equal(entry.action, 'login_fehlgeschlagen');
  assert.equal(entry.userName, 'Admin');
});

// --- Spam-Schutz auf der offenen Seite ---------------------------------------------------

test('Zu schnelles Abschicken muss wiederholt werden, die Eingaben bleiben', async () => {
  env.config.minFormSeconds = 0.3;
  const client = env.client();
  const page = (await client.get('/')).text;
  const stamp = /name="ts" value="([^"]+)"/.exec(page)[1];

  const tooFast = await client.submit({ title: 'Schnell', ts: stamp });
  assert.equal(tooFast.status, 400);
  assert.match(tooFast.text, /Das ging etwas schnell/);
  assert.match(tooFast.text, /value="Schnell"/);

  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal((await client.submit({ title: 'Schnell', ts: stamp })).status, 303);
  assert.equal((await client.submit({ title: 'Ohne Stempel' })).status, 400);
  assert.equal((await client.submit({ title: 'Gefälscht', ts: `${Date.now() - 60_000}.abc` })).status, 400);
  assert.deepEqual((await env.data()).jobs.map((j) => j.title), ['Schnell']);
});

test('Bei zu vielen offenen Anfragen ist erstmal Schluss', async () => {
  env.config.maxPending = 2;
  const client = env.client();
  await client.submit({ title: 'A' });
  await client.submit({ title: 'B' });
  const third = await client.submit({ title: 'C' });
  assert.equal(third.status, 400);
  assert.match(third.text, /sehr viele Anfragen/);
});
