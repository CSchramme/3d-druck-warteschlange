'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Liest eine .env-Datei (KEY=wert). Variablen, die schon gesetzt sind (z. B. in
// Plesk unter „Benutzerdefinierte Umgebungsvariablen“), haben Vorrang.
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

function envBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(value.trim().toLowerCase());
}

function loadSecretKey(dataDir, fromEnv) {
  if (fromEnv) return fromEnv;
  // Ohne SECRET_KEY einen zufälligen Schlüssel erzeugen und im Datenordner
  // merken, damit Logins einen Neustart überleben.
  const file = path.join(dataDir, 'secret_key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, key, { mode: 0o600 });
    return key;
  }
}

/** Datenbank-Zugang (MariaDB/MySQL) – nur wenn DB_NAME oder DB_USER gesetzt ist. */
function loadDbConfig(env) {
  if (!env.DB_NAME && !env.DB_USER) return null;
  const prefix = env.DB_TABLE_PREFIX ?? 'druck_';
  if (!/^[A-Za-z0-9_]{0,20}$/.test(prefix)) {
    throw new Error('DB_TABLE_PREFIX darf nur Buchstaben, Ziffern und _ enthalten.');
  }
  return {
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT, 10) || 3306,
    socketPath: env.DB_SOCKET || '',
    user: env.DB_USER || env.DB_NAME,
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || env.DB_USER,
    tablePrefix: prefix,
  };
}

function loadConfig(overrides = {}) {
  loadEnvFile(path.join(ROOT, '.env'));
  const env = process.env;

  const config = {
    dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
    adminPassword: env.ADMIN_PASSWORD || '',
    minFormSeconds: Number.isFinite(parseFloat(env.MIN_FORM_SECONDS)) ? parseFloat(env.MIN_FORM_SECONDS) : 2,
    maxPending: parseInt(env.MAX_PENDING, 10) || 50,
    loginDelayMs: 1000,
    discordWebhookUrl: (env.DISCORD_WEBHOOK_URL || '').trim(),
    discordRequestsWebhookUrl: (env.DISCORD_WEBHOOK_URL_ANFRAGEN || '').trim(),
    discordPingUserId: (env.DISCORD_PING_USER_ID || '').trim(),
    discordTopN: Math.min(Math.max(parseInt(env.DISCORD_TOP_N, 10) || 3, 1), 9),
    publicUrl: (env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
    timezone: env.TIMEZONE || 'Europe/Berlin',
    fetchMakerworldInfo: envBool(env.FETCH_MAKERWORLD_INFO, true),
    cookieSecure: envBool(env.COOKIE_SECURE, false),
    secretKey: env.SECRET_KEY || '',
    db: loadDbConfig(env),
    ...overrides,
  };

  fs.mkdirSync(config.dataDir, { recursive: true });
  config.secretKey = loadSecretKey(config.dataDir, config.secretKey);
  return config;
}

module.exports = { loadConfig };
