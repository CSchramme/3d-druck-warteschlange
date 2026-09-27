'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp } = require('../src/server');
const { hashPassword } = require('../src/users');
const { createFileStore } = require('../src/store');
const { createMariaDbStore } = require('../src/store-mariadb');

// Mit TEST_DB=mysql://benutzer:passwort@127.0.0.1:3306/datenbank laufen alle Tests
// gegen MariaDB – jede Test-App bekommt eigene Tabellen (Präfix), die am Ende
// wieder gelöscht werden.
let dbTestCounter = 0;
function testDbConfig() {
  if (!process.env.TEST_DB) return null;
  const url = new URL(process.env.TEST_DB);
  return {
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    tablePrefix: `t${process.pid}_${++dbTestCounter}_`,
  };
}

function createTestStore(dataDir) {
  const db = testDbConfig();
  return db ? createMariaDbStore(db, { importDir: dataDir }) : createFileStore(dataDir);
}

class Client {
  constructor(base, headers = {}) {
    this.base = base;
    this.headers = headers;
    this.cookie = '';
    this.token = null;
  }

  async request(method, url, form) {
    const headers = { ...this.headers };
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(this.base + url, { method, headers, body, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }

  get(url) {
    return this.request('GET', url);
  }

  async csrf() {
    if (!this.token) {
      const page = await this.get('/');
      this.token = /name="csrf_token" value="([^"]+)"/.exec(page.text)[1];
    }
    return this.token;
  }

  async post(url, form = {}) {
    return this.request('POST', url, { csrf_token: await this.csrf(), ...form });
  }

  /** Den AGB und dem Cookie-Hinweis zustimmen (wie der Knopf im Dialog). */
  async accept() {
    await this.post('/zustimmung', { back: '/' });
    this.accepted = true;
    return this;
  }

  async submit(fields = {}) {
    if (!this.accepted) await this.accept();
    return this.post('/auftrag', { requester: 'Oma', quantity: '1', ...fields });
  }

  async login(username = 'admin', password = 'geheim123') {
    const res = await this.post('/admin/login', { username, password });
    if (res.status !== 303) throw new Error(`Login fehlgeschlagen (${res.status})`);
    return this;
  }
}

/** Startet die App auf einem freien Port mit leerem Datenordner. */
async function startApp(overrides = {}, { store: givenStore, discordApi } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'druck-test-'));
  const config = {
    dataDir,
    adminPassword: 'einrichtungs-code',
    minFormSeconds: 0,
    maxPending: 50,
    maxRequestsPerMinute: 1000, // viele Tests schicken schnell hintereinander ab; eigener Test in app.test.js
    rateWindowMs: 60_000,
    loginDelayMs: 0,
    discordWebhookUrl: 'https://discord.example/warteschlange',
    discordRequestsWebhookUrl: 'https://discord.example/anfragen',
    discordPingUserId: '',
    discordTopN: 3,
    publicUrl: '',
    timezone: 'Europe/Berlin',
    fetchMakerworldInfo: false,
    cookieSecure: false,
    secretKey: 'test-secret',
    ...overrides,
  };
  const sent = []; // Nachrichten an den Warteschlangen-Webhook
  const requests = []; // Nachrichten an den Anfragen-Webhook
  const background = [];
  const env = {
    config,
    sent,
    requests,
    post: async (url, payload) => {
      (url === config.discordRequestsWebhookUrl ? requests : sent).push(payload);
    },
    /** Wartet, bis alle Hintergrund-Meldungen raus sind. */
    settle: () => Promise.all(background),
  };
  const store = givenStore || createTestStore(dataDir);
  const app = createApp(config, {
    store,
    postWebhook: (url, payload) => env.post(url, payload),
    discordApi,
    onBackgroundTask: (promise) => background.push(promise),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return Object.assign(env, {
    app,
    store,
    dataDir,
    client: (headers) => new Client(base, headers),
    /** Legt bei Bedarf das Test-Konto „admin“ an und meldet sich damit an. */
    admin: async () => {
      if (!(await store.findUser('admin'))) await env.createUser('admin', 'geheim123', 'Admin');
      return new Client(base).login();
    },
    createUser: async (username, password, displayName = username) => store.createUser({
      username, displayName, passwordHash: await hashPassword(password),
    }),
    data: () => store.readData(),
    byStatus: async (status) => (await store.readData()).jobs.filter((job) => job.status === status),
    queueTitles: async () => require('../src/jobs').queue(await store.readData()).map((job) => job.title),
    idOf: async (title) => (await store.readData()).jobs.find((job) => job.title === title).id,
    close: async () => {
      await env.settle();
      await new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      });
      if (store.dropTables) await store.dropTables().catch(() => {});
      await store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  });
}

module.exports = { startApp };
