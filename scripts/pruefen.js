'use strict';

// npm run pruefen
//
// Prüft Einstellungen, Datenbank, Discord und Konten und sagt verständlich,
// was fehlt. Zeigt keine Passwörter an.

const fs = require('fs');
const path = require('path');

const { loadConfig } = require('../src/config');
const { createStorage, databaseHint } = require('../src/storage');

const ROOT = path.resolve(__dirname, '..');
const ok = (text) => console.log(`  ✅ ${text}`);
const warn = (text) => console.log(`  ⚠️  ${text}`);
const bad = (text) => console.log(`  ❌ ${text}`);

async function checkDiscord(url) {
  // Nur lesen (GET): Discord verrät Name und Kanal des Webhooks, es wird nichts gepostet.
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const hook = await response.json();
      ok(`Discord-Webhook gültig: „${hook.name}“`);
      return true;
    }
    bad(`Discord-Webhook ungültig (Discord antwortet ${response.status}) – in Discord neu anlegen und URL neu eintragen.`);
  } catch (err) {
    warn(`Discord nicht erreichbar (${err.message}).`);
  }
  return false;
}

async function main() {
  let problems = 0;
  console.log('🔍 3D-Druck-Warteschlange – Prüfung\n');

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) ok(`Node.js ${process.versions.node}`);
  else { bad(`Node.js ${process.versions.node} ist zu alt – in Plesk Version 18 oder neuer wählen.`); problems++; }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.aktualisierung.json'), 'utf8'));
  } catch {
    // noch nie per npm run aktualisieren eingespielt
  }
  if (manifest) ok(`App-Version ${String(manifest.commit).slice(0, 7)} vom ${new Date(manifest.updatedAt).toLocaleString('de-DE')}`);

  const config = loadConfig();
  console.log('\nEinstellungen:');
  if (config.db) {
    ok(`Datenbank: ${config.db.database} auf ${config.db.socketPath || `${config.db.host}:${config.db.port}`}, `
      + `Benutzer ${config.db.user}, Passwort ${config.db.password ? 'gesetzt' : 'LEER'}`);
  } else {
    warn('Keine Datenbank eingestellt (DB_NAME/DB_USER fehlen) – die App speichert in Dateien im Ordner data/.');
  }
  if (config.discordWebhookUrl) {
    if (!(await checkDiscord(config.discordWebhookUrl))) problems++;
  } else {
    warn('DISCORD_WEBHOOK_URL fehlt – es gehen keine Discord-Nachrichten raus.');
  }
  if (config.discordRequestsWebhookUrl && !(await checkDiscord(config.discordRequestsWebhookUrl))) problems++;
  if (config.publicUrl) ok(`PUBLIC_URL: ${config.publicUrl}`);
  else warn('PUBLIC_URL fehlt – in Discord gibt es dann keinen Direktlink zur Freigabe.');

  try {
    fs.accessSync(config.dataDir, fs.constants.W_OK);
    ok(`Datenordner beschreibbar: ${config.dataDir}`);
  } catch {
    bad(`Datenordner nicht beschreibbar: ${config.dataDir}`);
    problems++;
  }

  console.log(`\nSpeicher (${config.db ? 'Datenbank' : 'Dateien'}):`);
  const store = createStorage(config);
  try {
    await store.ready();
    ok(config.db ? `Verbindung klappt, Tabellen: ${Object.values(store.tables).join(', ')}` : 'Dateien lesbar');

    const data = await store.readData();
    const count = (status) => data.jobs.filter((job) => job.status === status).length;
    ok(`Aufträge: ${count('pending')} warten auf Freigabe, ${count('queued')} in der Warteschlange, `
      + `${count('done')} gedruckt, ${count('rejected')} abgelehnt`);

    const users = await store.listUsers();
    if (users.length) {
      ok(`Konten: ${users.map((user) => `${user.username} (${user.displayName})`).join(', ')}`);
    } else if (config.adminPassword) {
      warn('Noch kein Konto – öffne /admin/einrichten und nimm ADMIN_PASSWORD als Einrichtungs-Code '
        + '(oder: npm run passwort <benutzername>).');
    } else {
      warn('Noch kein Konto und kein ADMIN_PASSWORD – lege eins an mit: npm run passwort <benutzername>');
    }
  } catch (err) {
    bad(`${databaseHint(err)} (${err.code || err.message})`);
    problems++;
  } finally {
    await store.close();
  }

  console.log('');
  if (!process.env.DB_NAME && !process.env.DB_USER && !fs.existsSync(path.join(ROOT, '.env'))) {
    console.log('Hinweis: Falls du die Einstellungen in Plesk eingetragen hast und sie hier trotzdem fehlen,');
    console.log('gibt Plesk sie npm-Befehlen nicht mit. Dann trag sie zusätzlich mit dem npm-Befehl');
    console.log('„einstellen“ ein, z. B.:  einstellen DB_NAME=… DB_USER=… DB_PASSWORD=…\n');
  }
  console.log(problems ? `❌ ${problems} Problem(e) gefunden – siehe oben.` : '✅ Alles in Ordnung.');
  process.exitCode = problems ? 1 : 0;
}

main().catch((err) => {
  console.error(`❌ Prüfung abgebrochen: ${err.message}`);
  process.exit(1);
});
