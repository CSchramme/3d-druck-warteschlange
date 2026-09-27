'use strict';

// Startdatei – in Plesk als „Anwendungsstartdatei“ eintragen.

const { loadConfig } = require('./src/config');
const discord = require('./src/discord');
const { createApp } = require('./src/server');

const config = loadConfig();
if (config.discordBotToken) {
  console.log('Discord: Bot – Nachrichten werden bearbeitet statt neu geschickt.');
} else if (!config.discordWebhookUrl) {
  console.warn('Weder DISCORD_BOT_TOKEN noch DISCORD_WEBHOOK_URL gesetzt – es wird nichts an Discord geschickt.');
}

const port = process.env.PORT || 3000;
const app = createApp(config);
app.listen(port, () => {
  console.log(`3D-Druck-Warteschlange läuft auf Port ${port}`);
});

// Gleich beim Start prüfen, ob der Speicher bereit ist (legt bei Bedarf die Tabellen an).
const { store } = app.locals;
store.ready()
  .then(async () => {
    console.log(store.kind === 'mariadb'
      ? `Datenbank bereit: ${config.db.database} (Tabellen ${Object.values(store.tables).join(', ')})`
      : `Speicher: Dateien in ${config.dataDir}`);
    // Mit Bot: eigene Symbole hochladen und die Warteschlangen-Nachricht anlegen/auffrischen.
    discord.startup(store, config).catch((err) => console.warn(`Discord beim Start: ${err.message}`));
    if (!(await store.countUsers())) {
      console.log(config.adminPassword
        ? 'Noch kein Konto: Öffne /admin/einrichten und nimm ADMIN_PASSWORD als Einrichtungs-Code.'
        : 'Noch kein Konto: Setze ADMIN_PASSWORD (Einrichtungs-Code) und öffne dann /admin/einrichten.');
    }
  })
  .catch((err) => console.error(`Datenbank nicht erreichbar (${err.code || err.message}):`,
    require('./src/storage').databaseHint(err)));
