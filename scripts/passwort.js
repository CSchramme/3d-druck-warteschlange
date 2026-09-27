'use strict';

// npm run passwort <benutzername> [Name]
//
// Setzt für ein Konto ein neues, zufälliges Passwort (und hebt eine Sperre auf) –
// oder legt das Konto an, wenn es noch keins mit diesem Namen gibt. Praktisch,
// wenn du dich ausgesperrt hast. Das neue Passwort wird einmal angezeigt; ändere
// es nach dem Anmelden unter „Konten“.

const crypto = require('crypto');

const { loadConfig } = require('../src/config');
const { createStorage, databaseHint } = require('../src/storage');
const users = require('../src/users');

// ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomPassword() {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

async function main() {
  const username = users.normalizeUsername(process.argv[2]);
  const displayName = (process.argv.slice(3).join(' ').trim() || username).slice(0, 60);
  const store = createStorage(loadConfig());
  try {
    if (!username) {
      const list = await store.listUsers();
      console.log('Aufruf: npm run passwort <benutzername> [Name]');
      console.log(list.length
        ? `Vorhandene Konten: ${list.map((user) => user.username).join(', ')}`
        : 'Es gibt noch kein Konto – mit dem Aufruf oben legst du das erste an.');
      process.exitCode = 1;
      return;
    }
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      throw new Error('Der Benutzername braucht 3–40 Zeichen: Buchstaben a–z, Ziffern, Punkt, Minus oder Unterstrich.');
    }

    const password = randomPassword();
    const passwordHash = await users.hashPassword(password);
    const existing = await store.findUser(username);
    if (existing) {
      await store.updateUser(existing.id, {
        passwordHash, sessionVersion: existing.sessionVersion + 1, failedLogins: 0, lockedUntil: null,
      });
      await store.addLog({ userName: 'npm run passwort', action: 'passwort_geaendert', details: existing.displayName });
      console.log(`🔒 Neues Passwort für „${username}“ (${existing.displayName}):`);
    } else {
      await store.createUser({ username, displayName, passwordHash });
      await store.addLog({ userName: 'npm run passwort', action: 'nutzer_angelegt', details: `${displayName} (${username})` });
      console.log(`👤 Konto „${username}“ (${displayName}) angelegt. Passwort:`);
    }
    console.log(`\n    ${password}\n`);
    console.log('Melde dich damit an und ändere es danach unter „Konten“ in ein eigenes.');
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  console.error(`❌ ${err.code ? `${databaseHint(err)} (${err.code})` : err.message}`);
  process.exit(1);
});
