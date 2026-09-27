'use strict';

// Discord als Bot (statt Webhook):
//  - Die Warteschlange ist EINE Nachricht, die bei jeder Änderung bearbeitet wird
//    („Neu posten“ im Admin-Bereich holt sie wieder ganz nach unten).
//  - Jede neue Anfrage bekommt eine Nachricht; nach Freigeben, Ablehnen, Drucken
//    oder Löschen wird sie angepasst, statt eine neue zu schicken.
//  - Aussehen: Discords neue Nachrichten-Bausteine (Components V2) mit farbigen
//    Kästen, Vorschaubild und eigenen Symbolen, die der Bot einmalig hochlädt.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const jobs = require('./jobs');
const { isMakerworld } = require('./makerworld');
const { explainError } = require('./discord-api');

const STATE = 'discord';
const EMOJI_STATE = 'discord_symbole';
const EMOJI_DIR = path.join(__dirname, '..', 'assets', 'discord-emojis');
const PLACEHOLDER = '/discord-platzhalter.png';

const COMPONENTS_V2 = 1 << 15;
const TYPE = { ACTION_ROW: 1, BUTTON: 2, SECTION: 9, TEXT: 10, THUMBNAIL: 11, CONTAINER: 17 };
const LINK_STYLE = 5;
// Discord erlaubt 40 Bausteine und 4000 Zeichen Text pro Nachricht.
const MAX_COMPONENTS = 40;
const MAX_TEXT = 3800;
const MAX_TRACKED = 200; // so viele Anfrage-Nachrichten werden höchstens nachgeführt
const EMOJI_BUDGET_MS = 8000;
const EMOJI_RETRY_MS = 60 * 60 * 1000;

const COLORS = {
  gold: 0xf1c40f, silver: 0xbdc3c7, bronze: 0xcd7f32, green: 0x00ae42, amber: 0xff9f1a, red: 0xd93d42, grey: 0x7d858d,
};
const PLACE_COLORS = [COLORS.gold, COLORS.silver, COLORS.bronze];

// Eigene Symbole (assets/discord-emojis/<name>.png) – falls das Hochladen nicht
// klappt, stehen diese normalen Emojis an ihrer Stelle.
const FALLBACK = {
  logo: '🖨️', user: '👤', hash: '🔢', palette: '🎨', note: '📝', wrench: '🛠️', link: '🔗', alert: '⚠️',
  layers: '📋', plus: '➕', inbox: '📥', check: '✅', x: '❌', printer: '🖨️', trash: '🗑️',
  platz1: '🥇', platz2: '🥈', platz3: '🥉', platz4: '4️⃣', platz5: '5️⃣', platz6: '6️⃣', platz7: '7️⃣', platz8: '8️⃣', platz9: '9️⃣',
};
const EMOJI_KEYS = Object.keys(FALLBACK);

const STATUS = {
  pending: { color: COLORS.amber, icon: 'inbox', label: 'Neue Anfrage' },
  queued: { color: COLORS.green, icon: 'check', label: 'Freigegeben' },
  done: { color: COLORS.green, icon: 'printer', label: 'Gedruckt' },
  rejected: { color: COLORS.red, icon: 'x', label: 'Abgelehnt' },
  deleted: { color: COLORS.grey, icon: 'trash', label: 'Gelöscht' },
};

const NO_CHANNEL = 'Kein Discord-Kanal eingestellt: DISCORD_CHANNEL_ID fehlt (oder DISCORD_WEBHOOK_URL, '
  + 'aus der der Kanal ermittelt wird).';

// --- Text-Hilfen -------------------------------------------------------------------

const esc = (text) => String(text || '').replace(/([\\*_~|`>[\]#])/g, '\\$1');
const cut = (text, limit) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`);
const oneLine = (text) => String(text || '').replace(/\s*\n\s*/g, ' ');
const quote = (text) => esc(text).split('\n').map((line) => `> ${line}`).join('\n');
const linkTarget = (url) => url.replace(/\)/g, '%29').replace(/ /g, '%20');
const isHttp = (url) => typeof url === 'string' && /^https?:\/\/\S+$/.test(url) && url.length <= 1000;
const hash = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
const when = (iso) => (iso ? `<t:${Math.floor(Date.parse(iso) / 1000)}:R>` : '');

function emojis(ids = {}) {
  return {
    text: (key) => (ids[key] ? `<:druck_${key}:${ids[key]}>` : FALLBACK[key]),
    button: (key) => (ids[key] ? { id: ids[key], name: `druck_${key}` } : { name: FALLBACK[key] }),
  };
}

// --- Bausteine -------------------------------------------------------------------------

const text = (content) => ({ type: TYPE.TEXT, content });
const container = (color, components) => ({ type: TYPE.CONTAINER, accent_color: color, components });
const linkButton = (label, url, emoji) => ({ type: TYPE.BUTTON, style: LINK_STYLE, label, url, ...(emoji ? { emoji } : {}) });
const actionRow = (buttons) => ({ type: TYPE.ACTION_ROW, components: buttons });

/** Vorschaubild rechts neben dem Text – sonst Platzhalter oder Link-Knopf. */
function accessory(job, publicUrl) {
  if (isHttp(job.imageUrl)) return { type: TYPE.THUMBNAIL, media: { url: job.imageUrl }, description: cut(job.title, 200) };
  if (publicUrl) return { type: TYPE.THUMBNAIL, media: { url: publicUrl + PLACEHOLDER }, description: 'Kein Vorschaubild' };
  if (isHttp(job.makerworldUrl) && job.makerworldUrl.length <= 512) return linkButton('Öffnen', job.makerworldUrl);
  return null;
}

function block(content, side) {
  return side ? { type: TYPE.SECTION, components: [text(content)], accessory: side } : text(content);
}

function jobLines(job, e, noteLimit, textLimit = 60) {
  const meta = [`${e('user')} ${esc(cut(job.requester || '', textLimit))}`];
  if (job.quantity > 1) meta.push(`${e('hash')} ${job.quantity}×`);
  if (job.color) meta.push(`${e('palette')} ${esc(cut(job.color, textLimit))}`);
  const lines = [meta.join(' ')];
  if (isHttp(job.makerworldUrl)) {
    lines.push(`${e('link')} [${isMakerworld(job.makerworldUrl) ? 'Auf MakerWorld ansehen' : 'Link zum Modell'}](${
      linkTarget(job.makerworldUrl)})`);
  } else {
    lines.push(`${e('alert')} Kein Link – Modell selbst besorgen`);
  }
  if (job.notes && noteLimit) lines.push(quote(cut(job.notes, noteLimit)));
  if (job.adminNote && noteLimit) lines.push(`-# ${e('wrench')} ${esc(cut(oneLine(job.adminNote), noteLimit))}`);
  return lines;
}

function countComponents(list) {
  return list.reduce((sum, component) => sum + 1
    + (component.components ? countComponents(component.components) : 0)
    + (component.accessory ? 1 : 0), 0);
}

function textLength(list) {
  return list.reduce((sum, component) => sum + (component.content ? component.content.length : 0)
    + (component.components ? textLength(component.components) : 0), 0);
}

const fits = (payload) => countComponents(payload.components) <= MAX_COMPONENTS
  && textLength(payload.components) <= MAX_TEXT;

// --- Nachricht: Warteschlange ---------------------------------------------------------------

/** now = 0 ergibt eine Fassung ohne Uhrzeit – daran wird erkannt, ob sich etwas geändert hat. */
function buildBoard(data, config, ids, { now = Date.now() } = {}) {
  const e = emojis(ids);
  const queue = jobs.queue(data);
  const top = queue.slice(0, config.discordTopN);
  const rest = queue.slice(top.length);
  const updated = now ? ` · aktualisiert <t:${Math.floor(now / 1000)}:R>` : '';

  const build = ({ noteLimit, titleLimit = 120 }, withImage) => {
    const components = [text(`## ${e.text('logo')} Druck-Warteschlange\n-# ${queue.length
      ? `${queue.length} ${queue.length === 1 ? 'Auftrag wartet' : 'Aufträge warten'} aufs Drucken`
      : 'Gerade ist nichts zu drucken'}${updated}`)];

    if (!top.length) {
      components.push(container(COLORS.green, [text(`### ${e.text('check')} Alles gedruckt!\n`
        + 'In der Warteschlange wartet gerade nichts.')]));
    }
    top.forEach((job, index) => {
      const lines = [`### ${e.text(`platz${index + 1}`)} ${esc(cut(job.title, titleLimit))}`,
        ...jobLines(job, e.text, noteLimit, titleLimit < 120 ? 30 : 60)];
      if (index === 0) lines.splice(1, 0, '-# Als Nächstes dran');
      const side = withImage(index) ? accessory(job, config.publicUrl) : null;
      components.push(container(PLACE_COLORS[index] ?? COLORS.green, [block(lines.join('\n'), side)]));
    });
    if (rest.length) {
      const shown = rest.slice(0, 5).map((job, i) => `${top.length + i + 1}. ${esc(cut(job.title, Math.min(titleLimit, 60)))}`);
      const more = rest.length - shown.length;
      components.push(text(`-# Danach: ${shown.join(' · ')}${more ? ` · und ${more} weitere` : ''}`));
    }
    if (config.publicUrl) {
      components.push(actionRow([
        linkButton('Auftrag einreichen', `${config.publicUrl}/`, e.button('plus')),
        linkButton('Ganze Warteschlange', `${config.publicUrl}/warteschlange`, e.button('layers')),
      ]));
    }
    return { flags: COMPONENTS_V2, components, allowed_mentions: { parse: [] } };
  };

  // Passend machen: erst Notizen kürzen, dann Titel, dann Vorschaubilder von hinten weglassen.
  const steps = [300, 150, 60, 0].map((noteLimit) => ({ noteLimit }))
    .concat([70, 40, 25].map((titleLimit) => ({ noteLimit: 0, titleLimit })));
  for (const step of steps) {
    const payload = build(step, () => true);
    if (fits(payload)) return payload;
  }
  const smallest = steps.at(-1);
  for (let keep = top.length - 1; keep > 0; keep--) {
    const payload = build(smallest, (index) => index < keep);
    if (fits(payload)) return payload;
  }
  return build(smallest, () => false);
}

// --- Nachricht: Anfrage ---------------------------------------------------------------------

const JOB_SNAPSHOT = ['id', 'title', 'requester', 'quantity', 'color', 'makerworldUrl', 'imageUrl', 'createdAt'];
const snapshotJob = (job) => Object.fromEntries(JOB_SNAPSHOT.map((field) => [field, job[field] ?? null]));

function buildRequest(job, config, ids, { deleted = false } = {}) {
  const e = emojis(ids);
  const status = STATUS[deleted ? 'deleted' : job.status] || STATUS.pending;
  const title = esc(cut(job.title, 120));
  const pending = !deleted && job.status === 'pending';
  const ping = pending && /^\d{15,25}$/.test(config.discordPingUserId || '') ? config.discordPingUserId : null;

  const lines = [
    `-# ${e.text(status.icon)} ${status.label.toUpperCase()} · #${job.id}`,
    `### ${deleted ? `~~${title}~~` : title}`,
    ...jobLines(job, e.text, deleted ? 0 : 400),
  ];
  let footer;
  if (deleted) footer = '-# Dieser Auftrag wurde gelöscht.';
  else if (pending) footer = `${ping ? `<@${ping}> wartet` : 'Wartet'} auf deine Freigabe · eingereicht ${when(job.createdAt)}`;
  else if (job.status === 'queued') footer = `-# Freigegeben ${when(job.approvedAt)} – steht jetzt in der Warteschlange.`;
  else if (job.status === 'done') footer = `-# Gedruckt ${when(job.finishedAt)}.`;
  else footer = `-# Abgelehnt ${when(job.finishedAt)}.`;

  const inner = [block(lines.join('\n'), deleted ? null : accessory(job, config.publicUrl)), text(footer)];
  if (pending && config.publicUrl) {
    inner.push(actionRow([linkButton('Jetzt prüfen & freigeben', `${config.publicUrl}/admin#auftrag-${job.id}`, e.button('check'))]));
  }
  return {
    flags: COMPONENTS_V2,
    components: [container(status.color, inner)],
    allowed_mentions: ping ? { parse: [], users: [ping] } : { parse: [] },
  };
}

// --- Symbole ------------------------------------------------------------------------------

/** Lädt fehlende eigene Symbole zum Bot hoch (einmalig) und merkt sich ihre IDs. */
async function ensureEmojis(store, api, { budgetMs = EMOJI_BUDGET_MS, force = false } = {}) {
  const appId = api.applicationId;
  const current = await store.readState(EMOJI_STATE);
  const cached = current.appId === appId ? current.ids || {} : {};
  if (!appId || EMOJI_KEYS.every((key) => cached[key])) return cached;
  if (!force && current.appId === appId && current.retryAt && Date.parse(current.retryAt) > Date.now()) return cached;

  return store.withLock(EMOJI_STATE, async () => {
    const fresh = await store.readState(EMOJI_STATE);
    const ids = { ...(fresh.appId === appId ? fresh.ids || {} : {}) };
    let next = { appId, ids, retryAt: null, error: null };
    try {
      const listed = await api.request('GET', `/applications/${appId}/emojis`);
      for (const emoji of (listed && listed.items) || []) {
        const key = emoji.name.replace(/^druck_/, '');
        if (emoji.name.startsWith('druck_') && FALLBACK[key]) ids[key] = emoji.id;
      }
      const started = Date.now();
      for (const key of EMOJI_KEYS) {
        if (ids[key]) continue;
        if (Date.now() - started > budgetMs) break; // Rest beim nächsten Mal
        const image = `data:image/png;base64,${fs.readFileSync(path.join(EMOJI_DIR, `${key}.png`)).toString('base64')}`;
        const created = await api.request('POST', `/applications/${appId}/emojis`, { name: `druck_${key}`, image });
        ids[key] = created.id;
      }
    } catch (err) {
      console.warn(`Discord-Symbole konnten nicht hochgeladen werden: ${err.message}`);
      next = { ...next, retryAt: new Date(Date.now() + EMOJI_RETRY_MS).toISOString(), error: explainError(err, appId) };
    }
    await store.writeState(EMOJI_STATE, next);
    return ids;
  });
}

async function emojiIds(store, api) {
  try {
    return await ensureEmojis(store, api);
  } catch (err) {
    console.warn(`Discord-Symbole: ${err.message}`);
    const state = await store.readState(EMOJI_STATE);
    return state.appId === api.applicationId ? state.ids || {} : {};
  }
}

// --- Kanäle -------------------------------------------------------------------------------

const WEBHOOK = /\/webhooks\/(\d+)\/([\w-]+)/;

/** Kanal eines Webhooks herausfinden – so reicht die bisherige Webhook-URL als Einstellung. */
async function webhookChannel(api, url, cache) {
  const match = WEBHOOK.exec(url || '');
  if (!match) return null;
  if (!cache[match[1]]) {
    const hook = await api.request('GET', `/webhooks/${match[1]}/${match[2]}`, undefined, { auth: false });
    cache[match[1]] = hook.channel_id;
  }
  return cache[match[1]];
}

async function channels(api, config, state) {
  state.webhookChannels = { ...(state.webhookChannels || {}) };
  const board = config.discordChannelId
    || await webhookChannel(api, config.discordWebhookUrl, state.webhookChannels);
  const requests = config.discordRequestsChannelId
    || await webhookChannel(api, config.discordRequestsWebhookUrl, state.webhookChannels)
    || board;
  return { board: board || null, requests: requests || null };
}

// --- Senden & Bearbeiten ---------------------------------------------------------------------

const isGone = (err) => err.status === 404;

async function deleteQuietly(api, message) {
  try {
    await api.request('DELETE', `/channels/${message.channelId}/messages/${message.messageId}`);
  } catch (err) {
    if (!isGone(err)) console.warn(`Alte Discord-Nachricht nicht gelöscht: ${err.message}`);
  }
}

/** Bearbeitet die Warteschlangen-Nachricht – oder schickt sie neu, falls es sie nicht (mehr) gibt. */
async function publishBoard(api, board, channelId, payload, force) {
  if (board && board.channelId === channelId && !force) {
    try {
      await api.request('PATCH', `/channels/${channelId}/messages/${board.messageId}`, payload);
      return { result: 'updated', messageId: board.messageId };
    } catch (err) {
      if (!isGone(err)) throw err; // in Discord gelöscht → unten neu schicken
    }
  } else if (board) {
    await deleteQuietly(api, board); // „Neu posten“ oder anderer Kanal
  }
  const message = await api.request('POST', `/channels/${channelId}/messages`, payload);
  return { result: 'sent', messageId: message.id };
}

/** Passt Anfrage-Nachrichten an, deren Auftrag sich geändert hat. */
async function updateRequests(api, data, config, ids, state) {
  const tracked = { ...(state.requests || {}) };
  for (const [id, entry] of Object.entries(tracked)) {
    const job = jobs.get(data, Number(id));
    const payload = buildRequest(job || entry.job, config, ids, { deleted: !job });
    const sig = hash(payload);
    if (sig === entry.sig) continue;
    try {
      await api.request('PATCH', `/channels/${entry.channelId}/messages/${entry.messageId}`, payload);
    } catch (err) {
      if (!isGone(err)) {
        state.requests = tracked;
        throw err;
      }
      delete tracked[id]; // Nachricht in Discord gelöscht
      continue;
    }
    if (job) tracked[id] = { ...entry, sig, job: snapshotJob(job) };
    else delete tracked[id];
  }
  state.requests = tracked;
}

function remember(state, err, applicationId) {
  console.warn(`Discord-Versand fehlgeschlagen: ${err.message}`);
  state.lastError = { at: new Date().toISOString(), message: explainError(err, applicationId) };
}

/**
 * Bringt Discord auf den aktuellen Stand. Ergebnis: 'unchanged', 'updated'
 * (Nachricht bearbeitet), 'sent' (neu geschickt) oder 'error'.
 */
async function sync(store, config, { api, force = false }) {
  const ids = await emojiIds(store, api);
  return store.withLock(STATE, async () => {
    const data = await store.readData();
    const state = { ...(await store.readState(STATE)) };
    let result = 'unchanged';
    try {
      const { board: channelId } = await channels(api, config, state);
      if (!channelId) throw new Error(NO_CHANNEL);
      const sig = hash(buildBoard(data, config, ids, { now: 0 }));
      const board = state.board;
      if (force || !board || board.channelId !== channelId || board.sig !== sig) {
        const published = await publishBoard(api, board, channelId, buildBoard(data, config, ids), force);
        state.board = { channelId, messageId: published.messageId, sig };
        state.lastSentAt = new Date().toISOString();
        result = published.result;
      }
      await updateRequests(api, data, config, ids, state);
      state.lastError = null;
    } catch (err) {
      remember(state, err, api.applicationId);
      result = 'error';
    }
    await store.writeState(STATE, state);
    return result;
  });
}

/** Neue Anfrage melden (mit Ping, falls eingestellt). Ergebnis: 'sent' oder 'error'. */
async function notifyNewRequest(store, config, job, { api }) {
  const ids = await emojiIds(store, api);
  return store.withLock(STATE, async () => {
    const state = { ...(await store.readState(STATE)) };
    let result = 'sent';
    try {
      const { requests: channelId } = await channels(api, config, state);
      if (!channelId) throw new Error(NO_CHANNEL);
      const payload = buildRequest(job, config, ids);
      const message = await api.request('POST', `/channels/${channelId}/messages`, payload);
      const tracked = { ...(state.requests || {}), [job.id]: { channelId, messageId: message.id, sig: hash(payload), job: snapshotJob(job) } };
      const oldest = Object.keys(tracked).map(Number).sort((a, b) => a - b);
      oldest.slice(0, Math.max(0, oldest.length - MAX_TRACKED)).forEach((id) => delete tracked[id]);
      state.requests = tracked;
      state.lastError = null;
    } catch (err) {
      remember(state, err, api.applicationId);
      result = 'error';
    }
    await store.writeState(STATE, state);
    return result;
  });
}

/** Beim Start: Symbole hochladen und die Warteschlangen-Nachricht anlegen bzw. auffrischen. */
async function startup(store, config, { api }) {
  await ensureEmojis(store, api, { budgetMs: 20_000 }).catch(() => {});
  return sync(store, config, { api });
}

async function emojiStatus(store, api) {
  const state = await store.readState(EMOJI_STATE);
  const ids = state.appId === api.applicationId ? state.ids || {} : {};
  return { uploaded: EMOJI_KEYS.filter((key) => ids[key]).length, total: EMOJI_KEYS.length, error: state.error || null };
}

module.exports = {
  COMPONENTS_V2, EMOJI_KEYS, EMOJI_DIR, MAX_COMPONENTS, MAX_TEXT, PLACEHOLDER,
  buildBoard, buildRequest, countComponents, textLength, ensureEmojis, channels, sync, notifyNewRequest, startup,
  emojiStatus,
};
