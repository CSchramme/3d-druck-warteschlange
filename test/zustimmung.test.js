'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const legal = require('../src/legal');
const { startApp } = require('./helpers');

let env;
beforeEach(async () => {
  env = await startApp();
});
afterEach(() => env.close());

const DIALOG = /<section class="consent" role="dialog" aria-modal="true"/;

test('Alle neuen Besucher sehen den Dialog – bis sie zustimmen', async () => {
  await env.createUser('admin', 'geheim123', 'Admin');
  const client = env.client();
  for (const url of ['/', '/warteschlange', '/admin/login', '/gibtsnicht']) {
    const page = (await client.get(url)).text;
    assert.match(page, DIALOG, url);
    assert.match(page, /<main class="wrap page" inert>/, `${url}: Seite dahinter gesperrt`);
    assert.match(page, /Cookies &amp; AGB akzeptieren/);
    assert.doesNotMatch(page, /id="install"/, `${url}: kein Installations-Hinweis darüber`);
  }
  const res = await client.post('/zustimmung', { back: '/warteschlange' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/warteschlange');
  for (const url of ['/', '/warteschlange', '/admin/login']) {
    const page = (await client.get(url)).text;
    assert.doesNotMatch(page, DIALOG, url);
    assert.doesNotMatch(page, / inert>/, url);
  }
});

test('Auch angemeldete Admins stimmen zu – und die Zustimmung übersteht An- und Abmelden', async () => {
  const admin = await env.admin();
  assert.match((await admin.get('/admin')).text, DIALOG);
  await admin.accept();
  assert.doesNotMatch((await admin.get('/admin')).text, DIALOG);
  await admin.post('/admin/logout');
  admin.token = null; // nach dem Abmelden gibt es ein neues Formular-Token (wie im Browser)
  assert.doesNotMatch((await admin.get('/')).text, DIALOG);
  await admin.login();
  assert.doesNotMatch((await admin.get('/admin')).text, DIALOG);
});

test('Ohne Zustimmung lässt sich kein Auftrag abschicken', async () => {
  const client = env.client();
  const res = await client.post('/auftrag', { requester: 'Oma', title: 'Vase', quantity: '1' });
  assert.equal(res.status, 400);
  assert.match(res.text, /Bitte stimm zuerst den AGB und dem Cookie-Hinweis zu/);
  assert.match(res.text, /value="Vase"/, 'Eingaben bleiben erhalten');
  assert.match(res.text, DIALOG);
  assert.equal((await env.data()).jobs.length, 0);

  await client.accept();
  assert.equal((await client.post('/auftrag', { requester: 'Oma', title: 'Vase', quantity: '1' })).status, 303);
  assert.equal((await env.data()).jobs.length, 1);
});

test('AGB- und Datenschutz-Seite: lesbar ohne Dialog, mit Zustimmung darunter', async () => {
  const client = env.client();
  const agb = (await client.get('/agb?zurueck=%2Fwarteschlange')).text;
  assert.doesNotMatch(agb, DIALOG);
  assert.doesNotMatch(agb, / inert>/);
  assert.match(agb, /<h2>1\. Worum es geht<\/h2>/);
  assert.match(agb, /class="card consent-inline"/);
  assert.match(agb, /name="back" value="\/warteschlange"/);
  assert.match(agb, /href="\/datenschutz\?zurueck=%2Fwarteschlange"/);

  const privacy = (await client.get('/datenschutz')).text;
  assert.match(privacy, /druck_session/);
  assert.match(privacy, /<ul><li>Neue Anfragen und die Warteschlange/);

  // Nur Pfade dieser Seite als Rücksprung.
  for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
    assert.equal((await env.client().post('/zustimmung', { back: evil })).location, '/', evil);
    assert.match((await env.client().get(`/agb?zurueck=${encodeURIComponent(evil)}`)).text, /name="back" value="\/"/);
  }

  await client.accept();
  const after = (await client.get('/agb')).text;
  assert.doesNotMatch(after, /consent-inline/);
  assert.match(after, /Du hast bereits zugestimmt/);
});

test('Fußzeile mit AGB und Datenschutz auf allen Seiten', async () => {
  const admin = await (await env.admin()).accept();
  for (const url of ['/', '/warteschlange', '/admin', '/admin/archiv', '/agb']) {
    const page = (await admin.get(url)).text;
    assert.match(page, /<footer class="site-foot">[\s\S]*href="\/agb"[\s\S]*href="\/datenschutz"/, url);
  }
});

test('Admin ändert die AGB: mit Haken müssen alle neu zustimmen, ohne nicht', async () => {
  const admin = await (await env.admin()).accept();
  const visitor = await env.client().accept();
  assert.doesNotMatch((await visitor.get('/')).text, DIALOG);

  // Tippfehler korrigieren – ohne neue Zustimmung.
  await admin.post('/admin/rechtliches', { agb: '## Regeln\nNur **nette** Sachen.', datenschutz: '' });
  assert.equal((await legal.load(env.store)).version, 1);
  assert.doesNotMatch((await visitor.get('/')).text, DIALOG);
  assert.match((await visitor.get('/agb')).text, /<h2>Regeln<\/h2>\n<p>Nur <strong>nette<\/strong> Sachen\.<\/p>/);

  // Inhaltliche Änderung – alle müssen neu zustimmen.
  const res = await admin.post('/admin/rechtliches', { agb: '## Neue Regeln', datenschutz: '', neu_zustimmen: 'ja' });
  assert.equal(res.status, 303);
  assert.equal((await legal.load(env.store)).version, 2);
  const again = (await visitor.get('/')).text;
  assert.match(again, DIALOG);
  assert.match(again, /Es gibt Neuigkeiten/);
  assert.doesNotMatch((await admin.get('/admin')).text, DIALOG, 'wer speichert, hat schon zugestimmt');

  // Frühere Zustimmung reicht nicht mehr zum Abschicken.
  assert.equal((await visitor.post('/auftrag', { requester: 'Oma', title: 'x', quantity: '1' })).status, 400);
  await visitor.accept();
  assert.equal((await visitor.post('/auftrag', { requester: 'Oma', title: 'x', quantity: '1' })).status, 303);

  const entry = (await env.store.listLog()).find((e) => e.action === 'rechtliches_geaendert');
  assert.match(entry.details, /Version 2 – alle müssen neu zustimmen/);
  assert.match((await admin.get('/admin/verlauf')).text, /AGB &amp; Datenschutz geändert/);
});

test('Eigene Texte werden sicher angezeigt, leeres Feld stellt die Vorlage wieder her', async () => {
  const admin = await (await env.admin()).accept();
  await admin.post('/admin/rechtliches', {
    agb: '<script>alert(1)</script>\n- <b>a</b>\n- zwei', datenschutz: 'Verantwortlich: Christoph', neu_zustimmen: 'ja',
  });
  const agb = (await admin.get('/agb')).text;
  assert.doesNotMatch(agb, /<script>alert/);
  assert.match(agb, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const privacy = (await admin.get('/datenschutz')).text;
  assert.match(privacy, /<p>Verantwortlich: Christoph<\/p>/);
  assert.doesNotMatch((await admin.get('/admin')).text, /fehlt noch, wer verantwortlich ist/);

  await admin.post('/admin/rechtliches', { agb: '', datenschutz: '   ' });
  assert.match((await admin.get('/agb')).text, /1\. Worum es geht/);
  assert.match((await admin.get('/admin')).text, /fehlt noch, wer verantwortlich ist/);
  assert.match((await admin.get('/admin/rechtliches')).text, /Trag ganz unten im Datenschutz-Hinweis/);
});

test('Nur Admins können die Texte ändern', async () => {
  const client = await env.client().accept();
  assert.equal((await client.get('/admin/rechtliches')).location, '/admin/login');
  assert.equal((await client.post('/admin/rechtliches', { agb: 'gehackt', neu_zustimmen: 'ja' })).location, '/admin/login');
  assert.equal((await legal.load(env.store)).version, 1);
  assert.doesNotMatch((await client.get('/agb')).text, /gehackt/);
});

test('Formatierung der Texte', () => {
  const out = String(legal.render('## Titel\nText **fett**\nZeile 2\n\n- a\n- b\n\n### Unter\n\nletzter <i>Absatz</i>'));
  assert.equal(out, [
    '<h2>Titel</h2>',
    '<p>Text <strong>fett</strong><br>Zeile 2</p>',
    '<ul><li>a</li><li>b</li></ul>',
    '<h3>Unter</h3>',
    '<p>letzter &lt;i&gt;Absatz&lt;/i&gt;</p>',
  ].join('\n'));
  assert.equal(legal.consentState({ version: 2 }, {}).needed, true);
  assert.equal(legal.consentState({ version: 2 }, { zustimmung: 1 }).renewed, true);
  assert.equal(legal.consentState({ version: 2 }, { zustimmung: 2 }).needed, false);
});
