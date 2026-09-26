'use strict';

// Sitzung als signiertes Cookie: Es liegt nichts auf dem Server, deshalb
// funktioniert es auch, wenn Plesk mehrere Prozesse der App startet.

const crypto = require('crypto');

const COOKIE = 'druck_session';
const MAX_AGE_S = 365 * 24 * 60 * 60;

function parseCookies(header) {
  const cookies = {};
  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function decode(value, secret) {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function serialize(value, { secure, clear = false }) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${MAX_AGE_S}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function sessionMiddleware({ secret, secure }) {
  return (req, res, next) => {
    const existing = parseCookies(req.headers.cookie)[COOKIE];
    req.session = decode(existing, secret) || {};

    // Kurz bevor die Antwort rausgeht, das (evtl. geänderte) Cookie setzen.
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      if (Object.keys(req.session).length > 0) {
        const payload = Buffer.from(JSON.stringify(req.session)).toString('base64url');
        res.setHeader('Set-Cookie', serialize(`${payload}.${sign(payload, secret)}`, { secure }));
      } else if (existing) {
        res.setHeader('Set-Cookie', serialize('', { secure, clear: true }));
      }
      return writeHead.apply(this, args);
    };
    next();
  };
}

/** CSRF-Schutz: Jedes Formular schickt ein Token mit, das zur Sitzung passt. */
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}

function csrfValid(req) {
  const expected = Buffer.from(req.session.csrf || '');
  const given = Buffer.from(req.body && typeof req.body.csrf_token === 'string' ? req.body.csrf_token : '');
  return expected.length > 0 && expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function passwordMatches(given, expected) {
  // Hashen, damit der Vergleich immer gleich lang dauert.
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return Boolean(expected) && crypto.timingSafeEqual(a, b);
}

module.exports = { sessionMiddleware, csrfToken, csrfValid, passwordMatches };
