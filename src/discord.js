'use strict';

// Meldet die obersten Aufträge der Warteschlange per Webhook an Discord –
// aber nur, wenn sich an ihnen tatsächlich etwas geändert hat.

const jobs = require('./jobs');
const { isMakerworld } = require('./makerworld');

const STATE = 'discord';
const EMBED_COLOR = 0x00ae42; // Bambu-Grün
const SNAPSHOT_FIELDS = [
  'id', 'title', 'requester', 'makerworldUrl', 'imageUrl', 'quantity', 'color', 'notes', 'adminNote',
];

function snapshot(top) {
  return JSON.stringify(top.map((job) => SNAPSHOT_FIELDS.map((field) => job[field] ?? null)));
}

const esc = (text) => String(text || '').replace(/([\\*_~|`>[\]])/g, '\\$1');
const cut = (text, limit) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`);

function buildPayload(top, publicUrl = '') {
  let content;
  if (top.length === 0) content = '✅ **Die Druck-Warteschlange ist leer.**';
  else if (top.length === 1) content = '🖨️ **Der nächste Druckauftrag**';
  else content = `🖨️ **Die nächsten ${top.length} Druckaufträge**`;
  if (publicUrl) content += `\n<${publicUrl}/admin>`;

  const embeds = top.map((job, index) => {
    const details = [`👤 ${esc(job.requester)}`];
    if (job.quantity > 1) details.push(`🔢 ${job.quantity}×`);
    if (job.color) details.push(`🎨 ${esc(job.color)}`);
    const lines = [details.join(' · ')];

    const url = job.makerworldUrl;
    if (url && isMakerworld(url)) lines.push(`🔗 [Auf MakerWorld öffnen](${url})`);
    else if (url) lines.push(`🔗 [Link zum Modell](${url})`);
    else lines.push('⚠️ **Kein MakerWorld-Link** – Modell selbst besorgen/erstellen');
    if (job.notes) lines.push(`📝 ${esc(cut(job.notes, 500))}`);
    if (job.adminNote) lines.push(`🛠️ ${esc(cut(job.adminNote, 300))}`);

    const embed = {
      title: cut(`${index + 1}. ${job.title}`, 256),
      description: lines.join('\n'),
      color: EMBED_COLOR,
    };
    if (url) embed.url = url;
    if (job.imageUrl) embed.thumbnail = { url: job.imageUrl };
    return embed;
  });

  // Keine @everyone/@here/Rollen-Pings aus Namen oder Notizen zulassen.
  return { content, embeds, allowed_mentions: { parse: [] } };
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
    store.writeState(STATE, { lastTop: current, lastSentAt: new Date().toISOString(), lastError: null });
    return 'sent';
  });
}

function status(store, config) {
  const state = store.readState(STATE);
  return {
    configured: Boolean(config.discordWebhookUrl),
    topN: config.discordTopN,
    lastSentAt: state.lastSentAt || null,
    error: state.lastError || null,
  };
}

module.exports = { snapshot, buildPayload, postWebhook, sync, status };
