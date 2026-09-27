'use strict';

// Wählt den Speicher: MariaDB, wenn in den Einstellungen eine Datenbank steht,
// sonst die JSON-Dateien im Datenordner.

const { createFileStore } = require('./store');
const { createMariaDbStore } = require('./store-mariadb');

function createStorage(config) {
  if (config.db) return createMariaDbStore(config.db, { importDir: config.dataDir });
  return createFileStore(config.dataDir);
}

/** Verständlicher Hinweis, warum die Datenbank nicht erreichbar ist (ohne Passwörter). */
function databaseHint(err) {
  const hints = {
    ER_ACCESS_DENIED_ERROR: 'Benutzername oder Passwort der Datenbank stimmt nicht (DB_USER / DB_PASSWORD).',
    ER_DBACCESS_DENIED_ERROR: 'Der Datenbank-Benutzer darf nicht auf diese Datenbank zugreifen (DB_NAME prüfen).',
    ER_BAD_DB_ERROR: 'Diese Datenbank gibt es nicht (DB_NAME prüfen).',
    ECONNREFUSED: 'Der Datenbank-Server ist unter dieser Adresse nicht erreichbar (DB_HOST / DB_PORT prüfen).',
    ENOTFOUND: 'Den Datenbank-Server gibt es unter diesem Namen nicht (DB_HOST prüfen).',
    ETIMEDOUT: 'Der Datenbank-Server antwortet nicht (DB_HOST / DB_PORT prüfen).',
    ENOENT: 'Die Socket-Datei der Datenbank gibt es nicht (DB_SOCKET prüfen).',
    ER_TABLEACCESS_DENIED_ERROR: 'Der Datenbank-Benutzer darf keine Tabellen anlegen oder ändern.',
  };
  return hints[err && err.code] || 'Die Datenbank ist gerade nicht erreichbar.';
}

module.exports = { createStorage, databaseHint };
