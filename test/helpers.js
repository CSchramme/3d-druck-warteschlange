'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp } = require('../src/server');
const { createStore } = require('../src/store');

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
    this.token = null;
  }

  async request(method, url, form) {
    const headers = {};
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
      const page = await this.get('/admin/login');
      this.token = /name="csrf_token" value="([^"]+)"/.exec(page.text)[1];
    }
    return this.token;
  }

  async post(url, form = {}) {
    return this.request('POST', url, { csrf_token: await this.csrf(), ...form });
  }

  submit(fields = {}) {
    return this.post('/auftrag', { requester: 'Oma', quantity: '1', ...fields });
  }

  async loginAdmin() {
    const res = await this.post('/admin/login', { password: 'geheim' });
    if (res.status !== 303) throw new Error('Admin-Login fehlgeschlagen');
    return this;
  }
}

/** Startet die App auf einem freien Port mit leerem Datenordner. */
async function startApp(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'druck-test-'));
  const config = {
    dataDir,
    adminPassword: 'geheim',
    familyPassword: '',
    discordWebhookUrl: 'https://discord.example/api/webhooks/1/abc',
    discordTopN: 3,
    publicUrl: '',
    timezone: 'Europe/Berlin',
    fetchMakerworldInfo: false,
    cookieSecure: false,
    secretKey: 'test-secret',
    ...overrides,
  };
  const sent = [];
  const env = {
    config,
    sent,
    post: async (url, payload) => {
      sent.push(payload);
    },
  };
  const app = createApp(config, { postWebhook: (url, payload) => env.post(url, payload) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const store = createStore(dataDir);

  return Object.assign(env, {
    client: () => new Client(base),
    admin: () => new Client(base).loginAdmin(),
    data: () => store.readData(),
    byStatus: (status) => store.readData().jobs.filter((job) => job.status === status),
    queueTitles: () => require('../src/jobs').queue(store.readData()).map((job) => job.title),
    idOf: (title) => store.readData().jobs.find((job) => job.title === title).id,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        resolve();
      });
    }),
  });
}

module.exports = { startApp };
