'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');

const discord = require('./discord');
const forms = require('./forms');
const jobs = require('./jobs');
const legal = require('./legal');
const pwa = require('./pwa');
const views = require('./views');
const { createStorage, databaseHint } = require('./storage');
const users = require('./users');
const { sessionMiddleware, csrfToken, csrfValid, passwordMatches } = require('./session');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const str = (value) => (typeof value === 'string' ? value.trim() : '');

/** Rücksprung-Adresse aus einem Formular – nur interne Admin-Seiten erlaubt. */
function safeBack(value, fallback) {
  return typeof value === 'string' && /^\/admin(\/archiv)?(\?[^\s#]*)?$/.test(value) ? value : fallback;
}

/** Rücksprung nach der Zustimmung – nur Pfade dieser Seite. */
function safeLocal(value) {
  return typeof value === 'string' && value.length <= 300 && /^\/(?![/\\])[^\s]*$/.test(value) ? value : '/';
}

/** Die Zustimmung zu AGB und Cookies bleibt auch beim An- und Abmelden erhalten. */
const keepConsent = (session) => (session.zustimmung ? { zustimmung: session.zustimmung } : {});

/** Führt fn für alle Elemente aus, höchstens limit gleichzeitig. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// aktion -> was passiert, welche Meldung, bei welchem Status erlaubt, Eintrag im Verlauf
const ACTIONS = {
  approve: { run: jobs.enqueue, message: '„%s“ ist freigegeben und steht jetzt auf Platz %p der Warteschlange.', allowed: ['pending'], log: 'freigegeben' },
  reject: { run: jobs.reject, message: '„%s“ wurde abgelehnt.', allowed: ['pending', 'queued'], log: 'abgelehnt' },
  done: { run: jobs.markDone, message: '„%s“ ist als gedruckt markiert.', allowed: ['queued'], log: 'gedruckt' },
  restore: { run: jobs.enqueue, message: '„%s“ steht wieder in der Warteschlange (Platz %p).', allowed: ['done', 'rejected'], log: 'zurueckgeholt' },
  unapprove: { run: jobs.backToPending, message: '„%s“ wartet wieder auf Freigabe.', allowed: ['queued'], log: 'freigabe_zurueck' },
  up: { run: (d, id) => jobs.move(d, id, 'up'), allowed: ['queued'] },
  down: { run: (d, id) => jobs.move(d, id, 'down'), allowed: ['queued'] },
  top: { run: (d, id) => jobs.move(d, id, 'top'), allowed: ['queued'] },
  bottom: { run: (d, id) => jobs.move(d, id, 'bottom'), allowed: ['queued'] },
  delete: { run: jobs.remove, message: '„%s“ wurde gelöscht.', allowed: ['pending', 'queued', 'done', 'rejected'], log: 'geloescht' },
};

/**
 * Baut die Express-App. deps.postWebhook ersetzt (für Tests) den echten
 * Discord-Versand, deps.store den Speicher.
 */
function createApp(config, deps = {}) {
  const store = deps.store || createStorage(config);
  const app = express();
  app.locals.store = store;
  app.disable('x-powered-by');

  const dateFormat = new Intl.DateTimeFormat('de-DE', {
    timeZone: config.timezone,
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const date = (iso) => (iso ? dateFormat.format(new Date(iso)) : '');
  const dayFormat = new Intl.DateTimeFormat('de-DE', {
    timeZone: config.timezone, day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const day = (iso) => (iso ? dayFormat.format(new Date(iso)) : '');
  const monthFormat = new Intl.DateTimeFormat('de-DE', { timeZone: config.timezone, month: 'long', year: 'numeric' });
  const isoDayFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  /** Datum für <input type="date">: 'JJJJ-MM-TT' in deiner Zeitzone. */
  const isoDay = (iso) => isoDayFormat.format(iso ? new Date(iso) : new Date());

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

  // Installierbare App: Service Worker und Offline-Seite – gehen auch, wenn die
  // Datenbank gerade nicht erreichbar ist.
  const version = pwa.assetVersion();
  const serviceWorker = pwa.serviceWorker(version);
  const offlineHtml = String(views.offlinePage());
  app.get('/sw.js', (req, res) => {
    res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.send(serviceWorker);
  });
  app.get(pwa.OFFLINE_URL, (req, res) => {
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.send(offlineHtml);
  });

  app.use(sessionMiddleware({ secret: config.secretKey, secure: config.cookieSecure }));

  // Hilfen für Meldungen und Seiten – vor dem Formular-Parser, damit auch
  // dessen Fehler (z. B. zu viel Text) sauber angezeigt werden können.
  app.use((req, res, next) => {
    req.flash = (type, message) => {
      req.session.flash = [...(req.session.flash || []), { type, message }];
    };
    res.page = (view, data = {}, status = 200) => {
      const flashes = req.session.flash || [];
      delete req.session.flash;
      const ctx = {
        csrf: csrfToken(req), isAdmin: Boolean(req.user), user: users.publicUser(req.user), flashes, date, day,
        path: req.path, url: req.originalUrl, pendingCount: req.pendingCount || 0, consent: req.consent || null,
      };
      res.status(status).type('html').send(String(views[view](ctx, data)));
    };
    next();
  });

  // Beim ersten Aufruf Tabellen anlegen bzw. prüfen, ob die Datenbank erreichbar ist.
  app.use(async (req, res, next) => {
    try {
      await store.ready();
    } catch (err) {
      console.error('Datenbank nicht erreichbar:', err.code || '', err.message);
      return res.page('errorPage', {
        status: 503,
        message: `${databaseHint(err)} Bitte die Einstellungen prüfen und die App neu starten.`,
      }, 503);
    }
    next();
  });

  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.use((req, res, next) => {
    if (req.method === 'POST' && !csrfValid(req)) {
      return res.page('errorPage', {
        status: 400,
        message: 'Das Formular ist abgelaufen – bitte lade die Seite neu und versuch es nochmal.',
      }, 400);
    }
    next();
  });

  // Angemeldetes Konto laden. Passt die Sitzungsversion nicht mehr (Passwort
  // geändert, Konto gelöscht), ist die Sitzung ungültig.
  app.use(async (req, res, next) => {
    req.user = null;
    const { uid, v } = req.session;
    if (uid) {
      const user = await store.getUser(uid);
      if (user && user.sessionVersion === v) req.user = user;
      else req.session = keepConsent(req.session);
    }
    // Zähler für die Navigation: wie viele Anfragen warten auf Freigabe?
    if (req.user && req.method === 'GET') req.pendingCount = jobs.pending(await store.readData()).length;
    // Hat diese Sitzung den aktuellen AGB und dem Cookie-Hinweis schon zugestimmt?
    if (req.method === 'GET') {
      req.legal = await legal.load(store);
      req.consent = legal.consentState(req.legal, req.session);
    }
    next();
  });

  function requireAdmin(req, res, next) {
    if (!req.user) return res.redirect(303, '/admin/login');
    next();
  }

  /** Eintrag im Verlauf – ein Fehler dabei darf die eigentliche Aktion nicht stören. */
  async function log(req, action, { job = null, details = null, userName = null } = {}) {
    try {
      await store.addLog({
        userId: req.user ? req.user.id : null,
        userName: userName || (req.user ? req.user.displayName : null),
        action,
        jobId: job ? job.id : null,
        jobTitle: job ? job.title : null,
        details,
      });
    } catch (err) {
      console.error('Verlauf konnte nicht gespeichert werden:', err.message);
    }
  }

  function logIn(req, user) {
    // Neue Sitzung, damit nichts aus der Zeit vor dem Login übrig bleibt.
    req.session = {
      uid: user.id, v: user.sessionVersion, name: req.session.name, csrf: req.session.csrf, zustimmung: req.session.zustimmung,
    };
    req.user = user;
  }

  // Schutz vor Spam auf der öffentlichen Seite: Das Formular trägt einen
  // signierten Zeitstempel; wer schneller abschickt, als ein Mensch tippen kann,
  // muss es nochmal versuchen.
  const stampSig = (time) => crypto.createHmac('sha256', config.secretKey).update(`formular:${time}`)
    .digest('base64url').slice(0, 22);
  function formStamp() {
    const time = String(Date.now());
    return `${time}.${stampSig(time)}`;
  }
  function formAge(stamp) {
    const [time, sig] = String(stamp || '').split('.');
    if (!time || !sig || sig !== stampSig(time)) return null;
    return (Date.now() - Number(time)) / 1000;
  }

  const discordDeps = { post: deps.postWebhook, api: deps.discordApi };

  async function syncDiscord(req, force = false) {
    const result = await discord.sync(store, config, { ...discordDeps, force });
    // Mit Bot wird die Nachricht still bearbeitet ('updated') – dazu keine Meldung.
    if (result === 'sent') {
      req.flash('info', config.discordBotToken ? 'Die Warteschlange steht jetzt neu in Discord.'
        : 'Die aktuellen Top-Aufträge wurden an Discord geschickt.');
    } else if (result === 'error') {
      req.flash('error', 'Discord-Versand fehlgeschlagen – Details stehen unten bei „Discord“.');
    } else if (force && result === 'disabled') {
      req.flash('error', 'Discord ist noch nicht eingerichtet (DISCORD_BOT_TOKEN oder DISCORD_WEBHOOK_URL fehlt).');
    }
  }

  // --- Öffentlich ---------------------------------------------------------------

  async function renderIndex(req, res, values, status = 200) {
    const data = await store.readData();
    res.page('index', {
      values: values || { requester: req.session.name || '', quantity: 1 },
      stamp: formStamp(),
      queue: jobs.queue(data),
      done: jobs.finished(data, 10).filter((job) => job.status === 'done'),
      topN: config.discordTopN,
    }, status);
  }

  app.get('/', (req, res) => renderIndex(req, res));

  app.get('/warteschlange', async (req, res) => {
    const data = await store.readData();
    res.page('publicQueue', {
      queue: jobs.queue(data),
      done: jobs.finished(data, 10).filter((job) => job.status === 'done'),
      topN: config.discordTopN,
    });
  });

  app.post('/auftrag', async (req, res) => {
    // Unsichtbares Feld: Bots füllen es aus, Menschen nicht.
    if (req.body.website) return res.redirect(303, '/');

    const { values, errors } = forms.parseJobForm(req.body);
    if (config.minFormSeconds > 0) {
      const age = formAge(req.body.ts);
      if (age === null || age < config.minFormSeconds) {
        errors.push('Das ging etwas schnell – bitte prüf kurz deine Angaben und schick sie nochmal ab.');
      }
    }
    req.legal = await legal.load(store);
    req.consent = legal.consentState(req.legal, req.session);
    if (req.consent.needed) {
      errors.push('Bitte stimm zuerst den AGB und dem Cookie-Hinweis zu – dann kannst du deinen Auftrag abschicken.');
    }
    if (!errors.length && jobs.pending(await store.readData()).length >= config.maxPending) {
      errors.push('Gerade warten schon sehr viele Anfragen auf Freigabe – bitte versuch es später nochmal.');
    }
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return renderIndex(req, res, values, 400);
    }
    await forms.completeFromMakerworld(values, config.fetchMakerworldInfo);
    const job = await store.updateData((data) => jobs.create(data, values));
    await log(req, 'anfrage', { job, userName: `${values.requester} (öffentlich)` });
    req.session.name = values.requester;
    req.flash('success', `Danke! Deine Anfrage „${job.title}“ ist angekommen. Sobald sie freigegeben ist, `
      + 'erscheint sie hier in der Warteschlange.');
    res.redirect(303, '/');

    // Dir per Discord Bescheid geben – im Hintergrund, damit niemand warten muss.
    const notified = discord.notifyNewRequest(store, config, job, discordDeps)
      .catch((err) => console.error('Discord-Meldung für neue Anfrage fehlgeschlagen:', err));
    if (deps.onBackgroundTask) deps.onBackgroundTask(notified);
  });

  // --- AGB, Datenschutz, Zustimmung ------------------------------------------------------

  app.get('/agb', (req, res) => {
    res.page('legalPage', { kind: 'agb', legal: req.legal, back: safeLocal(req.query.zurueck) });
  });

  app.get('/datenschutz', (req, res) => {
    res.page('legalPage', { kind: 'datenschutz', legal: req.legal, back: safeLocal(req.query.zurueck) });
  });

  app.post('/zustimmung', async (req, res) => {
    req.session.zustimmung = (await legal.load(store)).version;
    res.redirect(303, safeLocal(req.body.back));
  });

  app.get('/admin/rechtliches', requireAdmin, (req, res) => {
    res.page('adminLegal', { legal: req.legal });
  });

  app.post('/admin/rechtliches', requireAdmin, async (req, res) => {
    const renew = req.body.neu_zustimmen === 'ja';
    const saved = await legal.save(store, {
      agb: str(req.body.agb), datenschutz: str(req.body.datenschutz), renew, userName: req.user.displayName,
    });
    // Wer speichert, hat die neue Fassung ja gerade gelesen.
    req.session.zustimmung = saved.version;
    await log(req, 'rechtliches_geaendert', {
      details: renew ? `Version ${saved.version} – alle müssen neu zustimmen` : `Version ${saved.version} (ohne neue Zustimmung)`,
    });
    req.flash('success', renew
      ? 'Gespeichert. Alle werden beim nächsten Besuch gebeten, neu zuzustimmen.'
      : 'Gespeichert. Bisherige Zustimmungen gelten weiter.');
    res.redirect(303, '/admin/rechtliches');
  });

  // --- Anmelden, Ersteinrichtung, Konten ----------------------------------------------

  app.get('/admin/login', async (req, res) => {
    if (req.user) return res.redirect(303, '/admin');
    if (!(await store.countUsers())) return res.redirect(303, '/admin/einrichten');
    res.page('adminLogin', { username: '' });
  });

  app.post('/admin/login', async (req, res) => {
    const username = users.normalizeUsername(req.body.username).slice(0, 40);
    const user = username ? await store.findUser(username) : null;
    if (user && users.isLocked(user)) {
      req.flash('error', `Zu viele Fehlversuche – dieses Konto ist kurz gesperrt. Bitte in ${users.LOCK_MINUTES} Minuten nochmal.`);
      return res.page('adminLogin', { username }, 429);
    }
    const ok = await users.verifyPassword(req.body.password, user ? user.passwordHash : users.DUMMY_HASH);
    if (user && ok) {
      const fresh = await store.updateUser(user.id, {
        failedLogins: 0, lockedUntil: null, lastLoginAt: new Date().toISOString(),
      });
      logIn(req, fresh);
      await log(req, 'login');
      return res.redirect(303, '/admin');
    }
    if (user) {
      const update = users.failedLoginUpdate(user);
      await store.updateUser(user.id, update);
      await log(req, update.lockedUntil ? 'gesperrt' : 'login_fehlgeschlagen', { userName: user.displayName });
    }
    await sleep(config.loginDelayMs); // bremst Passwort-Raten aus
    req.flash('error', 'Benutzername oder Passwort stimmt nicht.');
    res.page('adminLogin', { username }, 401);
  });

  app.post('/admin/logout', (req, res) => {
    req.session = keepConsent(req.session);
    res.redirect(303, '/');
  });

  // Ersteinrichtung: Solange es kein Konto gibt, legt man hier das erste an. Als
  // Nachweis dient ADMIN_PASSWORD aus den Plesk-Einstellungen.
  app.get('/admin/einrichten', async (req, res) => {
    if (await store.countUsers()) return res.redirect(303, '/admin/login');
    res.page('adminSetup', { setupEnabled: Boolean(config.adminPassword), values: {} });
  });

  app.post('/admin/einrichten', async (req, res) => {
    if (await store.countUsers()) return res.redirect(303, '/admin/login');
    const { values, errors } = users.parseUserForm(req.body);
    if (!passwordMatches(req.body.setup_code, config.adminPassword)) {
      await sleep(config.loginDelayMs);
      errors.unshift('Der Einrichtungs-Code stimmt nicht – das ist dein ADMIN_PASSWORD aus den Plesk-Einstellungen.');
    }
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return res.page('adminSetup', { setupEnabled: Boolean(config.adminPassword), values }, 400);
    }
    let user;
    try {
      user = await store.createUser({
        username: values.username, displayName: values.displayName, passwordHash: await users.hashPassword(values.password),
      }, { onlyIfNone: true });
    } catch (err) {
      if (err.code === 'NOT_FIRST') return res.redirect(303, '/admin/login');
      throw err;
    }
    user = await store.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
    logIn(req, user);
    await log(req, 'eingerichtet');
    req.flash('success', `Willkommen, ${user.displayName}! Dein Konto ist angelegt. ADMIN_PASSWORD brauchst du `
      + 'jetzt nicht mehr – du kannst es in Plesk löschen.');
    res.redirect(303, '/admin');
  });

  async function renderUsers(req, res, extra = {}, status = 200) {
    res.page('adminUsers', {
      users: (await store.listUsers()).map(users.publicUser),
      me: users.publicUser(req.user),
      newValues: extra.newValues || {},
      openNew: Boolean(extra.newValues),
      legal: await legal.load(store),
    }, status);
  }

  app.get('/admin/nutzer', requireAdmin, (req, res) => renderUsers(req, res));

  app.post('/admin/nutzer/neu', requireAdmin, async (req, res) => {
    const { values, errors } = users.parseUserForm(req.body);
    if (!errors.length && await store.findUser(values.username)) errors.push('Diesen Benutzernamen gibt es schon.');
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return renderUsers(req, res, { newValues: values }, 400);
    }
    try {
      const user = await store.createUser({
        username: values.username, displayName: values.displayName, passwordHash: await users.hashPassword(values.password),
      });
      await log(req, 'nutzer_angelegt', { details: `${user.displayName} (${user.username})` });
      req.flash('success', `Konto für ${user.displayName} angelegt. Anmelden mit „${user.username}“.`);
    } catch (err) {
      if (err.code !== 'USERNAME_TAKEN') throw err;
      req.flash('error', 'Diesen Benutzernamen gibt es schon.');
      return renderUsers(req, res, { newValues: values }, 400);
    }
    res.redirect(303, '/admin/nutzer');
  });

  app.post('/admin/nutzer/:id/passwort', requireAdmin, async (req, res, next) => {
    const target = await store.getUser(Number(req.params.id));
    if (!target) return next();
    const self = target.id === req.user.id;
    const { values, errors } = users.parseUserForm(req.body, { needUsername: false, needName: false });
    if (self && !(await users.verifyPassword(req.body.current_password, req.user.passwordHash))) {
      errors.unshift('Dein bisheriges Passwort stimmt nicht.');
    }
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return renderUsers(req, res, {}, 400);
    }
    // Neue Sitzungsversion: Mit dem alten Passwort angemeldete Geräte fliegen raus.
    const updated = await store.updateUser(target.id, {
      passwordHash: await users.hashPassword(values.password),
      sessionVersion: target.sessionVersion + 1,
      failedLogins: 0,
      lockedUntil: null,
    });
    if (self) logIn(req, updated);
    await log(req, 'passwort_geaendert', { details: self ? 'eigenes Passwort' : updated.displayName });
    req.flash('success', self ? 'Dein Passwort ist geändert.' : `Neues Passwort für ${updated.displayName} gespeichert.`);
    res.redirect(303, '/admin/nutzer');
  });

  app.post('/admin/nutzer/:id/loeschen', requireAdmin, async (req, res, next) => {
    const target = await store.getUser(Number(req.params.id));
    if (!target) return next();
    if (target.id === req.user.id) {
      req.flash('error', 'Dein eigenes Konto kannst du nicht löschen.');
    } else {
      await store.deleteUser(target.id);
      await log(req, 'nutzer_geloescht', { details: `${target.displayName} (${target.username})` });
      req.flash('success', `Das Konto von ${target.displayName} ist gelöscht.`);
    }
    res.redirect(303, '/admin/nutzer');
  });

  app.get('/admin/verlauf', requireAdmin, async (req, res) => {
    res.page('adminLog', { entries: await store.listLog(300) });
  });

  // --- Admin ----------------------------------------------------------------------

  async function renderDashboard(req, res, newValues, status = 200) {
    const data = await store.readData();
    res.page('adminDashboard', {
      pending: jobs.pending(data),
      queue: jobs.queue(data),
      finished: jobs.finished(data),
      discord: await discord.status(store, config, discordDeps),
      topN: config.discordTopN,
      newValues: newValues || { requester: req.user.displayName, quantity: 1 },
      openNew: Boolean(newValues),
      legalMissingContact: legal.hasPlaceholder(await legal.load(store)),
    }, status);
  }

  app.get('/admin', requireAdmin, (req, res) => renderDashboard(req, res));

  app.post('/admin/auftrag/neu', requireAdmin, async (req, res) => {
    const { values, errors } = forms.parseJobForm(req.body, { admin: true });
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return renderDashboard(req, res, values, 400);
    }
    await forms.completeFromMakerworld(values, config.fetchMakerworldInfo);
    const job = await store.updateData((data) => {
      const created = jobs.create(data, values);
      jobs.enqueue(data, created.id);
      return created;
    });
    await log(req, 'eigener_auftrag', { job });
    req.flash('success', `„${job.title}“ steht jetzt hinten in der Warteschlange.`);
    await syncDiscord(req);
    res.redirect(303, `/admin#auftrag-${job.id}`);
  });

  app.get('/admin/auftrag/:id/bearbeiten', requireAdmin, async (req, res, next) => {
    const job = jobs.get(await store.readData(), Number(req.params.id));
    if (!job) return next();
    const back = safeBack(req.query.back, '/admin');
    res.page('adminEdit', { job, values: { ...job, printedAt: isoDay(job.finishedAt) }, back });
  });

  app.post('/admin/auftrag/:id/bearbeiten', requireAdmin, async (req, res, next) => {
    const id = Number(req.params.id);
    const job = jobs.get(await store.readData(), id);
    if (!job) return next();
    const back = safeBack(req.body.back, '/admin');
    const { values, errors } = forms.parseJobForm(req.body, { admin: true });
    if (job.status === 'done') {
      // Druckdatum nur übernehmen, wenn es wirklich geändert wurde (sonst bleibt die Uhrzeit erhalten).
      const printedAt = forms.parseDate(req.body.printed_at);
      if (!printedAt) errors.push('Bitte gib ein gültiges Druckdatum an.');
      else if (str(req.body.printed_at) !== isoDay(job.finishedAt)) values.finishedAt = printedAt;
    }
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return res.page('adminEdit', { job, values: { ...values, printedAt: str(req.body.printed_at) }, back }, 400);
    }
    const linkChanged = values.makerworldUrl !== job.makerworldUrl;
    if (linkChanged && values.imageUrl === job.imageUrl) values.imageUrl = null; // Bild gehörte zum alten Link
    if (linkChanged || !values.title) {
      await forms.completeFromMakerworld(values, config.fetchMakerworldInfo);
    }
    const updated = await store.updateData((data) => {
      if (!jobs.get(data, id)) return false;
      jobs.update(data, id, values);
      return true;
    });
    if (!updated) return next();
    await log(req, 'bearbeitet', { job: { id, title: values.title } });
    req.flash('success', 'Änderungen gespeichert.');
    await syncDiscord(req);
    res.redirect(303, `${back}#auftrag-${id}`);
  });

  app.post('/admin/auftrag/:id/nochmal', requireAdmin, async (req, res, next) => {
    const id = Number(req.params.id);
    const copy = await store.updateData((data) => {
      const job = jobs.get(data, id);
      return job && job.status === 'done' ? jobs.duplicate(data, id) : null;
    });
    if (!copy) return next();
    await log(req, 'nochmal', { job: copy });
    req.flash('success', `„${copy.title}“ steht als neuer Auftrag auf Platz ${copy.position} der Warteschlange.`);
    await syncDiscord(req);
    res.redirect(303, `${safeBack(req.body.back, '/admin/archiv')}#auftrag-${id}`);
  });

  app.post('/admin/auftrag/:id/:action', requireAdmin, async (req, res, next) => {
    const spec = ACTIONS[req.params.action];
    const id = Number(req.params.id);
    if (!spec) return next();
    const outcome = await store.updateData((data) => {
      const job = jobs.get(data, id);
      if (!job) return { missing: true };
      if (!spec.allowed.includes(job.status)) return { invalid: true };
      const title = job.title;
      spec.run(data, id);
      const after = jobs.get(data, id);
      return { title, position: after ? after.position : null };
    });
    if (spec.log && outcome.title) await log(req, spec.log, { job: { id, title: outcome.title } });
    if (outcome.missing) return next();
    if (outcome.invalid) {
      req.flash('error', 'Das geht bei diesem Auftrag gerade nicht.');
      return res.redirect(303, '/admin');
    }
    if (spec.message) {
      req.flash('success', spec.message.replace('%s', outcome.title).replace('%p', outcome.position));
    }
    await syncDiscord(req);
    // Nach Freigeben/Ablehnen oben bleiben (dort stehen die Anfragen), damit du
    // direkt die nächste bearbeiten kannst; sonst zum Auftrag springen.
    const anchor = {
      approve: '', reject: '', unapprove: '', delete: '#warteschlange', done: '#warteschlange',
    }[req.params.action] ?? `#auftrag-${id}`;
    if (req.body.back) return res.redirect(303, safeBack(req.body.back, '/admin'));
    res.redirect(303, `/admin${anchor}`);
  });

  // --- Archiv -------------------------------------------------------------------------

  function archiveFilters(query) {
    const sort = str(query.sort);
    return {
      q: str(query.q).slice(0, 200),
      person: str(query.person).slice(0, 60),
      sort: Object.prototype.hasOwnProperty.call(jobs.ARCHIVE_SORTS, sort) ? sort : 'neu',
    };
  }

  function archiveEntries(data, { q, person, sort }) {
    return jobs.archive(data, { person, sort }).map((job) => {
      const when = job.finishedAt ? `${day(job.finishedAt)} ${monthFormat.format(new Date(job.finishedAt))}` : '';
      const text = jobs.searchText(job, when);
      return { job, text, visible: jobs.matches(text, q) };
    });
  }

  async function renderArchive(req, res, extra = {}, status = 200) {
    const data = await store.readData();
    const filters = archiveFilters(req.query);
    const entries = archiveEntries(data, filters).slice(0, 2000);
    const visible = entries.filter((entry) => entry.visible).map((entry) => entry.job);
    const query = new URLSearchParams(
      Object.entries(filters).filter(([key, value]) => value && !(key === 'sort' && value === 'neu')),
    ).toString();
    res.page('adminArchive', {
      ...filters,
      entries,
      stats: {
        prints: visible.length,
        pieces: visible.reduce((sum, job) => sum + (job.quantity || 1), 0),
        people: new Set(visible.map((job) => job.requester)).size,
      },
      total: jobs.archive(data).length,
      people: jobs.archivePeople(data),
      back: query ? `/admin/archiv?${query}` : '/admin/archiv',
      newValues: { requester: req.user.displayName, quantity: 1, printedAt: isoDay(), ...extra.newValues },
      importValues: { requester: req.user.displayName, printedAt: isoDay(), ...extra.importValues },
      openNew: Boolean(extra.newValues),
      openImport: Boolean(extra.importValues),
    }, status);
  }

  app.get('/admin/archiv', requireAdmin, (req, res) => renderArchive(req, res));

  app.get('/admin/archiv.csv', requireAdmin, async (req, res) => {
    const rows = archiveEntries(await store.readData(), archiveFilters(req.query))
      .filter((entry) => entry.visible)
      .map(({ job }) => [day(job.finishedAt), job.title, job.requester, job.quantity, job.color,
        job.makerworldUrl, job.notes, job.adminNote]);
    const cell = (value) => {
      let text = value === null || value === undefined ? '' : String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // keine Formeln in Excel einschleusen
      return `"${text.replace(/"/g, '""')}"`;
    };
    const header = ['Gedruckt am', 'Titel', 'Für', 'Anzahl', 'Farbe/Material', 'Link', 'Wünsche', 'Notiz'];
    const csv = [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n');
    res.set('Content-Disposition', 'attachment; filename="druck-archiv.csv"');
    res.type('text/csv; charset=utf-8').send(`\ufeff${csv}\r\n`);
  });

  app.get('/admin/archiv.html', requireAdmin, async (req, res) => {
    const data = await store.readData();
    const entries = archiveEntries(data, { q: '', person: '', sort: 'neu' });
    const all = entries.map((entry) => entry.job);
    const file = views.archiveExport({
      entries,
      people: jobs.archivePeople(data),
      stats: {
        prints: all.length,
        pieces: all.reduce((sum, job) => sum + (job.quantity || 1), 0),
        people: new Set(all.map((job) => job.requester)).size,
      },
      exportedAt: date(new Date().toISOString()),
      day,
    });
    res.set('Content-Disposition', `attachment; filename="druck-archiv-${isoDay()}.html"`);
    res.type('html').send(String(file));
  });

  app.post('/admin/archiv/eintragen', requireAdmin, async (req, res) => {
    const { values, errors } = forms.parseJobForm(req.body, { admin: true });
    const printedAt = forms.parseDate(req.body.printed_at);
    if (!printedAt) errors.push('Bitte gib ein gültiges Druckdatum an (nicht in der Zukunft).');
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return renderArchive(req, res, { newValues: { ...values, printedAt: str(req.body.printed_at) } }, 400);
    }
    await forms.completeFromMakerworld(values, config.fetchMakerworldInfo);
    const job = await store.updateData((data) => jobs.addPrinted(data, values, printedAt));
    await log(req, 'eingetragen', { job });
    req.flash('success', `„${job.title}“ ist jetzt im Archiv.`);
    res.redirect(303, `/admin/archiv#auftrag-${job.id}`);
  });

  app.post('/admin/archiv/import', requireAdmin, async (req, res) => {
    const { urls, skipped, tooMany } = forms.parseLinkList(req.body.links);
    const requester = str(req.body.requester).slice(0, 60);
    const printedAt = forms.parseDate(req.body.printed_at);
    const errors = [];
    if (!urls.length) errors.push('Bitte füge mindestens einen gültigen Link ein (einen pro Zeile).');
    if (!requester) errors.push('Bitte gib an, für wen die Drucke waren.');
    if (!printedAt) errors.push('Bitte gib ein gültiges Druckdatum an (nicht in der Zukunft).');
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      const importValues = { links: str(req.body.links), requester, printedAt: str(req.body.printed_at) };
      return renderArchive(req, res, { importValues }, 400);
    }
    const entries = await mapLimit(urls, 6, (url) => forms.completeFromMakerworld(
      { makerworldUrl: url, requester, quantity: 1, title: null, imageUrl: null }, config.fetchMakerworldInfo,
    ));
    await store.updateData((data) => entries.forEach((values) => jobs.addPrinted(data, values, printedAt)));
    await log(req, 'importiert', { details: `${entries.length} ${entries.length === 1 ? 'Link' : 'Links'} für ${requester}` });
    req.flash('success', `${entries.length} ${entries.length === 1 ? 'Druck' : 'Drucke'} ins Archiv übernommen. `
      + 'Titel und Bilder kannst du bei Bedarf unter „Bearbeiten“ anpassen.');
    if (skipped.length) req.flash('error', `Übersprungen (kein gültiger Link): ${skipped.join(', ')}`);
    if (tooMany) req.flash('error', 'Es wurden nur die ersten 50 Links übernommen – den Rest bitte in einem zweiten Schritt.');
    res.redirect(303, '/admin/archiv');
  });

  app.post('/admin/discord/senden', requireAdmin, async (req, res) => {
    await syncDiscord(req, true);
    res.redirect(303, '/admin#discord');
  });

  // --- Fehler -----------------------------------------------------------------------

  app.use((req, res) => {
    res.page('errorPage', { status: 404, message: 'Diese Seite oder diesen Auftrag gibt es nicht.' }, 404);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status === 413
      ? 'Das war zu viel Text auf einmal.'
      : 'Da ist etwas schiefgegangen. Bitte versuch es nochmal.';
    res.page('errorPage', { status, message }, status);
  });

  return app;
}

module.exports = { createApp };
