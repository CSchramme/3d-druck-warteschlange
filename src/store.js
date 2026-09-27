'use strict';

// Datei-Speicher: alles in JSON-Dateien im Datenordner. Wird genutzt, wenn keine
// Datenbank eingestellt ist (und in den schnellen Tests). Gleiche Schnittstelle
// wie der MariaDB-Speicher in store-mariadb.js.
// Plesk (Passenger) startet bei Bedarf mehrere Prozesse; ein Sperrordner sorgt
// dafür, dass immer nur einer gleichzeitig schreibt.

const fs = require('fs');
const path = require('path');

const STALE_LOCK_MS = 30_000;
const LOCK_TIMEOUT_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createFileStore(dataDir) {
  function file(name) {
    return path.join(dataDir, `${name}.json`);
  }

  function read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file(name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback();
      throw err;
    }
  }

  function write(name, value) {
    // Erst in eine temporäre Datei schreiben und dann umbenennen: So liest
    // nie jemand eine halb geschriebene Datei.
    const tmp = `${file(name)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file(name));
  }

  async function withLock(name, fn) {
    const lockDir = path.join(dataDir, `${name}.lock`);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        fs.mkdirSync(lockDir);
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try {
          if (Date.now() - fs.statSync(lockDir).mtimeMs > STALE_LOCK_MS) {
            fs.rmdirSync(lockDir); // übrig geblieben nach einem Absturz
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > deadline) throw new Error(`Sperre ${name} ist dauerhaft belegt`);
        await sleep(20);
      }
    }
    try {
      return await fn();
    } finally {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  }

  const emptyData = () => ({ nextId: 1, jobs: [] });
  const emptyUsers = () => ({ nextId: 1, users: [] });
  const MAX_LOG = 2000;

  function changeUsers(fn) {
    return withLock('nutzer', () => {
      const data = read('nutzer', emptyUsers);
      const result = fn(data);
      write('nutzer', data);
      return result;
    });
  }

  return {
    kind: 'datei',
    async ready() {},

    /** Aktueller Stand aller Aufträge (nur lesen). */
    readData: async () => read('auftraege', emptyData),

    /** Ändert die Aufträge unter Sperre; fn bekommt die Daten und darf sie verändern. */
    updateData: (fn) =>
      withLock('auftraege', () => {
        const data = read('auftraege', emptyData);
        const result = fn(data);
        write('auftraege', data);
        return result;
      }),

    readState: async (name) => read(name, () => ({})),
    writeState: async (name, value) => write(name, value),
    withLock,

    // --- Konten ---
    countUsers: async () => read('nutzer', emptyUsers).users.length,
    listUsers: async () => read('nutzer', emptyUsers).users,
    getUser: async (id) => read('nutzer', emptyUsers).users.find((u) => u.id === id) || null,
    findUser: async (username) => read('nutzer', emptyUsers).users.find((u) => u.username === username) || null,

    /** Legt ein Konto an. onlyIfNone: nur, wenn es noch gar keins gibt (Ersteinrichtung). */
    createUser: ({ username, displayName, passwordHash }, { onlyIfNone = false } = {}) => changeUsers((data) => {
      if (onlyIfNone && data.users.length) throw Object.assign(new Error('Es gibt schon ein Konto.'), { code: 'NOT_FIRST' });
      if (data.users.some((u) => u.username === username)) {
        throw Object.assign(new Error('Benutzername vergeben.'), { code: 'USERNAME_TAKEN' });
      }
      const user = {
        id: data.nextId++, username, displayName, passwordHash, sessionVersion: 1,
        failedLogins: 0, lockedUntil: null, createdAt: new Date().toISOString(), lastLoginAt: null,
      };
      data.users.push(user);
      return user;
    }),

    updateUser: (id, fields) => changeUsers((data) => {
      const user = data.users.find((u) => u.id === id);
      if (user) Object.assign(user, fields);
      return user || null;
    }),

    deleteUser: (id) => changeUsers((data) => {
      data.users = data.users.filter((u) => u.id !== id);
    }),

    // --- Verlauf ---
    addLog: (entry) => withLock('verlauf', () => {
      const log = read('verlauf', () => ({ nextId: 1, entries: [] }));
      log.entries.push({ id: log.nextId++, createdAt: new Date().toISOString(), ...entry });
      log.entries = log.entries.slice(-MAX_LOG);
      write('verlauf', log);
    }),
    listLog: async (limit = 300) => read('verlauf', () => ({ entries: [] })).entries.slice(-limit).reverse(),

    async close() {},
  };
}

module.exports = { createFileStore };
