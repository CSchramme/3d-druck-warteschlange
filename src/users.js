'use strict';

// Benutzerkonten für den Admin-Bereich: Passwörter sicher speichern (scrypt,
// in Node eingebaut) und Eingaben prüfen.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 5;

/** Passwort -> „scrypt$N$r$p$salz$hash“ (Salz und Hash als base64). */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  try {
    const actual = await scrypt(String(password || ''), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false; // kaputter Eintrag
  }
}

/** Zum Vergleichen, wenn es den Benutzer gar nicht gibt – damit das gleich lange dauert. */
const DUMMY_HASH = ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
  Buffer.alloc(16).toString('base64'), Buffer.alloc(SCRYPT.keylen).toString('base64')].join('$');

const normalizeUsername = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/** Prüft Formular für neues Konto bzw. neues Passwort. Gibt { values, errors } zurück. */
function parseUserForm(body, { needUsername = true, needName = true } = {}) {
  const errors = [];
  const values = {};
  const text = (name) => (typeof body[name] === 'string' ? body[name].trim() : '');

  if (needUsername) {
    values.username = normalizeUsername(body.username);
    if (!/^[a-z0-9._-]{3,40}$/.test(values.username)) {
      errors.push('Der Benutzername braucht 3–40 Zeichen: Buchstaben a–z, Ziffern, Punkt, Minus oder Unterstrich.');
    }
  }
  if (needName) {
    values.displayName = text('display_name').slice(0, 60) || values.username || '';
    if (!values.displayName) errors.push('Bitte gib einen Namen an.');
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) errors.push('Das Passwort muss mindestens 8 Zeichen lang sein.');
  if (password.length > 200) errors.push('Das Passwort ist zu lang.');
  if (password !== body.password_repeat) errors.push('Die beiden Passwörter stimmen nicht überein.');
  values.password = password;
  return { values, errors };
}

function isLocked(user, now = Date.now()) {
  return Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > now);
}

/** Felder nach einem fehlgeschlagenen Login (sperrt nach mehreren Versuchen kurz). */
function failedLoginUpdate(user) {
  const failedLogins = (user.failedLogins || 0) + 1;
  if (failedLogins < MAX_FAILED_LOGINS) return { failedLogins };
  return { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() };
}

/** Was an einem Konto öffentlich angezeigt werden darf (ohne Passwort-Hash). */
const publicUser = (user) => user && {
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
};

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, normalizeUsername, parseUserForm,
  isLocked, failedLoginUpdate, publicUser, LOCK_MINUTES,
};
