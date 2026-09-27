'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { clientAddress, isInternal } = require('../src/ratelimit');
const { loadConfig } = require('../src/config');
const { startApp } = require('./helpers');

let env;
beforeEach(async () => {
  env = await startApp({ maxRequestsPerMinute: 5 });
});
afterEach(() => env.close());

const from = (address) => env.client({ 'x-forwarded-for': address });

test('Höchstens 5 Anfragen pro Minute und Besucher', async () => {
  const lena = from('203.0.113.7');
  for (let i = 1; i <= 5; i++) assert.equal((await lena.submit({ title: `Teil ${i}` })).status, 303, `Anfrage ${i}`);

  const sixth = await lena.submit({ title: 'Teil 6' });
  assert.equal(sixth.status, 429);
  assert.match(sixth.text, /Du hast in der letzten Minute schon 5 Anfragen geschickt/);
  assert.match(sixth.text, /Bitte warte noch \d+ Sekunden? und schick sie dann nochmal ab/);
  assert.match(sixth.text, /value="Teil 6"/, 'Eingaben bleiben erhalten');

  // Neue Sitzung oder vorne eine erfundene Adresse helfen nicht – nginx hängt die echte hinten an.
  assert.equal((await from('203.0.113.7').submit({ title: 'Trick 1' })).status, 429);
  assert.equal((await from('198.51.100.1, 203.0.113.7').submit({ title: 'Trick 2' })).status, 429);

  // Andere Besucher sind nicht betroffen.
  assert.equal((await from('198.51.100.23').submit({ title: 'Oma' })).status, 303);
  assert.deepEqual((await env.data()).jobs.map((job) => job.title), ['Teil 1', 'Teil 2', 'Teil 3', 'Teil 4', 'Teil 5', 'Oma']);
});

test('Fehlerhafte Formulare zählen nicht mit', async () => {
  const client = from('203.0.113.8');
  for (let i = 0; i < 6; i++) assert.equal((await client.submit({ title: '' })).status, 400);
  assert.equal((await client.submit({ title: 'Jetzt richtig' })).status, 303);
});

test('Nach Ablauf der Minute geht es weiter – gespeichert wird keine IP-Adresse', async () => {
  env.config.maxRequestsPerMinute = 2;
  env.config.rateWindowMs = 300;
  const client = from('203.0.113.9');
  await client.submit({ title: 'A' });
  await client.submit({ title: 'B' });
  assert.equal((await client.submit({ title: 'C' })).status, 429);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal((await client.submit({ title: 'C' })).status, 303);

  const stored = JSON.stringify(await env.store.readState('anfragen_limit'));
  assert.doesNotMatch(stored, /203\.0\.113\.9/);
});

test('Besucher-Adresse: die echte von rechts, Server-Adressen übersprungen', () => {
  const req = (forwarded, remote) => ({ headers: forwarded ? { 'x-forwarded-for': forwarded } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientAddress(req('', '127.0.0.1')), '127.0.0.1');
  assert.equal(clientAddress(req('203.0.113.5', '127.0.0.1')), '203.0.113.5');
  assert.equal(clientAddress(req('1.1.1.1, 203.0.113.5, 10.0.0.2', '::ffff:127.0.0.1')), '203.0.113.5');
  assert.equal(clientAddress(req('1.1.1.1', '203.0.113.6')), '203.0.113.6', 'direkt verbunden: Kopfzeile egal');
  assert.equal(clientAddress(req('2001:db8::1', '::1')), '2001:db8::1');
  for (const internal of ['127.0.0.1', '::1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '::ffff:127.0.0.1', 'fd00::1']) {
    assert.ok(isInternal(internal), internal);
  }
  assert.ok(!isInternal('203.0.113.5'));
  assert.ok(!isInternal('172.32.0.1'));
});

test('Grenze lässt sich einstellen, Standard sind 5', () => {
  const saved = process.env.MAX_ANFRAGEN_PRO_MINUTE;
  try {
    delete process.env.MAX_ANFRAGEN_PRO_MINUTE;
    assert.equal(loadConfig({ dataDir: env.dataDir }).maxRequestsPerMinute, 5);
    process.env.MAX_ANFRAGEN_PRO_MINUTE = '10';
    assert.equal(loadConfig({ dataDir: env.dataDir }).maxRequestsPerMinute, 10);
  } finally {
    if (saved === undefined) delete process.env.MAX_ANFRAGEN_PRO_MINUTE;
    else process.env.MAX_ANFRAGEN_PRO_MINUTE = saved;
  }
});
