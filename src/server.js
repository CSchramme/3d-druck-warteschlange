'use strict';

const path = require('path');
const express = require('express');

const discord = require('./discord');
const forms = require('./forms');
const jobs = require('./jobs');
const views = require('./views');
const { createStore } = require('./store');
const { sessionMiddleware, csrfToken, csrfValid, passwordMatches } = require('./session');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// aktion -> was passiert, welche Meldung, bei welchem Status erlaubt
const ACTIONS = {
  approve: { run: jobs.enqueue, message: '„%s“ ist freigegeben und steht jetzt auf Platz %p der Warteschlange.', allowed: ['pending'] },
  reject: { run: jobs.reject, message: '„%s“ wurde abgelehnt.', allowed: ['pending', 'queued'] },
  done: { run: jobs.markDone, message: '„%s“ ist als gedruckt markiert. 🎉', allowed: ['queued'] },
  restore: { run: jobs.enqueue, message: '„%s“ steht wieder in der Warteschlange (Platz %p).', allowed: ['done', 'rejected'] },
  unapprove: { run: jobs.backToPending, message: '„%s“ wartet wieder auf Freigabe.', allowed: ['queued'] },
  up: { run: (d, id) => jobs.move(d, id, 'up'), allowed: ['queued'] },
  down: { run: (d, id) => jobs.move(d, id, 'down'), allowed: ['queued'] },
  top: { run: (d, id) => jobs.move(d, id, 'top'), allowed: ['queued'] },
  bottom: { run: (d, id) => jobs.move(d, id, 'bottom'), allowed: ['queued'] },
  delete: { run: jobs.remove, message: '„%s“ wurde gelöscht.', allowed: ['pending', 'queued', 'done', 'rejected'] },
};

/**
 * Baut die Express-App. deps.postWebhook ersetzt (für Tests) den echten
 * Discord-Versand.
 */
function createApp(config, deps = {}) {
  const store = createStore(config.dataDir);
  const app = express();
  app.disable('x-powered-by');

  const dateFormat = new Intl.DateTimeFormat('de-DE', {
    timeZone: config.timezone,
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const date = (iso) => (iso ? dateFormat.format(new Date(iso)) : '');

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
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
      const ctx = { csrf: csrfToken(req), isAdmin: Boolean(req.session.admin), flashes, date };
      res.status(status).type('html').send(String(views[view](ctx, data)));
    };
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

  const familyAccess = (req) => !config.familyPassword || req.session.family || req.session.admin;

  function requireFamily(req, res, next) {
    if (!familyAccess(req)) return res.redirect(303, '/zugang');
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.session.admin) return res.redirect(303, '/admin/login');
    next();
  }

  async function syncDiscord(req, force = false) {
    const result = await discord.sync(store, config, { force, post: deps.postWebhook });
    if (result === 'sent') req.flash('info', 'Die aktuellen Top-Aufträge wurden an Discord geschickt.');
    else if (result === 'error') req.flash('error', 'Discord-Versand fehlgeschlagen – Details stehen unten bei „Discord“.');
    else if (force && result === 'disabled') req.flash('error', 'Es ist keine DISCORD_WEBHOOK_URL eingestellt.');
  }

  // --- Öffentlich ---------------------------------------------------------------

  function renderIndex(req, res, values, status = 200) {
    const data = store.readData();
    res.page('index', {
      values: values || { requester: req.session.name || '', quantity: 1 },
      queue: jobs.queue(data),
      done: jobs.finished(data, 10).filter((job) => job.status === 'done'),
      topN: config.discordTopN,
    }, status);
  }

  app.get('/', requireFamily, (req, res) => renderIndex(req, res));

  app.post('/auftrag', requireFamily, async (req, res) => {
    // Unsichtbares Feld: Bots füllen es aus, Menschen nicht.
    if (req.body.website) return res.redirect(303, '/');

    const { values, errors } = forms.parseJobForm(req.body);
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return renderIndex(req, res, values, 400);
    }
    await forms.completeFromMakerworld(values, config.fetchMakerworldInfo);
    const job = await store.updateData((data) => jobs.create(data, values));
    req.session.name = values.requester;
    req.flash('success', `Danke! Deine Anfrage „${job.title}“ ist angekommen. Sobald sie freigegeben ist, `
      + 'erscheint sie hier in der Warteschlange.');
    res.redirect(303, '/');

    // Dir per Discord Bescheid geben – im Hintergrund, damit niemand warten muss.
    const notified = discord.notifyNewRequest(store, config, job, { post: deps.postWebhook })
      .catch((err) => console.error('Discord-Meldung für neue Anfrage fehlgeschlagen:', err));
    if (deps.onBackgroundTask) deps.onBackgroundTask(notified);
  });

  app.get('/zugang', (req, res) => {
    if (familyAccess(req)) return res.redirect(303, '/');
    res.page('zugang');
  });

  app.post('/zugang', (req, res) => {
    if (familyAccess(req)) return res.redirect(303, '/');
    if (passwordMatches(req.body.password, config.familyPassword)) {
      req.session.family = true;
      return res.redirect(303, '/');
    }
    req.flash('error', 'Das Passwort stimmt nicht.');
    res.page('zugang', {}, 401);
  });

  // --- Admin ----------------------------------------------------------------------

  app.get('/admin/login', (req, res) => {
    if (req.session.admin) return res.redirect(303, '/admin');
    res.page('adminLogin', { configured: Boolean(config.adminPassword) });
  });

  app.post('/admin/login', async (req, res) => {
    if (passwordMatches(req.body.password, config.adminPassword)) {
      req.session.admin = true;
      return res.redirect(303, '/admin');
    }
    await sleep(1000); // bremst Passwort-Raten aus
    req.flash('error', 'Falsches Passwort.');
    res.page('adminLogin', { configured: Boolean(config.adminPassword) }, 401);
  });

  app.post('/admin/logout', (req, res) => {
    delete req.session.admin;
    res.redirect(303, '/');
  });

  function renderDashboard(req, res, newValues, status = 200) {
    const data = store.readData();
    res.page('adminDashboard', {
      pending: jobs.pending(data),
      queue: jobs.queue(data),
      finished: jobs.finished(data),
      discord: discord.status(store, config),
      topN: config.discordTopN,
      newValues: newValues || { requester: req.session.name || '', quantity: 1 },
      openNew: Boolean(newValues),
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
    req.flash('success', `„${job.title}“ steht jetzt hinten in der Warteschlange.`);
    await syncDiscord(req);
    res.redirect(303, `/admin#auftrag-${job.id}`);
  });

  app.get('/admin/auftrag/:id/bearbeiten', requireAdmin, (req, res, next) => {
    const job = jobs.get(store.readData(), Number(req.params.id));
    if (!job) return next();
    res.page('adminEdit', { job, values: job });
  });

  app.post('/admin/auftrag/:id/bearbeiten', requireAdmin, async (req, res, next) => {
    const id = Number(req.params.id);
    const job = jobs.get(store.readData(), id);
    if (!job) return next();
    const { values, errors } = forms.parseJobForm(req.body, { admin: true });
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return res.page('adminEdit', { job, values }, 400);
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
    req.flash('success', 'Änderungen gespeichert.');
    await syncDiscord(req);
    res.redirect(303, `/admin#auftrag-${id}`);
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
    res.redirect(303, `/admin${anchor}`);
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
