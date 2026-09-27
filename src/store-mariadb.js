'use strict';

// MariaDB-/MySQL-Speicher. Tabellen (legt die App beim ersten Start selbst an,
// in phpMyAdmin kannst du alles ansehen):
//   druck_auftraege – alle Aufträge: offen, freigegeben, gedruckt, abgelehnt
//   druck_nutzer    – Konten für den Admin-Bereich (Passwörter nur als Hash)
//   druck_verlauf   – wer hat wann was gemacht
//   druck_zustand   – interne Merker (z. B. was zuletzt an Discord ging)
//
// Gleiche Schnittstelle wie der Datei-Speicher (store.js): Die Warteschlangen-
// Logik in jobs.js bekommt { nextId, jobs } und verändert das Objekt; danach
// schreibt updateData() genau die geänderten Zeilen in einer Transaktion zurück.

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const LOCK_TIMEOUT_S = 15;

// Feld in der App -> Spalte in der Datenbank
const COLUMNS = {
  id: 'id',
  title: 'title',
  requester: 'requester',
  makerworldUrl: 'makerworld_url',
  imageUrl: 'image_url',
  quantity: 'quantity',
  color: 'color',
  notes: 'notes',
  adminNote: 'admin_note',
  status: 'status',
  position: 'position',
  createdAt: 'created_at',
  approvedAt: 'approved_at',
  finishedAt: 'finished_at',
};
const FIELDS = Object.keys(COLUMNS);
const DATE_FIELDS = new Set(['createdAt', 'approvedAt', 'finishedAt']);

// ISO-Zeit (immer UTC) <-> DATETIME(3) ohne Zeitzone, ebenfalls UTC.
const toDb = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').replace('Z', '') : null);
const fromDb = (value) => (value ? `${String(value).replace(' ', 'T')}Z` : null);

function schema(t) {
  return [
    `CREATE TABLE IF NOT EXISTS \`${t.jobs}\` (
      id INT UNSIGNED NOT NULL,
      title VARCHAR(255) NOT NULL,
      requester VARCHAR(100) NOT NULL,
      makerworld_url VARCHAR(600) NULL,
      image_url VARCHAR(600) NULL,
      quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      color VARCHAR(100) NULL,
      notes TEXT NULL,
      admin_note TEXT NULL,
      status ENUM('pending', 'queued', 'done', 'rejected') NOT NULL DEFAULT 'pending'
        COMMENT 'pending = wartet auf Freigabe, queued = Warteschlange, done = gedruckt, rejected = abgelehnt',
      position INT UNSIGNED NULL COMMENT 'Platz in der Warteschlange',
      created_at DATETIME(3) NOT NULL COMMENT 'UTC',
      approved_at DATETIME(3) NULL COMMENT 'UTC',
      finished_at DATETIME(3) NULL COMMENT 'UTC – gedruckt/abgelehnt am',
      PRIMARY KEY (id),
      KEY status_position (status, position),
      KEY status_finished (status, finished_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3D-Druck-Warteschlange: alle Aufträge'`,
    `CREATE TABLE IF NOT EXISTS \`${t.users}\` (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(40) NOT NULL,
      display_name VARCHAR(60) NOT NULL,
      password_hash VARCHAR(255) NOT NULL COMMENT 'scrypt – das Passwort selbst wird nie gespeichert',
      session_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'erhöhen = überall abmelden',
      failed_logins SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      locked_until DATETIME(3) NULL COMMENT 'UTC',
      created_at DATETIME(3) NOT NULL COMMENT 'UTC',
      last_login_at DATETIME(3) NULL COMMENT 'UTC',
      PRIMARY KEY (id),
      UNIQUE KEY username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3D-Druck-Warteschlange: Konten'`,
    `CREATE TABLE IF NOT EXISTS \`${t.log}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      created_at DATETIME(3) NOT NULL COMMENT 'UTC',
      user_id INT UNSIGNED NULL,
      user_name VARCHAR(100) NULL,
      action VARCHAR(40) NOT NULL,
      job_id INT UNSIGNED NULL,
      job_title VARCHAR(255) NULL,
      details VARCHAR(500) NULL,
      PRIMARY KEY (id),
      KEY created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3D-Druck-Warteschlange: Verlauf'`,
    `CREATE TABLE IF NOT EXISTS \`${t.state}\` (
      name VARCHAR(64) NOT NULL,
      value LONGTEXT NOT NULL,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3D-Druck-Warteschlange: interner Zustand'`,
  ];
}

const USER_COLUMNS = {
  id: 'id',
  username: 'username',
  displayName: 'display_name',
  passwordHash: 'password_hash',
  sessionVersion: 'session_version',
  failedLogins: 'failed_logins',
  lockedUntil: 'locked_until',
  createdAt: 'created_at',
  lastLoginAt: 'last_login_at',
};
const USER_DATES = new Set(['lockedUntil', 'createdAt', 'lastLoginAt']);

function rowToUser(row) {
  if (!row) return null;
  const user = {};
  for (const [field, column] of Object.entries(USER_COLUMNS)) {
    user[field] = USER_DATES.has(field) ? fromDb(row[column]) : row[column];
  }
  return user;
}

const rowToLog = (row) => ({
  id: Number(row.id),
  createdAt: fromDb(row.created_at),
  userId: row.user_id,
  userName: row.user_name,
  action: row.action,
  jobId: row.job_id,
  jobTitle: row.job_title,
  details: row.details,
});

function rowToJob(row) {
  const job = {};
  for (const field of FIELDS) {
    const value = row[COLUMNS[field]];
    job[field] = DATE_FIELDS.has(field) ? fromDb(value) : value ?? null;
  }
  return job;
}

function jobToRow(job) {
  return FIELDS.map((field) => (DATE_FIELDS.has(field) ? toDb(job[field]) : job[field] ?? null));
}

/**
 * db: { host, port, user, password, database, socketPath, tablePrefix }
 * importDir: Datenordner mit altem auftraege.json/discord.json, das beim ersten
 * Start einmalig übernommen wird.
 */
function createMariaDbStore(db, { importDir = null } = {}) {
  const prefix = db.tablePrefix || 'druck_';
  const t = {
    jobs: `${prefix}auftraege`, users: `${prefix}nutzer`, log: `${prefix}verlauf`, state: `${prefix}zustand`,
  };
  const pool = mysql.createPool({
    host: db.host,
    port: db.port,
    socketPath: db.socketPath || undefined,
    user: db.user,
    password: db.password,
    database: db.database,
    charset: 'utf8mb4_unicode_ci',
    dateStrings: true,
    timezone: 'Z',
    connectionLimit: 5,
    waitForConnections: true,
    enableKeepAlive: true,
  });

  // Sperren gelten serverweit – deshalb Datenbank und Präfix im Namen.
  const lockName = (name) => `druck:${db.database}:${prefix}:${name}`.slice(0, 64);

  async function withLock(name, fn) {
    const conn = await pool.getConnection();
    try {
      const [[{ ok }]] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [lockName(name), LOCK_TIMEOUT_S]);
      if (ok !== 1) throw new Error(`Datenbank-Sperre „${name}“ ist dauerhaft belegt`);
      try {
        return await fn(conn);
      } finally {
        await conn.query('SELECT RELEASE_LOCK(?)', [lockName(name)]);
      }
    } finally {
      conn.release();
    }
  }

  async function readStateWith(conn, name) {
    const [rows] = await conn.query(`SELECT value FROM \`${t.state}\` WHERE name = ?`, [name]);
    return rows.length ? JSON.parse(rows[0].value) : null;
  }

  async function writeStateWith(conn, name, value) {
    await conn.query(
      `INSERT INTO \`${t.state}\` (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [name, JSON.stringify(value)],
    );
  }

  async function load(conn) {
    const [rows] = await conn.query(`SELECT * FROM \`${t.jobs}\` ORDER BY id`);
    const jobs = rows.map(rowToJob);
    const maxId = jobs.reduce((max, job) => Math.max(max, job.id), 0);
    // nextId merken, damit gelöschte Nummern nicht neu vergeben werden.
    const storedNextId = Number(await readStateWith(conn, 'next_id')) || 1;
    return { nextId: Math.max(storedNextId, maxId + 1), jobs };
  }

  const insertSql = `INSERT INTO \`${t.jobs}\` (${FIELDS.map((f) => COLUMNS[f]).join(', ')})
    VALUES (${FIELDS.map(() => '?').join(', ')})`;
  const updateSql = `UPDATE \`${t.jobs}\` SET ${FIELDS.slice(1).map((f) => `${COLUMNS[f]} = ?`).join(', ')}
    WHERE id = ?`;

  /** Schreibt alle Änderungen zwischen „vorher“ und „nachher“ in einer Transaktion. */
  async function save(conn, before, data) {
    const old = new Map(before.jobs.map((job) => [job.id, JSON.stringify(job)]));
    await conn.beginTransaction();
    try {
      const seen = new Set();
      for (const job of data.jobs) {
        seen.add(job.id);
        const previous = old.get(job.id);
        if (previous === undefined) {
          await conn.query(insertSql, jobToRow(job));
        } else if (previous !== JSON.stringify(job)) {
          const [, ...values] = jobToRow(job);
          await conn.query(updateSql, [...values, job.id]);
        }
      }
      const removed = [...old.keys()].filter((id) => !seen.has(id));
      if (removed.length) await conn.query(`DELETE FROM \`${t.jobs}\` WHERE id IN (?)`, [removed]);
      if (data.nextId !== before.nextId) await writeStateWith(conn, 'next_id', data.nextId);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  }

  /** Einmalig: Daten aus dem alten Datei-Speicher übernehmen, wenn die Tabelle noch leer ist. */
  async function importOldFiles(conn) {
    if (!importDir) return;
    const jobsFile = path.join(importDir, 'auftraege.json');
    if (!fs.existsSync(jobsFile)) return;
    const [[{ count }]] = await conn.query(`SELECT COUNT(*) AS count FROM \`${t.jobs}\``);
    if (Number(count) > 0) return;

    const old = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    await save(conn, { nextId: 1, jobs: [] }, { nextId: old.nextId || 1, jobs: old.jobs || [] });
    const discordFile = path.join(importDir, 'discord.json');
    if (fs.existsSync(discordFile)) {
      await writeStateWith(conn, 'discord', JSON.parse(fs.readFileSync(discordFile, 'utf8')));
      fs.renameSync(discordFile, `${discordFile}.importiert`);
    }
    fs.renameSync(jobsFile, `${jobsFile}.importiert`);
    console.log(`${(old.jobs || []).length} Aufträge aus ${jobsFile} in die Datenbank übernommen.`);
  }

  async function getUser(id) {
    const [rows] = await pool.query(`SELECT * FROM \`${t.users}\` WHERE id = ?`, [id]);
    return rowToUser(rows[0]);
  }

  let readyPromise = null;

  /** Legt beim ersten Aufruf die Tabellen an und übernimmt alte Daten. Bei Fehlern wird
   *  es beim nächsten Aufruf erneut versucht. */
  function ready() {
    if (!readyPromise) {
      readyPromise = withLock('einrichten', async (conn) => {
        for (const statement of schema(t)) await conn.query(statement);
        await importOldFiles(conn);
      }).catch((err) => {
        readyPromise = null;
        throw err;
      });
    }
    return readyPromise;
  }

  const api = {

    async readData() {
      const conn = await pool.getConnection();
      try {
        return await load(conn);
      } finally {
        conn.release();
      }
    },

    updateData(fn) {
      return withLock('auftraege', async (conn) => {
        const before = await load(conn);
        const data = { nextId: before.nextId, jobs: before.jobs.map((job) => ({ ...job })) };
        const result = fn(data);
        await save(conn, before, data);
        return result;
      });
    },

    async readState(name) {
      return (await readStateWith(pool, name)) || {};
    },

    async writeState(name, value) {
      await writeStateWith(pool, name, value);
    },

    withLock: (name, fn) => withLock(name, () => fn()),

    // --- Konten ---
    async countUsers() {
      const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM \`${t.users}\``);
      return Number(count);
    },
    async listUsers() {
      const [rows] = await pool.query(`SELECT * FROM \`${t.users}\` ORDER BY display_name, username`);
      return rows.map(rowToUser);
    },
    getUser,
    async findUser(username) {
      const [rows] = await pool.query(`SELECT * FROM \`${t.users}\` WHERE username = ?`, [username]);
      return rowToUser(rows[0]);
    },

    /** Legt ein Konto an. onlyIfNone: nur, wenn es noch gar keins gibt (Ersteinrichtung). */
    createUser({ username, displayName, passwordHash }, { onlyIfNone = false } = {}) {
      return withLock('nutzer', async (conn) => {
        if (onlyIfNone) {
          const [[{ count }]] = await conn.query(`SELECT COUNT(*) AS count FROM \`${t.users}\``);
          if (Number(count) > 0) throw Object.assign(new Error('Es gibt schon ein Konto.'), { code: 'NOT_FIRST' });
        }
        try {
          const [result] = await conn.query(
            `INSERT INTO \`${t.users}\` (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)`,
            [username, displayName, passwordHash, toDb(new Date().toISOString())],
          );
          const [rows] = await conn.query(`SELECT * FROM \`${t.users}\` WHERE id = ?`, [result.insertId]);
          return rowToUser(rows[0]);
        } catch (err) {
          if (err.code === 'ER_DUP_ENTRY') throw Object.assign(new Error('Benutzername vergeben.'), { code: 'USERNAME_TAKEN' });
          throw err;
        }
      });
    },

    async updateUser(id, fields) {
      const entries = Object.entries(fields).filter(([field]) => field in USER_COLUMNS && field !== 'id');
      if (entries.length) {
        await pool.query(
          `UPDATE \`${t.users}\` SET ${entries.map(([field]) => `${USER_COLUMNS[field]} = ?`).join(', ')} WHERE id = ?`,
          [...entries.map(([field, value]) => (USER_DATES.has(field) ? toDb(value) : value)), id],
        );
      }
      return getUser(id);
    },

    async deleteUser(id) {
      await pool.query(`DELETE FROM \`${t.users}\` WHERE id = ?`, [id]);
    },

    // --- Verlauf ---
    async addLog({ userId = null, userName = null, action, jobId = null, jobTitle = null, details = null }) {
      await pool.query(
        `INSERT INTO \`${t.log}\` (created_at, user_id, user_name, action, job_id, job_title, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [toDb(new Date().toISOString()), userId, userName && userName.slice(0, 100), action, jobId,
          jobTitle && jobTitle.slice(0, 255), details && details.slice(0, 500)],
      );
    },
    async listLog(limit = 300) {
      const [rows] = await pool.query(`SELECT * FROM \`${t.log}\` ORDER BY id DESC LIMIT ?`, [limit]);
      return rows.map(rowToLog);
    },

    close: () => pool.end(),

    /** Nur für Tests: eigene Tabellen wieder entfernen. */
    async dropTables() {
      await pool.query(`DROP TABLE IF EXISTS \`${t.jobs}\`, \`${t.users}\`, \`${t.log}\`, \`${t.state}\``);
    },
  };

  // Jede Methode stellt vorher sicher, dass die Tabellen existieren.
  const store = { kind: 'mariadb', tables: t, ready };
  for (const [name, method] of Object.entries(api)) {
    store[name] = name === 'close' || name === 'dropTables'
      ? method
      : async (...args) => {
        await ready();
        return method(...args);
      };
  }
  return store;
}

module.exports = { createMariaDbStore };
