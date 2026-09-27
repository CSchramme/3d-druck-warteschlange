'use strict';

// Höchstens N neue Anfragen pro Minute und Besucher. Gezählt wird im Speicher
// (Datei bzw. Datenbank) statt im Arbeitsspeicher – so gilt die Grenze auch,
// wenn Plesk mehrere Prozesse der App startet. Statt der IP-Adresse wird nur ein
// verschlüsselter Kurzwert gespeichert, und auch der nur eine Minute lang.

const crypto = require('crypto');
const os = require('os');

const STATE = 'anfragen_limit';
const WINDOW_MS = 60_000;

// Adressen des Servers selbst (Plesk: nginx → Apache → App laufen auf derselben Maschine).
const LOCAL_ADDRESSES = new Set(Object.values(os.networkInterfaces()).flat()
  .filter(Boolean).map((entry) => entry.address));

function isInternal(address) {
  const ip = address.replace(/^::ffff:/, '');
  return LOCAL_ADDRESSES.has(ip) || LOCAL_ADDRESSES.has(address)
    || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    || ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip);
}

/**
 * Adresse des Besuchers. Vor der App stehen bei Plesk nginx/Apache, die die
 * echte Adresse in X-Forwarded-For hinten anhängen. Von rechts gelesen ist die
 * erste Adresse, die nicht zum Server gehört, der Besucher – vorne selbst
 * eingetragene (gefälschte) Werte zählen damit nicht.
 */
function clientAddress(req) {
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  chain.push(req.socket.remoteAddress || '');
  return [...chain].reverse().find((address) => address && !isInternal(address)) || chain.find(Boolean) || 'unbekannt';
}

/** Kurzwert statt IP-Adresse. */
const keyFor = (address, secret) => crypto.createHmac('sha256', secret).update(`anfrage:${address}`).digest('base64url').slice(0, 16);

/**
 * Zählt eine Anfrage für key. Ergebnis: { ok: true } oder – wenn in der letzten
 * Minute schon limit Anfragen kamen – { ok: false, retryAfter: Sekunden }.
 */
function take(store, key, { limit, windowMs = WINDOW_MS, now = Date.now() } = {}) {
  return store.withLock(STATE, async () => {
    const state = await store.readState(STATE);
    const cutoff = now - windowMs;
    const hits = {};
    for (const [other, times] of Object.entries(state.hits || {})) {
      const recent = (Array.isArray(times) ? times : []).filter((time) => time > cutoff);
      if (recent.length) hits[other] = recent;
    }
    const mine = hits[key] || [];
    let result;
    if (mine.length >= limit) {
      result = { ok: false, retryAfter: Math.max(1, Math.ceil((mine[0] + windowMs - now) / 1000)) };
    } else {
      hits[key] = [...mine, now];
      result = { ok: true };
    }
    await store.writeState(STATE, { hits });
    return result;
  });
}

module.exports = { STATE, WINDOW_MS, isInternal, clientAddress, keyFor, take };
