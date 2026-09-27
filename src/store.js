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
    async close() {},
  };
}

module.exports = { createFileStore };
