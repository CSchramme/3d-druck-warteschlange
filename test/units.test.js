'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const discord = require('../src/discord');
const makerworld = require('../src/makerworld');
const { html } = require('../src/html');

const sampleJob = (overrides = {}) => ({
  id: 1, title: 'Vase', requester: 'Oma', makerworldUrl: null, imageUrl: null, quantity: 1,
  color: null, notes: null, adminNote: null, createdAt: '2026-09-26T18:00:00.000Z', ...overrides,
});

const embedChars = (embeds) => embeds.reduce((sum, e) => sum + (e.title || '').length
  + (e.description || '').length + (e.author ? e.author.name.length : 0) + (e.footer ? e.footer.text.length : 0)
  + (e.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0), 0);

test('Discord-Nachricht: Embeds mit Feldern, keine Pings, Markdown maskiert', () => {
  const job = sampleJob({ requester: '@everyone', notes: '**fett**' });
  const payload = discord.buildPayload([job], 'https://druck.example');
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  const [embed] = payload.embeds;
  assert.equal(embed.title, 'Vase');
  assert.equal(embed.author.name, '🥇 Platz 1 · als Nächstes drucken');
  assert.equal(embed.timestamp, job.createdAt);
  assert.deepEqual(embed.fields.map((f) => f.name), [
    '👤 Für', '🔢 Anzahl', '🎨 Farbe / Material', '📝 Wünsche', '⚠️ Kein MakerWorld-Link',
  ]);
  assert.equal(embed.fields[3].value, '\\*\\*fett\\*\\*');
  assert.ok(embed.fields.every((f) => !('shrink' in f)));
  assert.match(payload.content, /\(<https:\/\/druck\.example\/admin>\)/);
  const empty = discord.buildPayload([], '');
  assert.match(empty.content, /leer/);
  assert.equal(empty.embeds.length, 1);
});

test('Discord-Nachricht mit MakerWorld-Link und Vorschaubild', () => {
  const job = sampleJob({
    title: 'Drache', makerworldUrl: 'https://makerworld.com/de/models/1',
    imageUrl: 'https://img.example/x.jpg', quantity: 3, color: 'Grün', adminNote: 'PLA',
  });
  const [embed] = discord.buildPayload([job]).embeds;
  assert.equal(embed.url, 'https://makerworld.com/de/models/1');
  assert.deepEqual(embed.thumbnail, { url: 'https://img.example/x.jpg' });
  assert.equal(embed.fields[1].value, '3×');
  assert.ok(embed.fields.some((f) => f.value === '[Auf MakerWorld öffnen](https://makerworld.com/de/models/1)'));
  assert.ok(embed.fields.some((f) => f.name === '🛠️ Deine Notiz' && f.value === 'PLA'));
});

test('Discord-Nachricht bleibt auch bei viel Text unter dem Limit', () => {
  const long = (c) => c.repeat(1000);
  const top = Array.from({ length: 9 }, (_, i) => sampleJob({
    id: i + 1, title: long('T').slice(0, 120), requester: long('R').slice(0, 60), color: long('C').slice(0, 60),
    notes: long('N'), adminNote: long('A'), makerworldUrl: `https://makerworld.com/de/models/${i}`,
  }));
  const payload = discord.buildPayload(top);
  assert.equal(payload.embeds.length, 9);
  assert.ok(embedChars(payload.embeds) <= 6000, `zu lang: ${embedChars(payload.embeds)}`);
  assert.ok(payload.content.length <= 2000);
});

test('Anfrage-Nachricht ohne Ping und ohne Link', () => {
  const payload = discord.buildRequestPayload(sampleJob({ requester: '<@&999> Hacker' }), { pendingCount: 3 });
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.doesNotMatch(payload.content, /^<@\d/);
  const [embed] = payload.embeds;
  assert.match(embed.description, /\/admin/);
  assert.equal(embed.footer.text, 'Anfrage #1 · 3 warten auf Freigabe');
  const invalidPing = discord.buildRequestPayload(sampleJob(), { pingUserId: '@everyone' });
  assert.deepEqual(invalidPing.allowed_mentions, { parse: [] });
});

test('MakerWorld-Seite auslesen', () => {
  const page = `<html><head><title>ignoriert</title>
    <meta property="og:title" content="Articulated Dragon &amp; Egg - Free 3D Print Model - MakerWorld">
    <meta property="og:image" content="https://makerworld.bblmw.com/makerworld/model/x.jpg">
  </head></html>`;
  assert.deepEqual(makerworld.parsePage(page), {
    title: 'Articulated Dragon & Egg',
    imageUrl: 'https://makerworld.bblmw.com/makerworld/model/x.jpg',
  });
});

test('MakerWorld-Hilfsfunktionen', async () => {
  assert.ok(makerworld.isMakerworld('https://makerworld.com/de/models/1'));
  assert.ok(makerworld.isMakerworld('https://www.makerworld.com/models/1'));
  assert.ok(!makerworld.isMakerworld('https://makerworld.com.evil.example/models/1'));
  assert.equal(makerworld.modelId('https://makerworld.com/de/models/987-foo#profileId-1'), '987');
  assert.equal(makerworld.normalizeUrl('makerworld.com/models/2'), 'https://makerworld.com/models/2');
  assert.equal(makerworld.normalizeUrl('  '), null);
  assert.throws(() => makerworld.normalizeUrl('https://a.de:99999/'));
  assert.deepEqual(await makerworld.fetchInfo('https://example.com/'), { title: null, imageUrl: null });
});

test('html`` maskiert eingesetzte Werte', () => {
  const name = '<img src=x onerror=alert(1)>';
  assert.equal(String(html`<p>${name}</p>`), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(String(html`<ul>${['a', 'b'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}`), '');
});

test('.env: Plesk-Variablen haben Vorrang – leer gelassene aber nicht', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { loadEnvFile } = require('../src/config');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'druck-env-')), '.env');
  fs.writeFileSync(file, 'TEST_AUS_PLESK=datei\nTEST_LEER_IN_PLESK=datei\nTEST_NUR_DATEI=datei\n');
  process.env.TEST_AUS_PLESK = 'plesk';
  process.env.TEST_LEER_IN_PLESK = ' ';
  try {
    loadEnvFile(file);
    assert.equal(process.env.TEST_AUS_PLESK, 'plesk');
    assert.equal(process.env.TEST_LEER_IN_PLESK, 'datei');
    assert.equal(process.env.TEST_NUR_DATEI, 'datei');
  } finally {
    for (const name of ['TEST_AUS_PLESK', 'TEST_LEER_IN_PLESK', 'TEST_NUR_DATEI']) delete process.env[name];
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});
