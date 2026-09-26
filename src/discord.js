'use strict';

// Discord-Nachrichten per Webhook:
//  - die obersten Aufträge der Warteschlange – aber nur, wenn sich an ihnen
//    tatsächlich etwas geändert hat,
//  - jede neue Anfrage, die auf deine Freigabe wartet.

const jobs = require('./jobs');
const { isMakerworld } = require('./makerworld');

const STATE = 'discord';
const COLORS = {
  gold: 0xf1c40f,
  silver: 0xbdc3c7,
  bronze: 0xcd7f32,
  queue: 0x00ae42, // Bambu-Grün, ab Platz 4
  request: 0xff9f1a,
  empty: 0x2ecc71,
};
const PLACES = [
  { medal: '🥇', color: COLORS.gold },
  { medal: '🥈', color: COLORS.silver },
  { medal: '🥉', color: COLORS.bronze },
];
const SNAPSHOT_FIELDS = [
  'id', 'title', 'requester', 'makerworldUrl', 'imageUrl', 'quantity', 'color', 'notes', 'adminNote',
];
// Discord erlaubt höchstens 6000 Zeichen Text in allen Embeds einer Nachricht.
const MAX_EMBED_CHARS = 5800;

function snapshot(top) {
  return JSON.stringify(top.map((job) => SNAPSHOT_FIELDS.map((field) => job[field] ?? null)));
}

const esc = (text) => String(text || '').replace(/([\\*_~|`>[\]])/g, '\\$1');
const cut = (text, limit) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`);

const adminLink = (publicUrl, job) =>
  publicUrl ? `${publicUrl}/admin${job ? `#auftrag-${job.id}` : ''}` : null;

function jobFields(job) {
  const fields = [
    { name: '👤 Für', value: esc(job.requester), inline: true },
    { name: '🔢 Anzahl', value: `${job.quantity || 1}×`, inline: true },
    { name: '🎨 Farbe / Material', value: job.color ? esc(job.color) : 'egal', inline: true },
  ];
  if (job.notes) fields.push({ name: '📝 Wünsche', value: esc(cut(job.notes, 500)), shrink: true });
  if (job.adminNote) fields.push({ name: '🛠️ Deine Notiz', value: esc(cut(job.adminNote, 300)), shrink: true });

  const url = job.makerworldUrl;
  if (url && isMakerworld(url)) fields.push({ name: '🔗 Modell', value: `[Auf MakerWorld öffnen](${url})` });
  else if (url) fields.push({ name: '🔗 Modell', value: `[Link zum Modell öffnen](${url})` });
  else fields.push({ name: '⚠️ Kein MakerWorld-Link', value: 'Modell musst du selbst besorgen oder erstellen.' });
  return fields;
}

function embedLength(embed) {
  let length = (embed.title || '').length + (embed.description || '').length
    + (embed.author ? embed.author.name.length : 0) + (embed.footer ? embed.footer.text.length : 0);
  for (const field of embed.fields || []) length += field.name.length + field.value.length;
  return length;
}

/** Kürzt lange Notizen, bis alles in Discords Zeichenlimit passt. */
function fitToLimit(embeds) {
  const shrinkable = embeds.flatMap((embed) => (embed.fields || []).filter((field) => field.shrink));
  const total = () => embeds.reduce((sum, embed) => sum + embedLength(embed), 0);
  while (total() > MAX_EMBED_CHARS && shrinkable.length) {
    const longest = shrinkable.reduce((a, b) => (b.value.length > a.value.length ? b : a));
    if (longest.value.length <= 40) break;
    longest.value = cut(longest.value, Math.floor(longest.value.length / 2));
  }
  shrinkable.forEach((field) => delete field.shrink);
  return embeds;
}

function jobEmbed(job, extra) {
  const embed = {
    title: cut(job.title, 256),
    fields: jobFields(job),
    timestamp: job.createdAt,
    ...extra,
  };
  if (job.makerworldUrl) embed.url = job.makerworldUrl;
  if (job.imageUrl) embed.thumbnail = { url: job.imageUrl };
  return embed;
}

/** Nachricht mit den nächsten Aufträgen der Warteschlange. */
function buildPayload(top, publicUrl = '') {
  const overview = adminLink(publicUrl);
  const link = overview ? `\n[Zur Übersicht](<${overview}>)` : '';

  if (top.length === 0) {
    return {
      content: `✅ **Druck-Warteschlange leer** – alles gedruckt!${link}`,
      embeds: [{
        color: COLORS.empty,
        title: 'Alles erledigt 🎉',
        description: 'Gerade wartet nichts in der Warteschlange.',
        timestamp: new Date().toISOString(),
      }],
      allowed_mentions: { parse: [] },
    };
  }

  const embeds = top.map((job, index) => {
    const place = PLACES[index] || { medal: '🖨️', color: COLORS.queue };
    return jobEmbed(job, {
      color: place.color,
      author: { name: `${place.medal} Platz ${index + 1}${index === 0 ? ' · als Nächstes drucken' : ''}` },
      footer: { text: `Auftrag #${job.id} · eingereicht` },
    });
  });

  return {
    content: `🖨️ **Druck-Warteschlange aktualisiert** · als Nächstes: **${esc(cut(top[0].title, 120))}**${link}`,
    embeds: fitToLimit(embeds),
    // Keine @everyone/@here/Rollen-Pings aus Namen oder Notizen zulassen.
    allowed_mentions: { parse: [] },
  };
}

/** Nachricht für eine neue Anfrage, die auf Freigabe wartet. */
function buildRequestPayload(job, { publicUrl = '', pingUserId = '', pendingCount = 1 } = {}) {
  const link = adminLink(publicUrl, job);
  const embed = jobEmbed(job, {
    color: COLORS.request,
    author: { name: '🆕 Neue Anfrage · wartet auf deine Freigabe' },
    description: link
      ? `👉 **[Jetzt prüfen & freigeben](${link})**`
      : 'Freigeben kannst du im Admin-Bereich unter **/admin**.',
    footer: {
      text: `Anfrage #${job.id}${pendingCount > 1 ? ` · ${pendingCount} warten auf Freigabe` : ''}`,
    },
  });

  const payload = {
    content: `🆕 **Neue Anfrage** von **${esc(job.requester)}**: ${esc(cut(job.title, 120))}`,
    embeds: fitToLimit([embed]),
    allowed_mentions: { parse: [] },
  };
  if (/^\d{15,25}$/.test(pingUserId)) {
    payload.content = `<@${pingUserId}> ${payload.content}`;
    payload.allowed_mentions = { parse: [], users: [pingUserId] };
  }
  return payload;
}

async function postWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://github.com/cschramme/3d-druck-warteschlange, 1.0)',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Discord antwortete mit ${response.status}: ${body}`);
  }
}

function rememberError(store, err) {
  console.warn(`Discord-Versand fehlgeschlagen: ${err.message}`);
  return store.withLock(STATE, () => {
    store.writeState(STATE, {
      ...store.readState(STATE),
      lastError: { at: new Date().toISOString(), message: err.message },
    });
  });
}

/**
 * Schickt die obersten Aufträge an Discord, falls sie sich seit dem letzten
 * Versand geändert haben (oder force). Ergebnis: 'unchanged', 'disabled',
 * 'sent' oder 'error'.
 */
function sync(store, config, { force = false, post = postWebhook } = {}) {
  return store.withLock(STATE, async () => {
    const top = jobs.queue(store.readData(), config.discordTopN);
    const current = snapshot(top);
    const state = store.readState(STATE);
    if (!force && current === (state.lastTop ?? '[]')) return 'unchanged';
    if (!config.discordWebhookUrl) return 'disabled';
    try {
      await post(config.discordWebhookUrl, buildPayload(top, config.publicUrl));
    } catch (err) {
      console.warn(`Discord-Versand fehlgeschlagen: ${err.message}`);
      store.writeState(STATE, {
        ...state,
        lastError: { at: new Date().toISOString(), message: err.message },
      });
      return 'error';
    }
    store.writeState(STATE, {
      ...state,
      lastTop: current,
      lastSentAt: new Date().toISOString(),
      lastError: null,
    });
    return 'sent';
  });
}

/** Meldet eine neue Anfrage. Ergebnis: 'disabled', 'sent' oder 'error'. */
async function notifyNewRequest(store, config, job, { post = postWebhook } = {}) {
  const webhook = config.discordRequestsWebhookUrl || config.discordWebhookUrl;
  if (!webhook) return 'disabled';
  const payload = buildRequestPayload(job, {
    publicUrl: config.publicUrl,
    pingUserId: config.discordPingUserId,
    pendingCount: jobs.pending(store.readData()).length,
  });
  try {
    await post(webhook, payload);
    return 'sent';
  } catch (err) {
    await rememberError(store, err);
    return 'error';
  }
}

function status(store, config) {
  const state = store.readState(STATE);
  return {
    configured: Boolean(config.discordWebhookUrl),
    separateRequestsChannel: Boolean(config.discordRequestsWebhookUrl),
    pingsUser: /^\d{15,25}$/.test(config.discordPingUserId || ''),
    hasPublicUrl: Boolean(config.publicUrl),
    topN: config.discordTopN,
    lastSentAt: state.lastSentAt || null,
    error: state.lastError || null,
  };
}

module.exports = {
  snapshot, buildPayload, buildRequestPayload, postWebhook, sync, notifyNewRequest, status,
};
