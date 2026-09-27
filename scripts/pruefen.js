'use strict';

// npm run pruefen
//
// Prüft Einstellungen, Datenbank, Discord und Konten und sagt verständlich,
// was fehlt. Zeigt keine Passwörter an.

const fs = require('fs');
const path = require('path');

const { loadConfig } = require('../src/config');
const { createDiscordApi, explainError, inviteUrl } = require('../src/discord-api');
const discordBot = require('../src/discord-bot');
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

/**
 * Bot prüfen – nur lesen, es wird nichts gepostet. Nur die eigenen Symbole werden
 * (einmalig) hochgeladen, wenn store übergeben wird.
 */
async function checkBot(config, store) {
  const api = createDiscordApi(config.discordBotToken);
  const invite = inviteUrl(api.applicationId);
  let problems = 0;
  try {
    const me = await api.request('GET', '/users/@me');
    ok(`Discord-Bot angemeldet: „${me.username}“`);
    const guilds = await api.request('GET', '/users/@me/guilds');
    if (guilds.length) {
      ok(`Bot ist im Server: ${guilds.map((guild) => `„${guild.name}“`).join(', ')}`);
    } else {
      bad(`Der Bot ist noch in keinem Server. Einladen (Link im Browser öffnen): ${invite}`);
      return problems + 1;
    }

    const state = store ? await store.readState('discord') : {};
    const { board, requests } = await discordBot.channels(api, config, state);
    if (!board) {
      bad('Kein Kanal eingestellt. Nimm eine Kanal-ID von hier und trag sie ein mit: einstellen DISCORD_CHANNEL_ID=<ID>');
      for (const guild of guilds) {
        const list = await api.request('GET', `/guilds/${guild.id}/channels`).catch(() => []);
        list.filter((channel) => channel.type === 0 || channel.type === 5)
          .forEach((channel) => console.log(`       #${channel.name}  →  ${channel.id}`));
      }
      problems++;
    }
    for (const [label, id] of [['Warteschlange', board], ['Neue Anfragen', requests !== board ? requests : null]]) {
      if (!id) continue;
      try {
        const channel = await api.request('GET', `/channels/${id}`);
        ok(`${label}: Kanal #${channel.name}`);
      } catch (err) {
        bad(`${label}: ${explainError(err, api.applicationId)}`);
        problems++;
      }
    }

    if (store) {
      await discordBot.ensureEmojis(store, api, { budgetMs: 30_000, force: true });
      const emojis = await discordBot.emojiStatus(store, api);
      if (emojis.uploaded === emojis.total) ok(`Eigene Symbole: alle ${emojis.total} bereit`);
      else warn(`Eigene Symbole: ${emojis.uploaded} von ${emojis.total} bereit${emojis.error ? ` – ${emojis.error}` : ''}`);
    }
  } catch (err) {
    bad(explainError(err, api.applicationId));
    problems++;
  }
  return problems;
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
  if (config.discordBotToken) {
    ok('Discord: Bot (Prüfung weiter unten)');
  } else if (config.discordWebhookUrl) {
    if (!(await checkDiscord(config.discordWebhookUrl))) problems++;
    if (config.discordRequestsWebhookUrl && !(await checkDiscord(config.discordRequestsWebhookUrl))) problems++;
  } else {
    warn('Weder DISCORD_BOT_TOKEN noch DISCORD_WEBHOOK_URL – es gehen keine Discord-Nachrichten raus.');
  }
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

    if (config.discordBotToken) {
      console.log('\nDiscord-Bot:');
      problems += await checkBot(config, store);
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
