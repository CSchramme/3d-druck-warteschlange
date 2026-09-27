'use strict';

// Kleiner Discord-Client für den Bot: nur einzelne Web-Anfragen, keine
// Dauerverbindung. Das passt zu Plesk, wo die App bei Leerlauf schlafen gelegt
// wird – der Bot erscheint deshalb in der Mitgliederliste als „offline“,
// schreibt und bearbeitet seine Nachrichten aber ganz normal.

const API = 'https://discord.com/api/v10';
const USER_AGENT = 'DiscordBot (https://github.com/cschramme/3d-druck-warteschlange, 1.0)';

// Kanal sehen, Nachrichten senden, Links einbetten, Verlauf lesen, externe Emojis verwenden.
const PERMISSIONS = 1024 + 2048 + 16384 + 65536 + 262144;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class DiscordError extends Error {
  constructor(status, body, method, path) {
    const detail = body && typeof body === 'object'
      ? `${body.message || ''}${body.errors ? ` ${JSON.stringify(body.errors).slice(0, 300)}` : ''}`
      : String(body || '').slice(0, 300);
    super(`Discord antwortete mit ${status}${body && body.code ? ` (Code ${body.code})` : ''}: ${detail.trim()}`);
    this.name = 'DiscordError';
    this.status = status;
    this.code = body && typeof body === 'object' ? body.code : undefined;
    this.method = method;
    this.path = path;
  }
}

/** Die Anwendungs-ID steckt im ersten Teil des Bot-Tokens. */
function applicationIdFromToken(token) {
  const id = Buffer.from(String(token || '').split('.')[0], 'base64').toString('utf8');
  return /^\d{15,25}$/.test(id) ? id : null;
}

function inviteUrl(applicationId) {
  return applicationId
    ? `https://discord.com/oauth2/authorize?client_id=${applicationId}&permissions=${PERMISSIONS}&integration_type=0&scope=bot`
    : null;
}

/** Discord-Fehler in verständlichem Deutsch. */
function explainError(err, applicationId) {
  if (!(err instanceof DiscordError)) return err.message;
  const invite = inviteUrl(applicationId);
  if (err.status === 401) {
    return 'Der Bot-Token stimmt nicht. Im Discord Developer Portal unter „Bot“ → „Reset Token“ einen neuen '
      + 'erzeugen und mit „einstellen DISCORD_BOT_TOKEN=…“ eintragen.';
  }
  if (err.code === 50001) {
    return `Der Bot kommt nicht an den Kanal – ist er schon in deinem Server?${invite ? ` Einladen: ${invite}` : ''}`;
  }
  if (err.code === 50013) {
    return 'Dem Bot fehlen in diesem Kanal Rechte: „Nachrichten senden“ und „Links einbetten“ erlauben.';
  }
  if (err.code === 10003) return 'Den Discord-Kanal gibt es nicht – DISCORD_CHANNEL_ID prüfen.';
  if (err.code === 10015) return 'Den Discord-Webhook gibt es nicht mehr – DISCORD_WEBHOOK_URL prüfen.';
  return err.message;
}

/**
 * request(method, pfad, body?, { auth }) → Antwort als Objekt (oder null).
 * Bei „zu viele Anfragen“ (429) wird einmal kurz gewartet und wiederholt.
 */
function createDiscordApi(token, { fetchImpl = fetch, maxWaitMs = 5000 } = {}) {
  async function request(method, path, body, { auth = true, retry = true } = {}) {
    const headers = { 'User-Agent': USER_AGENT };
    if (auth) headers.Authorization = `Bot ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 204) return null;
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // kein JSON – steht dann im Fehlertext
    }
    if (response.status === 429 && retry) {
      const waitMs = Math.ceil(((json && json.retry_after) || 1) * 1000);
      if (waitMs <= maxWaitMs) {
        await sleep(waitMs);
        return request(method, path, body, { auth, retry: false });
      }
    }
    if (!response.ok) throw new DiscordError(response.status, json || text, method, path);
    return json;
  }

  return { request, applicationId: applicationIdFromToken(token) };
}

module.exports = {
  API, PERMISSIONS, DiscordError, applicationIdFromToken, inviteUrl, explainError, createDiscordApi,
};
