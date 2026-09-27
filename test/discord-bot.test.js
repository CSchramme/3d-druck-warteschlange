'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const bot = require('../src/discord-bot');
const discord = require('../src/discord');
const {
  DiscordError, applicationIdFromToken, inviteUrl, explainError, createDiscordApi,
} = require('../src/discord-api');
const jobs = require('../src/jobs');
const { startApp } = require('./helpers');

// Ein erfundener Token mit der erfundenen Anwendungs-ID darin – kein echter Zugang.
const APP_ID = '123456789012345678';
const TOKEN = `${Buffer.from(APP_ID).toString('base64').replace(/=+$/, '')}.Gabcde.nur-ein-test-token`;
const BOARD = '100000000000000001';
const REQUESTS = '100000000000000002';
const ME = '300000000000000003';

// --- So streng wie Discord selbst ------------------------------------------------------

const TOP_LEVEL = new Set([1, 9, 10, 12, 13, 14, 17]);
const IN_CONTAINER = new Set([1, 9, 10, 12, 13, 14]);

function validateComponent(component, where) {
  switch (component.type) {
    case 1:
      assert.ok(component.components.length >= 1 && component.components.length <= 5, `${where}: 1–5 Knöpfe`);
      for (const button of component.components) validateComponent(button, `${where} > Knopf`);
      break;
    case 2:
      assert.equal(component.style, 5, `${where}: nur Link-Knöpfe`);
      assert.match(component.url, /^https?:\/\//, `${where}: Link`);
      assert.ok(component.url.length <= 512);
      assert.ok(component.label && component.label.length <= 80, `${where}: Beschriftung`);
      if (component.emoji) assert.ok(component.emoji.id || component.emoji.name, `${where}: Emoji`);
      break;
    case 9:
      assert.ok(component.components.length >= 1 && component.components.length <= 3, `${where}: 1–3 Texte`);
      component.components.forEach((child) => assert.equal(child.type, 10, `${where}: nur Texte im Abschnitt`));
      assert.ok([2, 11].includes(component.accessory.type), `${where}: Bild oder Knopf daneben`);
      validateComponent(component.accessory, `${where} > daneben`);
      break;
    case 10:
      assert.equal(typeof component.content, 'string');
      assert.ok(component.content.length >= 1, `${where}: leerer Text`);
      break;
    case 11:
      assert.match(component.media.url, /^https?:\/\//, `${where}: Bild-Adresse`);
      assert.ok(!component.description || component.description.length <= 1024);
      break;
    case 17:
      assert.ok(component.components.length >= 1 && component.components.length <= 10, `${where}: 1–10 Bausteine`);
      assert.ok(Number.isInteger(component.accent_color) && component.accent_color <= 0xffffff);
      component.components.forEach((child, i) => {
        assert.ok(IN_CONTAINER.has(child.type), `${where}: Typ ${child.type} nicht im Kasten erlaubt`);
        validateComponent(child, `${where} > ${i}`);
      });
      break;
    default:
      assert.fail(`${where}: unbekannter Typ ${component.type}`);
  }
}

function validateMessage(body) {
  assert.equal(body.flags & bot.COMPONENTS_V2, bot.COMPONENTS_V2, 'Components-V2-Flag fehlt');
  assert.equal(body.content, undefined, 'mit Components V2 kein content');
  assert.equal(body.embeds, undefined, 'mit Components V2 keine embeds');
  assert.ok(Array.isArray(body.allowed_mentions.parse) && body.allowed_mentions.parse.length === 0, 'Pings begrenzen');
  assert.ok(body.components.length >= 1);
  body.components.forEach((component, i) => {
    assert.ok(TOP_LEVEL.has(component.type), `Typ ${component.type} nicht oben erlaubt`);
    validateComponent(component, `#${i}`);
  });
  assert.ok(bot.countComponents(body.components) <= 40, `zu viele Bausteine: ${bot.countComponents(body.components)}`);
  assert.ok(bot.textLength(body.components) <= 4000, `zu viel Text: ${bot.textLength(body.components)}`);
}

function allText(body) {
  const out = [];
  const walk = (list) => list.forEach((c) => {
    if (c.content) out.push(c.content);
    if (c.label) out.push(`[${c.label}](${c.url})`);
    if (c.components) walk(c.components);
    if (c.accessory) walk([c.accessory]);
  });
  walk(body.components);
  return out.join('\n');
}

// --- Ein Discord zum Ausprobieren ----------------------------------------------------------

function fakeDiscord({ webhooks = {}, existingEmojis = [], failEmojiUpload = false } = {}) {
  let counter = 5000;
  const newId = () => `9000000000000${counter++}`;
  const fail = (status, code, message) => { throw new DiscordError(status, { code, message }, '', ''); };
  const fake = {
    applicationId: APP_ID,
    calls: [],
    messages: new Map(),
    emojis: [...existingEmojis],
    failPost: null,
    async request(method, path, body, options = {}) {
      fake.calls.push({ method, path, body, auth: options.auth !== false });
      let match = /^\/channels\/(\d+)\/messages$/.exec(path);
      if (match && method === 'POST') {
        if (fake.failPost) fail(...fake.failPost);
        validateMessage(body);
        const id = newId();
        fake.messages.set(id, { channelId: match[1], body });
        return { id, channel_id: match[1] };
      }
      match = /^\/channels\/(\d+)\/messages\/(\d+)$/.exec(path);
      if (match) {
        const message = fake.messages.get(match[2]);
        if (!message || message.channelId !== match[1]) fail(404, 10008, 'Unknown Message');
        if (method === 'PATCH') {
          validateMessage(body);
          message.body = body;
          return { id: match[2] };
        }
        if (method === 'DELETE') {
          fake.messages.delete(match[2]);
          return null;
        }
      }
      if (path === `/applications/${APP_ID}/emojis` && method === 'GET') return { items: fake.emojis };
      if (path === `/applications/${APP_ID}/emojis` && method === 'POST') {
        if (failEmojiUpload) fail(403, 50013, 'Missing Permissions');
        assert.match(body.name, /^druck_[a-z0-9]+$/);
        assert.match(body.image, /^data:image\/png;base64,iVBOR/);
        const emoji = { id: newId(), name: body.name };
        fake.emojis.push(emoji);
        return emoji;
      }
      match = /^\/webhooks\/(\d+)\/[\w-]+$/.exec(path);
      if (match && method === 'GET') {
        assert.equal(options.auth, false, 'Webhook ohne Bot-Token abfragen');
        if (!webhooks[match[1]]) fail(404, 10015, 'Unknown Webhook');
        return { id: match[1], channel_id: webhooks[match[1]] };
      }
      throw new Error(`Unerwartete Discord-Anfrage: ${method} ${path}`);
    },
    count: (method, pattern) => fake.calls.filter((c) => c.method === method && pattern.test(c.path)).length,
    inChannel: (channelId) => [...fake.messages.entries()].filter(([, m]) => m.channelId === channelId),
  };
  return fake;
}

const botConfig = (extra = {}) => ({
  discordBotToken: TOKEN,
  discordChannelId: BOARD,
  discordRequestsChannelId: REQUESTS,
  discordWebhookUrl: '',
  discordRequestsWebhookUrl: '',
  publicUrl: 'https://druck.example',
  ...extra,
});

let env;
let fake;
async function start(configExtra = {}, fakeOptions = {}) {
  fake = fakeDiscord(fakeOptions);
  env = await startApp(botConfig(configExtra), { discordApi: fake });
  return env;
}
afterEach(() => env && env.close());
beforeEach(() => {
  env = null;
});

async function approve(admin, title, requester = 'Lena') {
  await env.client().submit({ title, requester });
  await env.settle();
  await admin.post(`/admin/auftrag/${await env.idOf(title)}/approve`);
}

const boardMessage = () => {
  const entries = fake.inChannel(BOARD);
  assert.equal(entries.length, 1, 'genau eine Warteschlangen-Nachricht');
  return { id: entries[0][0], text: allText(entries[0][1].body), body: entries[0][1].body };
};

// --- Warteschlange --------------------------------------------------------------------------

test('Bot: Die Warteschlange ist eine Nachricht, die bearbeitet statt neu geschickt wird', async () => {
  await start();
  const admin = await env.admin();
  await approve(admin, 'Vase');
  const first = boardMessage();
  assert.match(first.text, /Druck-Warteschlange/);
  assert.match(first.text, /### <:druck_platz1:\d+> Vase/);
  assert.match(first.text, /1 Auftrag wartet aufs Drucken · aktualisiert <t:\d+:R>/);
  assert.match(first.text, /\[Ganze Warteschlange\]\(https:\/\/druck.example\/warteschlange\)/);
  assert.match((await admin.get('/admin')).text, /Die Warteschlange steht jetzt neu in Discord/);

  await approve(admin, 'Drache');
  await approve(admin, 'Knopf');
  await approve(admin, 'Kabelhalter');
  const now = boardMessage();
  assert.equal(now.id, first.id, 'dieselbe Nachricht');
  assert.match(now.text, /<:druck_platz3:\d+> Knopf/);
  assert.match(now.text, /-# Danach: 4\. Kabelhalter/);
  assert.equal(fake.count('POST', /^\/channels\/100000000000000001\//), 1);
  assert.ok(fake.count('PATCH', /^\/channels\/100000000000000001\//) >= 3);
  assert.deepEqual(env.sent, [], 'kein Webhook im Bot-Betrieb');
  // Stille Bearbeitung – keine Meldung im Admin-Bereich.
  assert.doesNotMatch((await admin.get('/admin')).text, /steht jetzt neu in Discord/);

  // Ändert sich an der Warteschlange nichts, bleibt die Nachricht unberührt.
  const edits = fake.count('PATCH', /^\/channels\/100000000000000001\//);
  await env.client().submit({ title: 'Wartet noch' });
  await env.settle();
  await admin.post(`/admin/auftrag/${await env.idOf('Wartet noch')}/reject`);
  assert.equal(fake.count('PATCH', /^\/channels\/100000000000000001\//), edits);
});

test('Bot: In Discord gelöscht → neu geschickt; „Neu posten“ holt die Nachricht nach unten', async () => {
  await start();
  const admin = await env.admin();
  await approve(admin, 'Vase');
  const first = boardMessage();
  fake.messages.delete(first.id); // jemand löscht sie in Discord
  await approve(admin, 'Drache');
  const second = boardMessage();
  assert.notEqual(second.id, first.id);

  const res = await admin.post('/admin/discord/senden');
  assert.equal(res.status, 303);
  const third = boardMessage();
  assert.notEqual(third.id, second.id);
  assert.ok(fake.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(`/messages/${second.id}`)));
  assert.match((await admin.get('/admin')).text, /Die Warteschlange steht jetzt neu in Discord/);
});

test('Bot: Beim Start wird die Nachricht angelegt – auch bei leerer Warteschlange', async () => {
  await start();
  assert.equal(await discord.startup(env.store, env.config, { api: fake }), 'sent');
  const { text } = boardMessage();
  assert.match(text, /Alles gedruckt!/);
  assert.match(text, /Gerade ist nichts zu drucken/);
  assert.equal(await discord.startup(env.store, env.config, { api: fake }), 'unchanged');
});

// --- Anfragen --------------------------------------------------------------------------------

test('Bot: Anfrage-Nachricht pingt und wird nach Freigabe, Druck und Löschen angepasst', async () => {
  await start({ discordPingUserId: ME });
  const admin = await env.admin();
  await env.client().submit({ title: 'Drache', requester: 'Leo', color: 'Silk Gold', quantity: '2', notes: 'bitte *groß*' });
  await env.settle();
  const [[messageId, message]] = fake.inChannel(REQUESTS);
  const id = await env.idOf('Drache');
  let text = allText(message.body);
  assert.match(text, /NEUE ANFRAGE · #\d+/);
  assert.match(text, /### Drache/);
  assert.match(text, /<:druck_user:\d+> Leo\u2003<:druck_hash:\d+> 2×\u2003<:druck_palette:\d+> Silk Gold/);
  assert.match(text, /> bitte \\\*groß\\\*/);
  assert.match(text, new RegExp(`<@${ME}> wartet auf deine Freigabe`));
  assert.match(text, new RegExp(`\\[Jetzt prüfen & freigeben\\]\\(https://druck.example/admin#auftrag-${id}\\)`));
  assert.deepEqual(message.body.allowed_mentions, { parse: [], users: [ME] });
  assert.equal(message.body.components[0].accent_color, 0xff9f1a);

  await admin.post(`/admin/auftrag/${id}/approve`);
  text = allText(fake.messages.get(messageId).body);
  assert.match(text, /FREIGEGEBEN/);
  assert.match(text, /steht jetzt in der Warteschlange/);
  assert.doesNotMatch(text, /Jetzt prüfen|<@/);
  assert.deepEqual(fake.messages.get(messageId).body.allowed_mentions, { parse: [] });

  await admin.post(`/admin/auftrag/${id}/done`);
  assert.match(allText(fake.messages.get(messageId).body), /GEDRUCKT[\s\S]*Gedruckt <t:\d+:R>/);

  await admin.post(`/admin/auftrag/${id}/delete`);
  text = allText(fake.messages.get(messageId).body);
  assert.match(text, /GELÖSCHT/);
  assert.match(text, /### ~~Drache~~/);
  assert.deepEqual((await env.store.readState('discord')).requests, {});
  assert.equal(fake.inChannel(REQUESTS).length, 1, 'keine zusätzliche Nachricht');
});

test('Bot: Abgelehnte Anfrage wird rot markiert', async () => {
  await start();
  const admin = await env.admin();
  await env.client().submit({ title: 'Spam' });
  await env.settle();
  const [[messageId]] = fake.inChannel(REQUESTS);
  await admin.post(`/admin/auftrag/${await env.idOf('Spam')}/reject`);
  const { body } = fake.messages.get(messageId);
  assert.match(allText(body), /ABGELEHNT[\s\S]*Abgelehnt <t:\d+:R>/);
  assert.equal(body.components[0].accent_color, 0xd93d42);
});

// --- Symbole, Kanäle, Fehler ---------------------------------------------------------------

test('Bot: Eigene Symbole werden einmal hochgeladen, vorhandene wiederverwendet', async () => {
  await start({}, { existingEmojis: [{ id: '777000000000000001', name: 'druck_logo' }] });
  const admin = await env.admin();
  await approve(admin, 'Vase');
  const uploads = fake.count('POST', /\/emojis$/);
  assert.equal(uploads, bot.EMOJI_KEYS.length - 1);
  assert.match(boardMessage().text, /## <:druck_logo:777000000000000001> Druck-Warteschlange/);

  await approve(admin, 'Drache');
  assert.equal(fake.count('POST', /\/emojis$/), uploads);
  assert.equal(fake.count('GET', /\/emojis$/), 1, 'danach aus dem Speicher');
  assert.match((await admin.get('/admin')).text, /alle hochgeladen/);
});

test('Bot: Klappt das Hochladen nicht, gibt es normale Emojis', async () => {
  await start({}, { failEmojiUpload: true });
  const admin = await env.admin();
  await approve(admin, 'Vase');
  assert.match(boardMessage().text, /### 🥇 Vase/);
  const page = (await admin.get('/admin')).text;
  assert.match(page, /0 von \d+ hochgeladen/);
  assert.match(page, /Dem Bot fehlen in diesem Kanal Rechte/);
  // Nicht bei jeder Aktion erneut versuchen.
  const tries = fake.count('POST', /\/emojis$/);
  await approve(admin, 'Drache');
  assert.equal(fake.count('POST', /\/emojis$/), tries);
});

test('Bot: Kanal wird aus der bisherigen Webhook-URL ermittelt', async () => {
  await start({
    discordChannelId: '',
    discordRequestsChannelId: '',
    discordWebhookUrl: 'https://discord.com/api/webhooks/400000000000000004/abc_DEF-123',
    discordRequestsWebhookUrl: 'https://discord.com/api/webhooks/400000000000000005/xyz',
  }, { webhooks: { '400000000000000004': BOARD, '400000000000000005': REQUESTS } });
  const admin = await env.admin();
  await approve(admin, 'Vase');
  await approve(admin, 'Drache');
  assert.equal(fake.inChannel(BOARD).length, 1);
  assert.equal(fake.inChannel(REQUESTS).length, 2);
  assert.equal(fake.count('GET', /^\/webhooks\//), 2, 'jeder Webhook nur einmal abgefragt');
  assert.deepEqual(env.sent, []);
});

test('Bot: Ohne Kanal oder ohne Zugang gibt es eine verständliche Meldung', async () => {
  await start({ discordChannelId: '' });
  const admin = await env.admin();
  await approve(admin, 'Vase');
  let page = (await admin.get('/admin')).text;
  assert.match(page, /Discord-Versand fehlgeschlagen/);
  assert.match(page, /DISCORD_CHANNEL_ID fehlt/);

  env.config.discordChannelId = BOARD;
  fake.failPost = [403, 50001, 'Missing Access'];
  await admin.post('/admin/discord/senden');
  page = (await admin.get('/admin')).text;
  assert.match(page, /ist er schon in deinem Server\?/);
  assert.ok(page.includes(`client_id=${APP_ID}`), 'Einladungslink');
  assert.match(page, /Bot in Server einladen/);

  fake.failPost = null;
  await admin.post('/admin/discord/senden');
  assert.doesNotMatch((await admin.get('/admin')).text, /Letzter Fehler/);
});

// --- Grenzen von Discord ----------------------------------------------------------------------

test('Bot-Nachrichten bleiben in Discords Grenzen – auch mit 9 langen Aufträgen', () => {
  const long = (n) => 'Sehr langer Text mit *Sternchen* und [Klammern] '.repeat(n);
  const data = { nextId: 1, jobs: [] };
  for (let i = 0; i < 14; i++) {
    const job = jobs.create(data, {
      title: `${long(4)} ${i}`, requester: `Person ${i}`, quantity: 3, color: long(1),
      notes: long(40), makerworldUrl: i % 3 ? `https://makerworld.com/de/models/${i}` : null,
      imageUrl: i % 2 ? `https://bilder.example/${i}.jpg` : null,
    });
    job.adminNote = long(20);
    jobs.enqueue(data, job.id);
  }
  const ids = Object.fromEntries(bot.EMOJI_KEYS.map((key, i) => [key, `12345678901234${String(i).padStart(4, '0')}`]));
  for (const topN of [1, 3, 9]) {
    for (const publicUrl of ['', 'https://druck.example']) {
      const config = { discordTopN: topN, publicUrl, discordPingUserId: ME };
      for (const emojiIds of [{}, ids]) {
        const board = bot.buildBoard(data, config, emojiIds);
        validateMessage(board);
        assert.match(allText(board), topN < 9 ? /-# Danach: .* · und \d+ weitere/ : /-# Danach: 10\. /);
        for (const job of data.jobs) {
          validateMessage(bot.buildRequest(job, config, emojiIds));
          validateMessage(bot.buildRequest(job, config, emojiIds, { deleted: true }));
        }
      }
    }
  }
  validateMessage(bot.buildBoard({ nextId: 1, jobs: [] }, { discordTopN: 3, publicUrl: '' }, {}));
});

test('Bot: Benutzereingaben können keine Formatierung oder Pings einschmuggeln', () => {
  const data = { nextId: 1, jobs: [] };
  const job = jobs.create(data, { title: '# Groß **fett** <@&1>', requester: '@everyone', notes: '> zitat\n## x' });
  const request = bot.buildRequest(job, { publicUrl: '' }, {});
  const text = allText(request);
  assert.match(text, /### \\# Groß \\\*\\\*fett\\\*\\\* <@&1\\>/); // keine Rollen-Erwähnung
  assert.match(text, /> \\> zitat\n> \\#\\# x/);
  assert.deepEqual(request.allowed_mentions, { parse: [] });
});

// --- Web-Anfragen an Discord ------------------------------------------------------------------

test('Discord-API: Bot-Token, Kennung, Wiederholen bei 429 und verständliche Fehler', async () => {
  const requests = [];
  const replies = [
    new Response(JSON.stringify({ message: 'You are being rate limited.', retry_after: 0.01 }), { status: 429 }),
    new Response(JSON.stringify({ id: '1' }), { status: 200 }),
    new Response(null, { status: 204 }),
    new Response(JSON.stringify({ code: 50001, message: 'Missing Access' }), { status: 403 }),
    new Response(JSON.stringify({ channel_id: '2' }), { status: 200 }),
  ];
  const api = createDiscordApi(TOKEN, {
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      return replies.shift();
    },
  });
  assert.equal(api.applicationId, APP_ID);
  assert.deepEqual(await api.request('POST', '/channels/1/messages', { a: 1 }), { id: '1' });
  assert.equal(requests.length, 2, 'nach 429 einmal wiederholt');
  assert.equal(requests[1].url, 'https://discord.com/api/v10/channels/1/messages');
  assert.equal(requests[1].headers.Authorization, `Bot ${TOKEN}`);
  assert.match(requests[1].headers['User-Agent'], /^DiscordBot \(/);
  assert.equal(requests[1].headers['Content-Type'], 'application/json');
  assert.equal(requests[1].body, '{"a":1}');

  assert.equal(await api.request('DELETE', '/channels/1/messages/2'), null);
  const err = await api.request('GET', '/channels/1').catch((e) => e);
  assert.ok(err instanceof DiscordError);
  assert.equal(err.status, 403);
  assert.equal(err.code, 50001);
  assert.match(explainError(err, APP_ID), /ist er schon in deinem Server\?.*client_id=123456789012345678/);

  await api.request('GET', '/webhooks/1/abc', undefined, { auth: false });
  assert.equal(requests.at(-1).headers.Authorization, undefined, 'Webhook ohne Bot-Token');
});

test('Discord-API: Anwendungs-ID und Einladungslink', () => {
  assert.equal(applicationIdFromToken(TOKEN), APP_ID);
  assert.equal(applicationIdFromToken('kaputt'), null);
  const url = new URL(inviteUrl(APP_ID));
  assert.equal(url.searchParams.get('client_id'), APP_ID);
  assert.equal(url.searchParams.get('scope'), 'bot');
  const permissions = BigInt(url.searchParams.get('permissions'));
  for (const bit of [10n, 11n, 14n, 16n, 18n]) assert.ok(permissions & (1n << bit), `Recht ${bit} fehlt`);
  assert.match(explainError(new DiscordError(401, { message: '401: Unauthorized', code: 0 }), APP_ID), /Bot-Token stimmt nicht/);
  assert.match(explainError(new DiscordError(403, { code: 50013 }), APP_ID), /fehlen in diesem Kanal Rechte/);
});
