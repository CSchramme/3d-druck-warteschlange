'use strict';

// Speichert alles in JSON-Dateien im Datenordner – keine Datenbank nötig.
// Plesk (Passenger) startet bei Bedarf mehrere Prozesse; ein Sperrordner sorgt
// dafür, dass immer nur einer gleichzeitig schreibt.

const fs = require('fs');
const path = require('path');

const STALE_LOCK_MS = 30_000;
const LOCK_TIMEOUT_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createStore(dataDir) {
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
    /** Aktueller Stand aller Aufträge (nur lesen). */
    readData: () => read('auftraege', emptyData),

    /** Ändert die Aufträge unter Sperre; fn bekommt die Daten und darf sie verändern. */
    updateData: (fn) =>
      withLock('auftraege', () => {
        const data = read('auftraege', emptyData);
        const result = fn(data);
        write('auftraege', data);
        return result;
      }),

    readState: (name) => read(name, () => ({})),
    writeState: (name, value) => write(name, value),
    withLock,
  };
}

module.exports = { createStore };
