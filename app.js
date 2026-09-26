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
createApp(config).listen(port, () => {
  console.log(`3D-Druck-Warteschlange läuft auf Port ${port}`);
});
