'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const discord = require('../src/discord');
const makerworld = require('../src/makerworld');
const { html } = require('../src/html');

test('Discord-Nachricht: Format, keine Pings, Markdown maskiert', () => {
  const job = {
    id: 1, title: 'Vase', requester: '@everyone', makerworldUrl: null, imageUrl: null,
    quantity: 1, color: null, notes: '**fett**', adminNote: null,
  };
  const payload = discord.buildPayload([job], 'https://druck.example');
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  const [embed] = payload.embeds;
  assert.equal(embed.title, '1. Vase');
  assert.match(embed.description, /Kein MakerWorld-Link/);
  assert.ok(embed.description.includes('\\*\\*fett\\*\\*'));
  assert.match(payload.content, /https:\/\/druck\.example\/admin/);
  assert.match(discord.buildPayload([], '').content, /leer/);
});

test('Discord-Nachricht mit MakerWorld-Link und Vorschaubild', () => {
  const job = {
    id: 2, title: 'Drache', requester: 'Leo', makerworldUrl: 'https://makerworld.com/de/models/1',
    imageUrl: 'https://img.example/x.jpg', quantity: 3, color: 'Grün', notes: null, adminNote: 'PLA',
  };
  const [embed] = discord.buildPayload([job]).embeds;
  assert.equal(embed.url, 'https://makerworld.com/de/models/1');
  assert.deepEqual(embed.thumbnail, { url: 'https://img.example/x.jpg' });
  assert.match(embed.description, /3×/);
  assert.match(embed.description, /Auf MakerWorld öffnen/);
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
