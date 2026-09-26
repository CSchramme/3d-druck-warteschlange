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
const str = (value) => (typeof value === 'string' ? value.trim() : '');

/** Rücksprung-Adresse aus einem Formular – nur interne Admin-Seiten erlaubt. */
function safeBack(value, fallback) {
  return typeof value === 'string' && /^\/admin(\/archiv)?(\?[^\s#]*)?$/.test(value) ? value : fallback;
}

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
      const ctx = { csrf: csrfToken(req), isAdmin: Boolean(req.session.admin), flashes, date, day };
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
    const back = safeBack(req.query.back, '/admin');
    res.page('adminEdit', { job, values: { ...job, printedAt: isoDay(job.finishedAt) }, back });
  });

  app.post('/admin/auftrag/:id/bearbeiten', requireAdmin, async (req, res, next) => {
    const id = Number(req.params.id);
    const job = jobs.get(store.readData(), id);
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

  function renderArchive(req, res, extra = {}, status = 200) {
    const data = store.readData();
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
      newValues: { requester: 'Ich', quantity: 1, printedAt: isoDay(), ...extra.newValues },
      importValues: { requester: 'Ich', printedAt: isoDay(), ...extra.importValues },
      openNew: Boolean(extra.newValues),
      openImport: Boolean(extra.importValues),
    }, status);
  }

  app.get('/admin/archiv', requireAdmin, (req, res) => renderArchive(req, res));

  app.get('/admin/archiv.csv', requireAdmin, (req, res) => {
    const rows = archiveEntries(store.readData(), archiveFilters(req.query))
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

  app.post('/admin/archiv/nachtragen', requireAdmin, async (req, res) => {
    const { values, errors } = forms.parseJobForm(req.body, { admin: true });
    const printedAt = forms.parseDate(req.body.printed_at);
    if (!printedAt) errors.push('Bitte gib ein gültiges Druckdatum an (nicht in der Zukunft).');
    if (errors.length) {
      errors.forEach((error) => req.flash('error', error));
      return renderArchive(req, res, { newValues: { ...values, printedAt: str(req.body.printed_at) } }, 400);
    }
    await forms.completeFromMakerworld(values, config.fetchMakerworldInfo);
    const job = await store.updateData((data) => jobs.addPrinted(data, values, printedAt));
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
