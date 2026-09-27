'use strict';

// Startdatei – in Plesk als „Anwendungsstartdatei“ eintragen.

const { loadConfig } = require('./src/config');
const { createApp } = require('./src/server');

const config = loadConfig();
if (!config.adminPassword) {
  console.warn('ADMIN_PASSWORD ist nicht gesetzt – der Admin-Login ist deaktiviert.');
}
if (!config.discordWebhookUrl) {
  console.warn('DISCORD_WEBHOOK_URL ist nicht gesetzt – es wird nichts an Discord geschickt.');
}

const port = process.env.PORT || 3000;
const app = createApp(config);
app.listen(port, () => {
  console.log(`3D-Druck-Warteschlange läuft auf Port ${port}`);
});

// Gleich beim Start prüfen, ob der Speicher bereit ist (legt bei Bedarf die Tabellen an).
const { store } = app.locals;
store.ready()
  .then(() => console.log(store.kind === 'mariadb'
    ? `Datenbank bereit: ${config.db.database} (Tabellen ${store.tables.jobs}, ${store.tables.state})`
    : `Speicher: Dateien in ${config.dataDir}`))
  .catch((err) => console.error(`Datenbank nicht erreichbar (${err.code || err.message}):`,
    require('./src/storage').databaseHint(err)));
