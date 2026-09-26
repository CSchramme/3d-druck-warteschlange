'use strict';

const { html } = require('./html');
const { isMakerworld } = require('./makerworld');

// --- Bausteine ---------------------------------------------------------------

function layout(ctx, { title, body }) {
  const { isAdmin, csrf, flashes } = ctx;
  // Fehler bleiben stehen; Erfolgsmeldungen erscheinen als Einblendung, die
  // man auch sieht, wenn die Seite zu einem Auftrag weiter unten springt.
  const errors = flashes.filter((f) => f.type === 'error');
  const notices = flashes.filter((f) => f.type !== 'error');
  return html`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title ? `${title} – ` : ''}3D-Druck-Warteschlange</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🖨️</text></svg>">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="/">🖨️ Druck-Warteschlange</a>
      <nav>
        <a href="/#einreichen">Einreichen</a>
        <a href="/#warteschlange">Warteschlange</a>
        <a href="/admin">Admin</a>
        ${isAdmin ? html`<a href="/admin/archiv">Archiv</a>` : ''}
        ${isAdmin ? html`
          <form method="post" action="/admin/logout" class="inline">
            <input type="hidden" name="csrf_token" value="${csrf}">
            <button class="linklike" type="submit">Abmelden</button>
          </form>` : ''}
      </nav>
    </div>
  </header>
  <main class="wrap">
    ${errors.length ? html`<div class="flashes">
      ${errors.map((f) => html`<div class="flash flash-error">${f.message}</div>`)}
    </div>` : ''}
    ${notices.length ? html`<div class="toasts" role="status">
      ${notices.map((f) => html`<div class="flash toast flash-${f.type}">${f.message}</div>`)}
    </div>` : ''}
    ${body}
  </main>
  <script>
    document.addEventListener('click', function (e) {
      if (e.target.classList.contains('toast')) e.target.remove();
    });
    document.addEventListener('submit', function (e) {
      var message = e.target.getAttribute('data-confirm');
      if (message && !window.confirm(message)) e.preventDefault();
    });
  </script>
</body>
</html>`;
}

function jobFields(values, { admin = false, printedDate = false } = {}) {
  return html`
  <label class="field">
    <span>${admin ? 'Für wen' : 'Dein Name'} <em>*</em></span>
    <input name="requester" maxlength="60" required autocomplete="name"
           value="${values.requester}" placeholder="z. B. Oma Inge">
  </label>

  <label class="field">
    <span>MakerWorld-Link</span>
    <input name="makerworld_url" type="text" inputmode="url" autocapitalize="off" spellcheck="false"
           maxlength="500" value="${values.makerworldUrl}" placeholder="https://makerworld.com/de/models/…">
    <small>Hast du keinen? Kein Problem – beschreib unten einfach, was du brauchst.</small>
  </label>

  <label class="field">
    <span>Was soll gedruckt werden?</span>
    <input name="title" maxlength="120" value="${values.title}" placeholder="z. B. Handyhalter fürs Auto">
    <small>Bei einem MakerWorld-Link darf das leer bleiben.</small>
  </label>

  <div class="row">
    <label class="field narrow">
      <span>Anzahl</span>
      <input name="quantity" type="number" min="1" max="99" value="${values.quantity || 1}">
    </label>
    <label class="field">
      <span>Farbe / Material</span>
      <input name="color" maxlength="60" value="${values.color}" placeholder="z. B. Rot, egal">
    </label>
  </div>

  ${printedDate ? html`
  <label class="field">
    <span>Gedruckt am <em>*</em></span>
    <input name="printed_at" type="date" required value="${values.printedAt}">
  </label>` : ''}

  <label class="field">
    <span>Beschreibung &amp; Wünsche</span>
    <textarea name="notes" rows="4" maxlength="1000"
              placeholder="Größe, Maße, wofür es ist, bis wann du es brauchst …">${values.notes}</textarea>
  </label>

  ${admin ? html`
  <label class="field">
    <span>Vorschaubild-Link</span>
    <input name="image_url" type="text" inputmode="url" autocapitalize="off" spellcheck="false"
           maxlength="500" value="${values.imageUrl}" placeholder="https://… (wird bei MakerWorld automatisch versucht)">
  </label>
  <label class="field">
    <span>Admin-Notiz <small>(nur für dich &amp; Discord)</small></span>
    <textarea name="admin_note" rows="2" maxlength="1000"
              placeholder="z. B. PETG, 0,2 mm, Stützen nötig">${values.adminNote}</textarea>
  </label>` : ''}`;
}

function linkBadge(job, { warnMissing = true } = {}) {
  if (job.makerworldUrl) {
    return html`<a class="badge badge-link" href="${job.makerworldUrl}" target="_blank" rel="noopener noreferrer">${
      isMakerworld(job.makerworldUrl) ? 'MakerWorld' : 'Link'} ↗</a>`;
  }
  if (!warnMissing) return '';
  return html`<span class="badge badge-warn" title="Modell muss selbst besorgt oder erstellt werden">kein Link</span>`;
}

function jobMeta(ctx, job) {
  return html`<div class="meta">
    <span>👤 ${job.requester}</span>
    ${job.quantity > 1 ? html`<span>🔢 ${job.quantity}×</span>` : ''}
    ${job.color ? html`<span>🎨 ${job.color}</span>` : ''}
    <span class="muted">${ctx.date(job.createdAt)}</span>
  </div>`;
}

function thumb(job) {
  return job.imageUrl
    ? html`<img class="thumb" src="${job.imageUrl}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : html`<div class="thumb thumb-empty" aria-hidden="true">🧊</div>`;
}

// --- Öffentliche Seiten ---------------------------------------------------------

function index(ctx, { values, queue, done, topN }) {
  const body = html`
<div class="columns">
  <section class="card" id="einreichen">
    <h1>Druckauftrag einreichen</h1>
    <p class="lead">Füg einen <strong>MakerWorld-Link</strong> ein oder beschreib, was du gedruckt haben möchtest.
      Jede Anfrage wird erst geprüft und freigegeben – danach taucht sie in der Warteschlange auf.</p>
    <form method="post" action="/auftrag" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      <div class="hp" aria-hidden="true">
        <label>Website <input name="website" tabindex="-1" autocomplete="off"></label>
      </div>
      ${jobFields(values)}
      <button class="btn btn-primary btn-block" type="submit">Auftrag abschicken</button>
    </form>
  </section>

  <div class="stack">
    <section class="card" id="warteschlange">
      <h2>Warteschlange <span class="count">${queue.length}</span></h2>
      ${queue.length ? html`<ol class="joblist">
        ${queue.map((job, i) => html`
          <li class="job ${i < topN ? 'job-next' : ''}">
            <span class="pos">${i + 1}</span>
            ${thumb(job)}
            <div class="job-body">
              <div class="job-title">${job.title} ${linkBadge(job)}</div>
              ${jobMeta(ctx, job)}
            </div>
          </li>`)}
      </ol>` : html`<p class="empty">Gerade ist nichts in der Warteschlange.</p>`}
    </section>

    ${done.length ? html`
    <section class="card">
      <h2>Zuletzt gedruckt</h2>
      <ul class="simple-list">
        ${done.map((job) => html`<li>✅ ${job.title} <span class="muted">für ${job.requester} · ${ctx.date(job.finishedAt)}</span></li>`)}
      </ul>
    </section>` : ''}
  </div>
</div>`;
  return layout(ctx, { body });
}

function zugang(ctx) {
  const body = html`
<section class="card narrow-card">
  <h1>Hallo! 👋</h1>
  <p class="lead">Diese Seite ist nur für die Familie. Bitte gib das Familien-Passwort ein –
    danach bleibst du auf diesem Gerät angemeldet.</p>
  <form method="post" action="/zugang" class="form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <label class="field">
      <span>Familien-Passwort</span>
      <input name="password" type="password" required autofocus autocomplete="current-password">
    </label>
    <button class="btn btn-primary btn-block" type="submit">Weiter</button>
  </form>
</section>`;
  return layout(ctx, { title: 'Zugang', body });
}

// --- Admin -------------------------------------------------------------------

function adminLogin(ctx, { configured }) {
  const body = html`
<section class="card narrow-card">
  <h1>Admin-Login</h1>
  ${configured ? html`
  <form method="post" action="/admin/login" class="form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <label class="field">
      <span>Passwort</span>
      <input name="password" type="password" required autofocus autocomplete="current-password">
    </label>
    <button class="btn btn-primary btn-block" type="submit">Anmelden</button>
  </form>` : html`
  <p class="flash flash-error">Es ist kein <code>ADMIN_PASSWORD</code> gesetzt. Trag eins in Plesk bei den
    Umgebungsvariablen (oder in die <code>.env</code>-Datei) ein und starte die App neu.</p>`}
</section>`;
  return layout(ctx, { title: 'Admin-Login', body });
}

function action(ctx, job, name, label, { cls = 'btn', confirm = null, title = null, back = null } = {}) {
  return html`<form method="post" action="/admin/auftrag/${job.id}/${name}" class="inline"${
    confirm ? html` data-confirm="${confirm}"` : ''}>
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    ${back ? html`<input type="hidden" name="back" value="${back}">` : ''}
    <button type="submit" class="${cls}"${title ? html` title="${title}" aria-label="${title}"` : ''}>${label}</button>
  </form>`;
}

function jobDetails(job) {
  return html`
    ${job.notes ? html`<p class="notes">📝 ${job.notes}</p>` : ''}
    ${job.adminNote ? html`<p class="notes admin-note">🛠️ ${job.adminNote}</p>` : ''}
    ${job.makerworldUrl ? '' : html`<p class="hint-warn">⚠️ Kein MakerWorld-Link – Modell musst du selbst besorgen oder erstellen.</p>`}`;
}

function adminDashboard(ctx, { pending, queue, finished, discord, topN, newValues, openNew }) {
  const discordLabel = discord.error ? 'Fehler' : discord.configured ? 'aktiv' : 'nicht eingerichtet';
  const body = html`
<div class="admin-head">
  <h1>Admin</h1>
  <a class="pill ${discord.configured && !discord.error ? 'pill-ok' : 'pill-warn'}" href="#discord">Discord: ${discordLabel}</a>
</div>

<section class="card" id="anfragen">
  <h2>Warten auf Freigabe <span class="count">${pending.length}</span></h2>
  ${pending.length ? html`<ul class="joblist">
    ${pending.map((job) => html`
      <li class="job job-admin" id="auftrag-${job.id}">
        ${thumb(job)}
        <div class="job-body">
          <div class="job-title">${job.title} ${linkBadge(job)}</div>
          ${jobMeta(ctx, job)}
          ${jobDetails(job)}
          <div class="actions">
            ${action(ctx, job, 'approve', '✓ Freigeben', { cls: 'btn btn-primary' })}
            <a class="btn" href="/admin/auftrag/${job.id}/bearbeiten">Bearbeiten</a>
            ${action(ctx, job, 'reject', 'Ablehnen', { cls: 'btn btn-danger-soft', confirm: `„${job.title}“ ablehnen?` })}
          </div>
        </div>
      </li>`)}
  </ul>` : html`<p class="empty">Keine neuen Anfragen. 🎉</p>`}
</section>

<section class="card" id="warteschlange">
  <h2>Warteschlange <span class="count">${queue.length}</span></h2>
  <p class="muted small">Die obersten ${topN} werden an Discord geschickt – aber nur, wenn sich an ihnen etwas ändert.</p>
  ${queue.length ? html`<ol class="joblist">
    ${queue.map((job, i) => html`
      <li class="job job-admin ${i < topN ? 'job-next' : ''}" id="auftrag-${job.id}">
        <span class="pos">${i + 1}</span>
        ${thumb(job)}
        <div class="job-body">
          <div class="job-title">${job.title} ${linkBadge(job)}
            ${i < topN ? html`<span class="badge badge-discord">Discord</span>` : ''}</div>
          ${jobMeta(ctx, job)}
          ${jobDetails(job)}
          <div class="actions">
            <span class="btn-group">
              ${action(ctx, job, 'top', '⤒', { cls: 'btn btn-icon', title: 'Ganz nach oben' })}
              ${action(ctx, job, 'up', '↑', { cls: 'btn btn-icon', title: 'Eins hoch' })}
              ${action(ctx, job, 'down', '↓', { cls: 'btn btn-icon', title: 'Eins runter' })}
              ${action(ctx, job, 'bottom', '⤓', { cls: 'btn btn-icon', title: 'Ganz nach unten' })}
            </span>
            ${action(ctx, job, 'done', '✓ Gedruckt', { cls: 'btn btn-primary' })}
            <a class="btn" href="/admin/auftrag/${job.id}/bearbeiten">Bearbeiten</a>
            ${action(ctx, job, 'unapprove', 'Freigabe zurücknehmen')}
            ${action(ctx, job, 'delete', 'Löschen', { cls: 'btn btn-danger-soft', confirm: `„${job.title}“ wirklich löschen?` })}
          </div>
        </div>
      </li>`)}
  </ol>` : html`<p class="empty">Die Warteschlange ist leer.</p>`}

  <details class="add-own"${openNew ? html` open` : ''}>
    <summary>➕ Eigenen Auftrag direkt in die Warteschlange</summary>
    <form method="post" action="/admin/auftrag/neu" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      ${jobFields(newValues, { admin: true })}
      <button class="btn btn-primary" type="submit">Hinzufügen</button>
    </form>
  </details>
</section>

<section class="card" id="erledigt">
  <h2>Erledigt &amp; abgelehnt</h2>
  <p class="small"><a href="/admin/archiv">📚 Alle gedruckten Aufträge im Archiv durchsuchen →</a></p>
  ${finished.length ? html`<ul class="joblist compact">
    ${finished.map((job) => html`
      <li class="job job-admin" id="auftrag-${job.id}">
        <div class="job-body">
          <div class="job-title">
            ${job.status === 'done' ? '✅' : '✖️'} ${job.title}
            <span class="muted small">für ${job.requester} · ${ctx.date(job.finishedAt)}</span>
          </div>
          <div class="actions">
            ${action(ctx, job, 'restore', 'Zurück in die Warteschlange', { cls: 'btn btn-small' })}
            ${action(ctx, job, 'delete', 'Löschen', { cls: 'btn btn-small btn-danger-soft', confirm: `„${job.title}“ wirklich löschen?` })}
          </div>
        </div>
      </li>`)}
  </ul>` : html`<p class="empty">Noch nichts erledigt.</p>`}
</section>

<section class="card" id="discord">
  <h2>Discord</h2>
  ${discord.configured ? html`
  <dl class="facts">
    <dt>Warteschlange</dt><dd>die obersten ${discord.topN} Aufträge, sobald sich an ihnen etwas ändert</dd>
    <dt>Neue Anfragen</dt><dd>werden sofort gemeldet${discord.separateRequestsChannel ? ' (eigener Kanal)' : ''}${
      discord.pingsUser ? ', mit Ping an dich' : ''}</dd>
    <dt>Zuletzt gesendet</dt><dd>${discord.lastSentAt ? ctx.date(discord.lastSentAt) : 'noch nie'}</dd>
    ${discord.error ? html`<dt>Letzter Fehler</dt><dd class="error-text">${ctx.date(discord.error.at)} – ${discord.error.message}</dd>` : ''}
  </dl>
  ${discord.hasPublicUrl ? '' : html`<p class="hint-warn">Tipp: Trag <code>PUBLIC_URL</code> ein (z. B.
    <code>https://druck.deine-domain.de</code>) – dann kommst du aus Discord mit einem Klick direkt zur Freigabe.</p>`}
  <form method="post" action="/admin/discord/senden">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <button class="btn" type="submit">Jetzt an Discord senden</button>
  </form>` : html`
  <p>Es ist noch kein Discord-Webhook eingerichtet. Leg in Discord unter
    <em>Kanal bearbeiten → Integrationen → Webhooks</em> einen Webhook an und trag die URL als
    <code>DISCORD_WEBHOOK_URL</code> in Plesk bei den Umgebungsvariablen ein.</p>`}
</section>`;
  return layout(ctx, { title: 'Admin', body });
}

function adminEdit(ctx, { job, values, back }) {
  const body = html`
<section class="card narrow-card wide">
  <p><a href="${back}#auftrag-${job.id}">← Zurück</a></p>
  <h1>${job.status === 'done' ? 'Druck bearbeiten' : 'Auftrag bearbeiten'}</h1>
  <form method="post" action="/admin/auftrag/${job.id}/bearbeiten" class="form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <input type="hidden" name="back" value="${back}">
    ${jobFields(values, { admin: true, printedDate: job.status === 'done' })}
    <button class="btn btn-primary" type="submit">Speichern</button>
  </form>
</section>`;
  return layout(ctx, { title: 'Auftrag bearbeiten', body });
}

function adminArchive(ctx, {
  q, person, sort, entries, stats, total, people, back, newValues, importValues, openNew, openImport,
}) {
  const sortOptions = [['neu', 'Neueste zuerst'], ['alt', 'Älteste zuerst'], ['titel', 'Titel A–Z'], ['person', 'Nach Person']];
  const editLink = (job) => `/admin/auftrag/${job.id}/bearbeiten?back=${encodeURIComponent(back)}`;
  const body = html`
<div class="admin-head">
  <h1>📚 Druck-Archiv</h1>
  ${total ? html`<a class="btn btn-small" href="/admin/archiv.csv${back.includes('?') ? back.slice(back.indexOf('?')) : ''}"
     download>⬇️ Als Tabelle (CSV)</a>` : ''}
</div>

<section class="card">
  <form method="get" action="/admin/archiv" class="archive-filters" role="search">
    <input id="archiv-suche" name="q" type="search" value="${q}" autocomplete="off"
           placeholder="Suchen, z. B. Drache, Mama, 2025" aria-label="Archiv durchsuchen">
    <select name="person" aria-label="Person">
      <option value="">Alle Personen</option>
      ${people.map((p) => html`<option value="${p.name}"${p.name.toLowerCase() === person.toLowerCase() ? html` selected` : ''}>${p.name} (${p.count})</option>`)}
    </select>
    <select name="sort" aria-label="Sortierung">
      ${sortOptions.map(([value, label]) => html`<option value="${value}"${value === sort ? html` selected` : ''}>${label}</option>`)}
    </select>
    <noscript><button class="btn" type="submit">Suchen</button></noscript>
  </form>

  <p class="archive-stats">
    <span><strong id="stat-drucke">${stats.prints}</strong> Drucke</span>
    <span><strong id="stat-teile">${stats.pieces}</strong> Teile</span>
    <span><strong id="stat-personen">${stats.people}</strong> Personen</span>
  </p>

  ${total ? html`
  <ul class="joblist" id="archiv-liste">
    ${entries.map(({ job, text, visible }) => html`
      <li class="job job-admin" id="auftrag-${job.id}" data-search="${text}" data-qty="${job.quantity || 1}"
          data-person="${job.requester}"${visible ? '' : html` hidden`}>
        ${thumb(job)}
        <div class="job-body">
          <div class="job-title">${job.title} ${linkBadge(job, { warnMissing: false })}</div>
          <div class="meta">
            <span>📅 ${ctx.day(job.finishedAt)}</span>
            <span>👤 ${job.requester}</span>
            ${job.quantity > 1 ? html`<span>🔢 ${job.quantity}×</span>` : ''}
            ${job.color ? html`<span>🎨 ${job.color}</span>` : ''}
          </div>
          ${job.notes ? html`<p class="notes">📝 ${job.notes}</p>` : ''}
          ${job.adminNote ? html`<p class="notes admin-note">🛠️ ${job.adminNote}</p>` : ''}
          <div class="actions">
            ${action(ctx, job, 'nochmal', '🔁 Nochmal drucken', { cls: 'btn btn-primary btn-small', back })}
            <a class="btn btn-small" href="${editLink(job)}">Bearbeiten</a>
            ${action(ctx, job, 'delete', 'Löschen', {
              cls: 'btn btn-small btn-danger-soft', confirm: `„${job.title}“ aus dem Archiv löschen?`, back,
            })}
          </div>
        </div>
      </li>`)}
  </ul>
  <p class="empty" id="archiv-leer"${stats.prints ? html` hidden` : ''}>Nichts gefunden – versuch es mit einem anderen Suchwort.</p>`
  : html`<p class="empty">Noch keine Drucke im Archiv. Sobald du in der Warteschlange auf <strong>✓ Gedruckt</strong>
      klickst, landet der Auftrag hier. Frühere Drucke kannst du unten nachtragen.</p>`}
</section>

<section class="card">
  <details class="add-own"${openNew ? html` open` : ''}>
    <summary>➕ Früheren Druck nachtragen</summary>
    <form method="post" action="/admin/archiv/nachtragen" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      ${jobFields(newValues, { admin: true, printedDate: true })}
      <button class="btn btn-primary" type="submit">Ins Archiv aufnehmen</button>
    </form>
  </details>

  <details class="add-own"${openImport ? html` open` : ''}>
    <summary>📋 Mehrere MakerWorld-Links auf einmal nachtragen</summary>
    <form method="post" action="/admin/archiv/import" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      <label class="field">
        <span>Links <em>*</em> <small>(einer pro Zeile, höchstens 50)</small></span>
        <textarea name="links" rows="6" required spellcheck="false"
                  placeholder="https://makerworld.com/de/models/…&#10;https://makerworld.com/de/models/…">${importValues.links}</textarea>
      </label>
      <div class="row row-even">
        <label class="field">
          <span>Für wen <em>*</em></span>
          <input name="requester" maxlength="60" required value="${importValues.requester}">
        </label>
        <label class="field">
          <span>Gedruckt am <em>*</em></span>
          <input name="printed_at" type="date" required value="${importValues.printedAt}">
        </label>
      </div>
      <button class="btn btn-primary" type="submit">Alle ins Archiv aufnehmen</button>
    </form>
  </details>
</section>
<script src="/archiv.js" defer></script>`;
  return layout(ctx, { title: 'Druck-Archiv', body });
}

function errorPage(ctx, { status, message }) {
  const body = html`
<section class="card narrow-card">
  <h1>${status === 404 ? 'Nicht gefunden' : 'Hoppla'}</h1>
  <p class="lead">${message}</p>
  <p><a href="/">Zur Startseite</a></p>
</section>`;
  return layout(ctx, { title: 'Fehler', body });
}

module.exports = { index, zugang, adminLogin, adminDashboard, adminEdit, adminArchive, errorPage };
