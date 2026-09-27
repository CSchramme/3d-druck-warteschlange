'use strict';

const fs = require('fs');
const path = require('path');

const { html, raw } = require('./html');
const { icon } = require('./icons');
const { logoSvg } = require('./logo');
const legal = require('./legal');
const maintenance = require('./maintenance');
const { isMakerworld } = require('./makerworld');
const { assetUrl } = require('./pwa');

// Für den HTML-Export: Aussehen und Suche werden direkt in die Datei gepackt.
const EXPORT_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const EXPORT_JS = fs.readFileSync(path.join(__dirname, 'export', 'archiv-export.js'), 'utf8');

// Kaputte Vorschaubilder entfernen – darunter liegt immer ein Platzhalter-Icon.
const IMAGE_FALLBACK = `document.addEventListener('error', function (e) {
  var t = e.target; if (t && t.tagName === 'IMG' && t.closest('.thumb')) t.remove();
}, true);`;

// --- Navigation ----------------------------------------------------------------

const NAV_PUBLIC = [
  { href: '/', label: 'Einreichen', icon: 'plus-circle', active: (p) => p === '/' || p === '/auftrag' },
  { href: '/warteschlange', label: 'Warteschlange', icon: 'layers', active: (p) => p === '/warteschlange' },
  { href: '/admin/login', label: 'Anmelden', icon: 'log-in', active: (p) => p.startsWith('/admin') },
];

const NAV_ADMIN = [
  { href: '/admin', label: 'Aufträge', icon: 'inbox', badge: true,
    active: (p) => p === '/admin' || p.startsWith('/admin/auftrag') || p.startsWith('/admin/discord') },
  { href: '/admin/archiv', label: 'Archiv', icon: 'archive', active: (p) => p.startsWith('/admin/archiv') },
  { href: '/admin/verlauf', label: 'Verlauf', icon: 'history', active: (p) => p.startsWith('/admin/verlauf') },
  { href: '/admin/nutzer', label: 'Konten', icon: 'users', active: (p) => p.startsWith('/admin/nutzer') },
  { href: '/', label: 'Startseite', icon: 'home', active: (p) => p === '/' || p === '/warteschlange' },
];

function navItems(ctx, cls) {
  const items = ctx.isAdmin ? NAV_ADMIN : NAV_PUBLIC;
  return items.map((item) => {
    const active = item.active(ctx.path || '');
    const badge = item.badge && ctx.pendingCount
      ? html`<span class="nav-badge" aria-label="${ctx.pendingCount} offen">${ctx.pendingCount}</span>` : '';
    return html`<a class="${cls}${active ? ' is-active' : ''}" href="${item.href}"${active ? html` aria-current="page"` : ''}>
      <span class="nav-icon">${icon(item.icon, { size: 22 })}${badge}</span><span class="nav-label">${item.label}</span></a>`;
  });
}

const FLASH_ICONS = { error: 'alert-circle', success: 'check-circle', info: 'info' };

const logo = (size) => raw(logoSvg(size, { decorative: true }));

// Hinweis „Als App installieren“ – public/app.js blendet ihn ein, wenn es passt.
function installBanner() {
  return html`<aside class="install" id="install" hidden aria-label="App installieren">
    <span class="install-logo">${logo(44)}</span>
    <div class="install-text">
      <strong>Als App aufs Handy</strong>
      <span class="install-hint install-hint-prompt">Startet dann wie eine richtige App – ohne Browser drumherum.</span>
      <span class="install-hint install-hint-ios">In Safari auf ${icon('share', { size: 15 })}
        <b>Teilen</b> tippen (evtl. erst auf „…“), dann <b>„Zum Home-Bildschirm“</b>.</span>
    </div>
    <button class="icon-btn install-close" type="button" data-dismiss aria-label="Hinweis ausblenden" title="Ausblenden">${
      icon('x', { size: 18 })}</button>
    <button class="btn btn-primary install-btn" type="button" data-install>${
      icon('download', { size: 18 })}<span>Installieren</span></button>
  </aside>`;
}

const withBack = (href, back) => (back && back !== '/' ? `${href}?zurueck=${encodeURIComponent(back)}` : href);

/** Formular „Zustimmen“ – im Dialog und unten auf den Seiten AGB/Datenschutz. */
function consentForm(ctx, back, label = 'Cookies & AGB akzeptieren') {
  return html`<form method="post" action="/zustimmung" class="consent-form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <input type="hidden" name="back" value="${back}">
    <button class="btn btn-primary btn-block btn-lg" type="submit">${icon('check', { size: 20 })}<span>${label}</span></button>
  </form>`;
}

// Erscheint für alle, die der aktuellen Version noch nicht zugestimmt haben.
function consentDialog(ctx) {
  const back = ctx.url || '/';
  return html`
  <div class="consent-backdrop"></div>
  <section class="consent" role="dialog" aria-modal="true" aria-labelledby="consent-title">
    <div class="consent-head">
      <span class="consent-logo">${logo(44)}</span>
      <div>
        <h2 id="consent-title">${ctx.consent.renewed ? 'Es gibt Neuigkeiten' : 'Kurz zustimmen, dann geht’s los'}</h2>
        <p>${ctx.consent.renewed ? 'Die AGB bzw. der Datenschutz-Hinweis wurden geändert – bitte stimm einmal neu zu.'
    : 'Bevor du die Druck-Warteschlange nutzt, brauchen wir kurz dein Okay.'}</p>
      </div>
    </div>
    <div class="consent-item">
      <span class="consent-icon">${icon('cookie', { size: 22 })}</span>
      <div>
        <strong>Cookies</strong>
        <p>Nur ein technisch notwendiges Cookie – für den Schutz der Formulare und die Anmeldung. Kein Tracking, keine Werbung.</p>
        <a href="${withBack('/datenschutz', back)}">Datenschutz &amp; Cookies${icon('chevron-right', { size: 16 })}</a>
      </div>
    </div>
    <div class="consent-item">
      <span class="consent-icon">${icon('scale', { size: 22 })}</span>
      <div>
        <strong>AGB</strong>
        <p>Die Regeln der Warteschlange – z. B. dass es keinen Anspruch auf einen Druck gibt und nichts Gefährliches gedruckt wird.</p>
        <a href="${withBack('/agb', back)}">AGB lesen${icon('chevron-right', { size: 16 })}</a>
      </div>
    </div>
    ${consentForm(ctx, back)}
  </section>`;
}

function siteFooter() {
  return html`<footer class="site-foot">
    <a href="/agb">AGB</a><span aria-hidden="true">·</span><a href="/datenschutz">Datenschutz &amp; Cookies</a>
  </footer>`;
}

// Für Angemeldete: deutlich zeigen, dass die Seite gerade für alle anderen zu ist.
function maintenanceBanner(ctx) {
  const state = ctx.maintenance;
  return html`<div class="maint-banner" role="status">
    ${icon('wrench', { size: 18 })}
    <span><strong>Wartungsmodus ist an.</strong> ${state.onlyOwner ? `Nur ${state.ownerName || 'du'} kommt rein`
    : 'Nur angemeldete Konten kommen rein'} – alle anderen sehen die Wartungsseite.</span>
    <form method="post" action="/admin/wartung/aus" class="inline">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      <input type="hidden" name="back" value="${ctx.url || '/admin'}">
      <button class="btn btn-sm" type="submit">${icon('check', { size: 16 })}<span>Ausschalten</span></button>
    </form>
  </div>`;
}

/**
 * bare: ohne Menü, Fußzeile und Hinweise (Offline- und Wartungsseite).
 * headerAction: zusätzlicher Inhalt oben rechts (versteckter Login).
 */
function layout(ctx, { title, body, scripts = '', bare = false, headerAction = '' }) {
  const { isAdmin, csrf, flashes, user } = ctx;
  // Die Seiten AGB/Datenschutz zeigen die Zustimmung unten im Text statt im Dialog.
  const consentOpen = Boolean(ctx.consent && ctx.consent.needed);
  const askConsent = !bare && consentOpen && !ctx.consentInline;
  const inert = askConsent ? raw(' inert') : '';
  // Fehler bleiben stehen; Erfolgsmeldungen erscheinen als Einblendung, die
  // man auch sieht, wenn die Seite zu einem Auftrag weiter unten springt.
  const errors = flashes.filter((f) => f.type === 'error');
  const notices = flashes.filter((f) => f.type !== 'error');
  return html`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#171a1d" media="(prefers-color-scheme: dark)">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="Druckaufträge einreichen und die Warteschlange im Blick behalten.">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="3D-Druck">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="application-name" content="3D-Druck">
  <title>${title ? `${title} – ` : ''}3D-Druck-Warteschlange</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="${assetUrl('/style.css')}">
  <script>${raw(IMAGE_FALLBACK)}</script>
  <script src="${assetUrl('/app.js')}" defer></script>
</head>
<body>
  <header class="appbar"${inert}>
    <div class="wrap appbar-inner">
      <a class="brand" href="${isAdmin ? '/admin' : '/'}">
        <span class="brand-mark">${logo(34)}</span>
        <span class="brand-text">3D-Druck</span>
      </a>
      ${bare ? '' : html`<nav class="topnav" aria-label="Hauptmenü">${navItems(ctx, 'topnav-item')}</nav>`}
      ${headerAction}
      ${isAdmin ? html`
      <form method="post" action="/admin/logout" class="appbar-action">
        <input type="hidden" name="csrf_token" value="${csrf}">
        <button class="icon-btn" type="submit" title="Abmelden (angemeldet als ${user.displayName})" aria-label="Abmelden">
          ${icon('log-out')}
        </button>
      </form>` : ''}
    </div>
  </header>

  <main class="wrap page"${inert}>
    ${!bare && isAdmin && ctx.maintenance && ctx.maintenance.on ? maintenanceBanner(ctx) : ''}
    ${!bare && ctx.maintenanceBypass ? html`<div class="maint-banner" role="status">${icon('wrench', { size: 18 })}<span>${
      'Wartungsmodus ist an – du siehst die Seite, weil deine Internet-Adresse freigeschaltet ist.'}</span></div>` : ''}
    ${errors.length ? html`<div class="flashes">
      ${errors.map((f) => html`<div class="flash flash-error">${icon('alert-circle')}<span>${f.message}</span></div>`)}
    </div>` : ''}
    ${notices.length ? html`<div class="toasts" role="status">
      ${notices.map((f) => html`<div class="flash toast flash-${f.type}">${icon(FLASH_ICONS[f.type] || 'info')}<span>${f.message}</span></div>`)}
    </div>` : ''}
    ${body}
  </main>

  ${bare ? '' : html`
  <div${inert}>${siteFooter()}</div>
  ${consentOpen ? '' : installBanner()}
  <nav class="tabbar" aria-label="Hauptmenü"${inert}>${navItems(ctx, 'tab')}</nav>
  ${askConsent ? consentDialog(ctx) : ''}`}
  ${scripts}
</body>
</html>`;
}

// --- Bausteine -------------------------------------------------------------------

function pageHead(title, { iconName = null, sub = null, actions = '' } = {}) {
  return html`<div class="page-head">
    <div class="page-title">
      ${iconName ? html`<span class="page-icon">${icon(iconName, { size: 22 })}</span>` : ''}
      <div>
        <h1>${title}</h1>
        ${sub ? html`<p class="page-sub">${sub}</p>` : ''}
      </div>
    </div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

function sectionHead(title, { iconName = null, count = null, extra = '' } = {}) {
  return html`<div class="section-head">
    <h2>${iconName ? icon(iconName, { size: 20 }) : ''}<span>${title}</span>${
      count === null ? '' : html`<span class="count">${count}</span>`}</h2>
    ${extra}
  </div>`;
}

const chip = (iconName, text, cls = '') =>
  html`<span class="chip${cls ? ` ${cls}` : ''}">${icon(iconName, { size: 14 })}<span>${text}</span></span>`;

function linkChip(job, { warnMissing = true } = {}) {
  if (job.makerworldUrl) {
    return html`<a class="chip chip-link" href="${job.makerworldUrl}" target="_blank" rel="noopener noreferrer">${
      icon('external-link', { size: 14 })}<span>${isMakerworld(job.makerworldUrl) ? 'MakerWorld' : 'Link'}</span></a>`;
  }
  if (!warnMissing) return '';
  return html`<span class="chip chip-warn" title="Modell muss selbst besorgt oder erstellt werden">${
    icon('alert', { size: 14 })}<span>Kein Link</span></span>`;
}

function thumb(job, { pos = null, next = false } = {}) {
  return html`<div class="thumb" aria-hidden="true">
    ${icon('box', { size: 24 })}
    ${job.imageUrl ? html`<img src="${job.imageUrl}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
    ${pos ? html`<span class="pos${next ? ' pos-next' : ''}">${pos}</span>` : ''}
  </div>`;
}

function jobChips(ctx, job, { warnMissing = true, showDate = true } = {}) {
  return html`<div class="chips">
    ${chip('user', job.requester)}
    ${job.quantity > 1 ? chip('hash', `${job.quantity}×`) : ''}
    ${job.color ? chip('palette', job.color) : ''}
    ${linkChip(job, { warnMissing })}
    ${showDate ? chip('clock', ctx.date(job.createdAt), 'chip-muted') : ''}
  </div>`;
}

function jobNotes(job, { showMissingHint = false } = {}) {
  return html`
    ${job.notes ? html`<p class="note">${icon('note', { size: 16 })}<span>${job.notes}</span></p>` : ''}
    ${job.adminNote ? html`<p class="note note-admin">${icon('wrench', { size: 16 })}<span>${job.adminNote}</span></p>` : ''}
    ${showMissingHint && !job.makerworldUrl
    ? html`<p class="note note-warn">${icon('alert', { size: 16 })}<span>Kein MakerWorld-Link – das Modell musst du selbst besorgen oder erstellen.</span></p>`
    : ''}`;
}

function empty(iconName, text) {
  return html`<div class="empty">${icon(iconName, { size: 28 })}<p>${text}</p></div>`;
}

/** Ein Knopf, der eine Aktion für einen Auftrag abschickt. */
function action(ctx, job, name, label, {
  iconName = null, cls = 'btn', confirm = null, back = null, iconOnly = false,
} = {}) {
  return html`<form method="post" action="/admin/auftrag/${job.id}/${name}" class="inline"${
    confirm ? html` data-confirm="${confirm}"` : ''}>
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    ${back ? html`<input type="hidden" name="back" value="${back}">` : ''}
    <button type="submit" class="${cls}"${iconOnly ? html` title="${label}" aria-label="${label}"` : ''}>${
      iconName ? icon(iconName, { size: 18 }) : ''}${iconOnly ? '' : html`<span>${label}</span>`}</button>
  </form>`;
}

function jobFields(values, { admin = false, printedDate = false } = {}) {
  return html`
  <label class="field">
    <span class="label">${admin ? 'Für wen' : 'Dein Name'} <em>*</em></span>
    <input name="requester" maxlength="60" required autocomplete="name"
           value="${values.requester}" placeholder="z. B. Oma Inge">
  </label>

  <label class="field">
    <span class="label">MakerWorld-Link</span>
    <span class="input-icon">${icon('link', { size: 18 })}
      <input name="makerworld_url" type="text" inputmode="url" autocapitalize="off" spellcheck="false"
             maxlength="500" value="${values.makerworldUrl}" placeholder="https://makerworld.com/de/models/…"></span>
    <small>Hast du keinen? Kein Problem – beschreib unten einfach, was du brauchst.</small>
  </label>

  <label class="field">
    <span class="label">Was soll gedruckt werden?</span>
    <input name="title" maxlength="120" value="${values.title}" placeholder="z. B. Handyhalter fürs Auto">
    <small>Bei einem MakerWorld-Link darf das leer bleiben.</small>
  </label>

  <div class="row">
    <label class="field narrow">
      <span class="label">Anzahl</span>
      <input name="quantity" type="number" inputmode="numeric" min="1" max="99" value="${values.quantity || 1}">
    </label>
    <label class="field">
      <span class="label">Farbe / Material</span>
      <input name="color" maxlength="60" value="${values.color}" placeholder="z. B. Rot, egal">
    </label>
  </div>

  ${printedDate ? html`
  <label class="field">
    <span class="label">Gedruckt am <em>*</em></span>
    <input name="printed_at" type="date" required value="${values.printedAt}">
  </label>` : ''}

  <label class="field">
    <span class="label">Beschreibung &amp; Wünsche</span>
    <textarea name="notes" rows="4" maxlength="1000"
              placeholder="Größe, Maße, wofür es ist, bis wann du es brauchst …">${values.notes}</textarea>
  </label>

  ${admin ? html`
  <label class="field">
    <span class="label">Vorschaubild-Link</span>
    <input name="image_url" type="text" inputmode="url" autocapitalize="off" spellcheck="false"
           maxlength="500" value="${values.imageUrl}" placeholder="https://… (wird bei MakerWorld automatisch versucht)">
  </label>
  <label class="field">
    <span class="label">Admin-Notiz <small>(nur für dich &amp; Discord)</small></span>
    <textarea name="admin_note" rows="2" maxlength="1000"
              placeholder="z. B. PETG, 0,2 mm, Stützen nötig">${values.adminNote}</textarea>
  </label>` : ''}`;
}

// --- Öffentliche Seiten ---------------------------------------------------------

function queueList(ctx, queue, topN) {
  if (!queue.length) return empty('layers', 'Gerade ist nichts in der Warteschlange.');
  return html`<ol class="joblist">
    ${queue.map((job, i) => html`
      <li class="job${i < topN ? ' job-next' : ''}">
        ${thumb(job, { pos: i + 1, next: i < topN })}
        <div class="job-body">
          <h3 class="job-title">${job.title}</h3>
          ${jobChips(ctx, job, { warnMissing: false, showDate: false })}
        </div>
      </li>`)}
  </ol>`;
}

function doneList(ctx, done) {
  return html`<ul class="simple-list">
    ${done.map((job) => html`<li>${icon('check-circle', { size: 18, className: 'ok' })}<span><strong>${job.title}</strong>
      <span class="muted">für ${job.requester} · ${ctx.day(job.finishedAt)}</span></span></li>`)}
  </ul>`;
}

function index(ctx, { values, stamp, queue, done, topN }) {
  const body = html`
<div class="columns">
  <section class="card card-hero" id="einreichen">
    <div class="hero-icon">${logo(52)}</div>
    <h1>Druckauftrag einreichen</h1>
    <p class="lead">Füg einen <strong>MakerWorld-Link</strong> ein oder beschreib, was du gedruckt haben möchtest.
      Jede Anfrage wird erst geprüft und freigegeben – danach taucht sie in der Warteschlange auf.</p>
    <form method="post" action="/auftrag" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      <input type="hidden" name="ts" value="${stamp}">
      <div class="hp" aria-hidden="true">
        <label>Website <input name="website" tabindex="-1" autocomplete="off"></label>
      </div>
      ${jobFields(values)}
      <button class="btn btn-primary btn-block btn-lg" type="submit">${icon('send', { size: 18 })}<span>Auftrag abschicken</span></button>
    </form>
  </section>

  <div class="stack desktop-only">
    <section class="card" id="warteschlange">
      ${sectionHead('Warteschlange', { iconName: 'layers', count: queue.length })}
      ${queueList(ctx, queue, topN)}
    </section>
    ${done.length ? html`
    <section class="card">
      ${sectionHead('Zuletzt gedruckt', { iconName: 'check-circle' })}
      ${doneList(ctx, done)}
    </section>` : ''}
  </div>
</div>`;
  return layout(ctx, { body });
}

function publicQueue(ctx, { queue, done, topN }) {
  const body = html`
${pageHead('Warteschlange', { iconName: 'layers', sub: 'Das wird als Nächstes gedruckt.' })}
<section class="card">
  ${sectionHead('Als Nächstes', { iconName: 'printer', count: queue.length })}
  ${queueList(ctx, queue, topN)}
</section>
${done.length ? html`
<section class="card">
  ${sectionHead('Zuletzt gedruckt', { iconName: 'check-circle' })}
  ${doneList(ctx, done)}
</section>` : ''}`;
  return layout(ctx, { title: 'Warteschlange', body });
}

// --- Anmelden & Konten ------------------------------------------------------------------

function passwordFields({ current = false, autocomplete = 'new-password' } = {}) {
  return html`
    ${current ? html`
    <label class="field">
      <span class="label">Bisheriges Passwort <em>*</em></span>
      <input name="current_password" type="password" required autocomplete="current-password">
    </label>` : ''}
    <div class="row row-even">
      <label class="field">
        <span class="label">${current ? 'Neues Passwort' : 'Passwort'} <em>*</em> <small>(mind. 8 Zeichen)</small></span>
        <input name="password" type="password" required minlength="8" maxlength="200" autocomplete="${autocomplete}">
      </label>
      <label class="field">
        <span class="label">Nochmal <em>*</em></span>
        <input name="password_repeat" type="password" required minlength="8" maxlength="200" autocomplete="${autocomplete}">
      </label>
    </div>`;
}

function accountFields(values) {
  return html`
    <div class="row row-even">
      <label class="field">
        <span class="label">Benutzername <em>*</em> <small>(zum Anmelden)</small></span>
        <input name="username" required minlength="3" maxlength="40"
               autocapitalize="off" spellcheck="false" autocomplete="off" value="${values.username}" placeholder="z. B. christoph">
      </label>
      <label class="field">
        <span class="label">Name <small>(wird angezeigt)</small></span>
        <input name="display_name" maxlength="60" value="${values.displayName}" placeholder="z. B. Christoph">
      </label>
    </div>`;
}

function authCard(title, sub, content, { iconName = null } = {}) {
  return html`
<section class="card auth-card">
  ${iconName ? html`<div class="auth-mark auth-mark-icon">${icon(iconName, { size: 28 })}</div>`
    : html`<div class="auth-mark">${logo(56)}</div>`}
  <h1>${title}</h1>
  ${sub ? html`<p class="lead">${sub}</p>` : ''}
  ${content}
</section>`;
}

function adminLogin(ctx, { username }) {
  const body = authCard('Anmelden', 'Für den Admin-Bereich der Druck-Warteschlange.', html`
  <form method="post" action="/admin/login" class="form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <label class="field">
      <span class="label">Benutzername</span>
      <span class="input-icon">${icon('user', { size: 18 })}
        <input name="username" required autocapitalize="off" spellcheck="false" autocomplete="username"
               value="${username}"${username ? '' : html` autofocus`}></span>
    </label>
    <label class="field">
      <span class="label">Passwort</span>
      <span class="input-icon">${icon('lock', { size: 18 })}
        <input name="password" type="password" required autocomplete="current-password"${username ? html` autofocus` : ''}></span>
    </label>
    <button class="btn btn-primary btn-block btn-lg" type="submit">${icon('log-in', { size: 18 })}<span>Anmelden</span></button>
  </form>`);
  return layout(ctx, { title: 'Anmelden', body });
}

function adminSetup(ctx, { setupEnabled, values }) {
  const body = authCard('Willkommen!', html`Leg dein Konto für den Admin-Bereich an. Weitere Konten, z. B. für
    jemanden, der dir hilft, kannst du danach unter <strong>Konten</strong> anlegen.`, setupEnabled ? html`
  <form method="post" action="/admin/einrichten" class="form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <label class="field">
      <span class="label">Einrichtungs-Code <em>*</em> <small>(dein <code>ADMIN_PASSWORD</code> aus den Plesk-Einstellungen)</small></span>
      <span class="input-icon">${icon('key', { size: 18 })}<input name="setup_code" type="password" required autocomplete="off"></span>
    </label>
    ${accountFields(values)}
    ${passwordFields()}
    <button class="btn btn-primary btn-block btn-lg" type="submit">${icon('user-plus', { size: 18 })}<span>Konto anlegen</span></button>
  </form>` : html`
  <div class="flash flash-error">${icon('alert-circle')}<span>Zum Einrichten brauchst du einen Einrichtungs-Code: Trag in Plesk bei den
    Umgebungsvariablen <code>ADMIN_PASSWORD</code> ein, starte die App neu und lade diese Seite nochmal.</span></div>`);
  return layout(ctx, { title: 'Einrichten', body });
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2)
  .map((part) => part[0]).join('').toUpperCase();

function adminUsers(ctx, { users, me, newValues, openNew, legal: legalInfo }) {
  const body = html`
${pageHead('Konten', { iconName: 'users', sub: html`Angemeldet als <strong>${me.displayName}</strong> (${me.username})` })}

<section class="card">
  ${sectionHead('Alle Konten', { iconName: 'users', count: users.length })}
  <p class="muted small">Jedes Konto darf alles im Admin-Bereich: freigeben, drucken, Archiv, Konten verwalten.
    Die Seite zum Einreichen ist für alle offen – dafür braucht niemand ein Konto.</p>
  <ul class="joblist">
    ${users.map((user) => html`
      <li class="job" id="nutzer-${user.id}">
        <div class="avatar" aria-hidden="true">${initials(user.displayName)}</div>
        <div class="job-body">
          <h3 class="job-title">${user.displayName} <span class="muted small">${user.username}</span>
            ${user.id === me.id ? html`<span class="chip chip-link chip-static">du</span>` : ''}</h3>
          <div class="chips">
            ${chip('calendar', `angelegt ${ctx.day(user.createdAt)}`, 'chip-muted')}
            ${chip('log-in', user.lastLoginAt ? `zuletzt ${ctx.date(user.lastLoginAt)}` : 'noch nie angemeldet', 'chip-muted')}
          </div>
          <details class="disclosure">
            <summary>${icon('lock', { size: 16 })}<span>${user.id === me.id ? 'Mein Passwort ändern' : 'Neues Passwort setzen'}</span></summary>
            <form method="post" action="/admin/nutzer/${user.id}/passwort" class="form">
              <input type="hidden" name="csrf_token" value="${ctx.csrf}">
              ${passwordFields({ current: user.id === me.id })}
              <button class="btn btn-primary" type="submit">${icon('check', { size: 18 })}<span>Passwort speichern</span></button>
            </form>
          </details>
          ${user.id === me.id ? '' : html`
          <div class="actions">
            <form method="post" action="/admin/nutzer/${user.id}/loeschen" class="inline"
                  data-confirm="${`Das Konto von ${user.displayName} wirklich löschen?`}">
              <input type="hidden" name="csrf_token" value="${ctx.csrf}">
              <button class="btn btn-sm btn-danger" type="submit">${icon('user-x', { size: 16 })}<span>Konto löschen</span></button>
            </form>
          </div>`}
        </div>
      </li>`)}
  </ul>
</section>

<section class="card">
  <details class="disclosure disclosure-lg"${openNew ? html` open` : ''}>
    <summary>${icon('user-plus', { size: 18 })}<span>Neues Konto anlegen</span></summary>
    <form method="post" action="/admin/nutzer/neu" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      ${accountFields(newValues)}
      ${passwordFields()}
      <button class="btn btn-primary" type="submit">${icon('user-plus', { size: 18 })}<span>Konto anlegen</span></button>
    </form>
  </details>
</section>

<section class="card" id="rechtliches">
  ${sectionHead('AGB & Datenschutz', { iconName: 'scale' })}
  <p class="muted">Alle Besucher stimmen beim ersten Besuch den AGB und dem Cookie-Hinweis zu.
    Aktuell gilt Version ${legalInfo.version}${legalInfo.updatedAt ? html` vom ${ctx.day(legalInfo.updatedAt)}` : ''}.</p>
  <div class="actions">
    <a class="btn" href="/admin/rechtliches">${icon('pencil', { size: 18 })}<span>Texte bearbeiten</span></a>
    <a class="btn btn-ghost" href="/agb">${icon('scale', { size: 18 })}<span>AGB ansehen</span></a>
  </div>
</section>`;
  return layout(ctx, { title: 'Konten', body });
}

// Verlauf: Aktion -> [Icon, Text, Farbe]
const LOG_KINDS = {
  anfrage: ['inbox', 'Neue Anfrage', 'info'],
  freigegeben: ['check-circle', 'Freigegeben', 'ok'],
  abgelehnt: ['ban', 'Abgelehnt', 'danger'],
  gedruckt: ['printer', 'Gedruckt', 'ok'],
  zurueckgeholt: ['undo', 'Zurück in die Warteschlange', 'neutral'],
  freigabe_zurueck: ['undo', 'Freigabe zurückgenommen', 'neutral'],
  geloescht: ['trash', 'Gelöscht', 'danger'],
  bearbeitet: ['pencil', 'Bearbeitet', 'neutral'],
  nochmal: ['repeat', 'Nochmal drucken', 'info'],
  eigener_auftrag: ['list-plus', 'Eigener Auftrag', 'info'],
  eingetragen: ['archive', 'Ins Archiv eingetragen', 'neutral'],
  importiert: ['archive', 'Links ins Archiv übernommen', 'neutral'],
  login: ['log-in', 'Angemeldet', 'neutral'],
  login_fehlgeschlagen: ['alert', 'Falsches Passwort', 'warn'],
  gesperrt: ['lock', 'Zu viele Fehlversuche – kurz gesperrt', 'danger'],
  eingerichtet: ['sparkles', 'Ersteinrichtung', 'ok'],
  nutzer_angelegt: ['user-plus', 'Konto angelegt', 'info'],
  nutzer_geloescht: ['user-x', 'Konto gelöscht', 'danger'],
  passwort_geaendert: ['key', 'Passwort geändert', 'neutral'],
  rechtliches_geaendert: ['scale', 'AGB & Datenschutz geändert', 'info'],
  wartung_an: ['wrench', 'Wartungsmodus eingeschaltet', 'warn'],
  wartung_aus: ['wrench', 'Wartungsmodus ausgeschaltet', 'ok'],
};

function adminLog(ctx, { entries }) {
  const body = html`
${pageHead('Verlauf', { iconName: 'history', sub: `Die letzten ${entries.length} Einträge – wer hat wann was gemacht.` })}
<section class="card">
  ${entries.length ? html`
  <ul class="log-list">
    ${entries.map((entry) => {
      const [iconName, label, tone] = LOG_KINDS[entry.action] || ['info', entry.action, 'neutral'];
      return html`
      <li>
        <span class="log-icon tone-${tone}">${icon(iconName, { size: 16 })}</span>
        <div class="log-body">
          <div class="log-what">${label}${entry.jobTitle ? html` <strong>${entry.jobTitle}</strong>` : ''}${
            entry.details ? html` <span class="muted">· ${entry.details}</span>` : ''}</div>
          <div class="log-meta"><span>${entry.userName || '–'}</span><time>${ctx.date(entry.createdAt)}</time></div>
        </div>
      </li>`;
    })}
  </ul>` : empty('history', 'Noch nichts passiert.')}
</section>`;
  return layout(ctx, { title: 'Verlauf', body });
}

// --- Admin: Aufträge -----------------------------------------------------------------

function adminDashboard(ctx, {
  pending, queue, finished, discord, topN, newValues, openNew, legalMissingContact, myAddress,
}) {
  const discordOk = discord.configured && !discord.error;
  const discordLabel = discord.error ? 'Fehler' : discord.configured ? 'aktiv' : 'nicht eingerichtet';
  const body = html`
${pageHead('Aufträge', {
    iconName: 'inbox',
    sub: html`${pending.length} warten auf Freigabe · ${queue.length} in der Warteschlange`,
    actions: html`${ctx.maintenance && ctx.maintenance.on ? html`<a class="status-pill is-warn" href="#wartung">${
      icon('wrench', { size: 16 })}<span>Wartung an</span></a>` : ''}<a class="status-pill ${discordOk ? 'is-ok' : 'is-warn'}" href="#discord">${
      icon('message', { size: 16 })}<span>Discord ${discordLabel}</span></a>`,
  })}

${legalMissingContact ? html`<p class="note note-warn page-note">${icon('scale', { size: 16 })}<span>${
    'Im Datenschutz-Hinweis fehlt noch, wer verantwortlich ist. '}<a href="/admin/rechtliches">Jetzt Namen und Kontakt eintragen</a>.</span></p>` : ''}

<section class="card" id="anfragen">
  ${sectionHead('Warten auf Freigabe', { iconName: 'inbox', count: pending.length })}
  ${pending.length ? html`<ul class="joblist">
    ${pending.map((job) => html`
      <li class="job job-admin" id="auftrag-${job.id}">
        ${thumb(job)}
        <div class="job-body">
          <h3 class="job-title">${job.title}</h3>
          ${jobChips(ctx, job, { warnMissing: false })}
          ${jobNotes(job, { showMissingHint: true })}
          <div class="actions">
            ${action(ctx, job, 'approve', 'Freigeben', { iconName: 'check', cls: 'btn btn-primary' })}
            <a class="btn" href="/admin/auftrag/${job.id}/bearbeiten">${icon('pencil', { size: 18 })}<span>Bearbeiten</span></a>
            ${action(ctx, job, 'reject', 'Ablehnen', { iconName: 'x', cls: 'btn btn-danger', confirm: `„${job.title}“ ablehnen?` })}
          </div>
        </div>
      </li>`)}
  </ul>` : empty('check-circle', 'Keine neuen Anfragen.')}
</section>

<section class="card" id="warteschlange">
  ${sectionHead('Warteschlange', { iconName: 'layers', count: queue.length })}
  <p class="muted small">Die obersten ${topN} gehen an Discord – aber nur, wenn sich an ihnen etwas ändert.</p>
  ${queue.length ? html`<ol class="joblist">
    ${queue.map((job, i) => html`
      <li class="job job-admin${i < topN ? ' job-next' : ''}" id="auftrag-${job.id}">
        ${thumb(job, { pos: i + 1, next: i < topN })}
        <div class="job-body">
          <div class="job-head">
            <h3 class="job-title">${job.title}</h3>
            ${i < topN ? html`<span class="chip chip-discord chip-static">${icon('message', { size: 14 })}<span>Discord</span></span>` : ''}
          </div>
          ${jobChips(ctx, job, { warnMissing: false })}
          ${jobNotes(job, { showMissingHint: true })}
          <div class="actions">
            <span class="segmented" role="group" aria-label="Reihenfolge">
              ${action(ctx, job, 'top', 'Ganz nach oben', { iconName: 'chevrons-up', cls: 'seg', iconOnly: true })}
              ${action(ctx, job, 'up', 'Eins hoch', { iconName: 'chevron-up', cls: 'seg', iconOnly: true })}
              ${action(ctx, job, 'down', 'Eins runter', { iconName: 'chevron-down', cls: 'seg', iconOnly: true })}
              ${action(ctx, job, 'bottom', 'Ganz nach unten', { iconName: 'chevrons-down', cls: 'seg', iconOnly: true })}
            </span>
            ${action(ctx, job, 'done', 'Gedruckt', { iconName: 'check', cls: 'btn btn-primary' })}
            <details class="more">
              <summary class="btn btn-ghost" aria-label="Mehr Aktionen">${icon('more', { size: 18 })}</summary>
              <div class="more-menu">
                <a class="btn btn-ghost" href="/admin/auftrag/${job.id}/bearbeiten">${icon('pencil', { size: 18 })}<span>Bearbeiten</span></a>
                ${action(ctx, job, 'unapprove', 'Freigabe zurücknehmen', { iconName: 'undo', cls: 'btn btn-ghost' })}
                ${action(ctx, job, 'delete', 'Löschen', { iconName: 'trash', cls: 'btn btn-ghost btn-ghost-danger', confirm: `„${job.title}“ wirklich löschen?` })}
              </div>
            </details>
          </div>
        </div>
      </li>`)}
  </ol>` : empty('layers', 'Die Warteschlange ist leer.')}

  <details class="disclosure disclosure-lg"${openNew ? html` open` : ''}>
    <summary>${icon('list-plus', { size: 18 })}<span>Eigenen Auftrag direkt in die Warteschlange</span></summary>
    <p class="muted small">Schon gedruckt? Dann <a href="/admin/archiv#eintragen">trag ihn direkt im Archiv ein</a>.</p>
    <form method="post" action="/admin/auftrag/neu" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      ${jobFields(newValues, { admin: true })}
      <button class="btn btn-primary" type="submit">${icon('plus', { size: 18 })}<span>Hinzufügen</span></button>
    </form>
  </details>
</section>

<section class="card" id="erledigt">
  ${sectionHead('Erledigt & abgelehnt', {
    iconName: 'check-circle',
    extra: html`<a class="link-more" href="/admin/archiv">Archiv ${icon('chevron-right', { size: 16 })}</a>`,
  })}
  ${finished.length ? html`<ul class="compact-list">
    ${finished.map((job) => html`
      <li id="auftrag-${job.id}">
        ${job.status === 'done'
    ? icon('check-circle', { size: 20, className: 'ok', label: 'gedruckt' })
    : icon('ban', { size: 20, className: 'danger', label: 'abgelehnt' })}
        <div class="compact-body">
          <strong>${job.title}</strong>
          <span class="muted small">für ${job.requester} · ${ctx.date(job.finishedAt)}</span>
        </div>
        <div class="compact-actions">
          ${action(ctx, job, 'restore', 'Zurück in die Warteschlange', { iconName: 'undo', cls: 'icon-btn', iconOnly: true })}
          ${action(ctx, job, 'delete', 'Löschen', { iconName: 'trash', cls: 'icon-btn icon-btn-danger', iconOnly: true, confirm: `„${job.title}“ wirklich löschen?` })}
        </div>
      </li>`)}
  </ul>` : empty('check-circle', 'Noch nichts erledigt.')}
</section>

${maintenanceCard(ctx, myAddress)}

<section class="card" id="discord">
  ${sectionHead('Discord', { iconName: 'message', extra: discord.configured
    ? html`<span class="status-pill ${discordOk ? 'is-ok' : 'is-warn'}">${discord.bot ? 'Bot' : 'Webhook'}</span>` : '' })}
  ${discord.configured && discord.bot ? html`
  <dl class="facts">
    <dt>Warteschlange</dt><dd>eine Nachricht mit den obersten ${discord.topN} Aufträgen – wird bei jeder Änderung
      bearbeitet${discord.boardLive ? '' : ' (wird beim nächsten Mal angelegt)'}</dd>
    <dt>Neue Anfragen</dt><dd>werden sofort gemeldet${discord.separateRequestsChannel ? ' (eigener Kanal)' : ''}${
      discord.pingsUser ? ', mit Ping an dich' : ''}; nach Freigeben, Ablehnen oder Drucken wird die Nachricht angepasst</dd>
    <dt>Symbole</dt><dd>${discord.emojis.uploaded === discord.emojis.total ? 'alle hochgeladen'
      : `${discord.emojis.uploaded} von ${discord.emojis.total} hochgeladen – bis dahin normale Emojis`}${
      discord.emojis.error ? html` <span class="error-text">(${discord.emojis.error})</span>` : ''}</dd>
    <dt>Zuletzt gesendet</dt><dd>${discord.lastSentAt ? ctx.date(discord.lastSentAt) : 'noch nie'}</dd>
    ${discord.error ? html`<dt>Letzter Fehler</dt><dd class="error-text">${ctx.date(discord.error.at)} – ${discord.error.message}</dd>` : ''}
  </dl>` : discord.configured ? html`
  <dl class="facts">
    <dt>Warteschlange</dt><dd>die obersten ${discord.topN} Aufträge, sobald sich an ihnen etwas ändert</dd>
    <dt>Neue Anfragen</dt><dd>werden sofort gemeldet${discord.separateRequestsChannel ? ' (eigener Kanal)' : ''}${
      discord.pingsUser ? ', mit Ping an dich' : ''}</dd>
    <dt>Zuletzt gesendet</dt><dd>${discord.lastSentAt ? ctx.date(discord.lastSentAt) : 'noch nie'}</dd>
    ${discord.error ? html`<dt>Letzter Fehler</dt><dd class="error-text">${ctx.date(discord.error.at)} – ${discord.error.message}</dd>` : ''}
  </dl>` : ''}
  ${discord.configured ? html`
  ${discord.hasPublicUrl ? '' : html`<p class="note note-warn">${icon('info', { size: 16 })}<span>Tipp: Trag <code>PUBLIC_URL</code> ein
    (z. B. <code>https://druck.deine-domain.de</code>) – dann gibt es in Discord Vorschaubilder und Knöpfe direkt zur Freigabe.</span></p>`}
  <div class="actions">
    <form method="post" action="/admin/discord/senden" class="inline">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      <button class="btn" type="submit">${icon(discord.bot ? 'refresh' : 'send', { size: 18 })}<span>${
        discord.bot ? 'Warteschlange neu posten' : 'Jetzt an Discord senden'}</span></button>
    </form>
    ${discord.bot && discord.inviteUrl ? html`<a class="btn btn-ghost" href="${discord.inviteUrl}" target="_blank" rel="noopener noreferrer">${
      icon('user-plus', { size: 18 })}<span>Bot in Server einladen</span></a>` : ''}
  </div>` : html`
  <p>Discord ist noch nicht eingerichtet. Am schönsten mit einem Bot: Trag den Bot-Token als
    <code>DISCORD_BOT_TOKEN</code> und die Kanal-ID als <code>DISCORD_CHANNEL_ID</code> ein.
    Einfacher, aber ohne Bearbeiten: eine Webhook-URL als <code>DISCORD_WEBHOOK_URL</code>.</p>`}
</section>`;
  return layout(ctx, { title: 'Aufträge', body });
}

function adminEdit(ctx, { job, values, back }) {
  const body = html`
<a class="back-link" href="${back}#auftrag-${job.id}">${icon('arrow-left', { size: 18 })}<span>Zurück</span></a>
${pageHead(job.status === 'done' ? 'Druck bearbeiten' : 'Auftrag bearbeiten', { iconName: 'pencil' })}
<section class="card card-narrow">
  <form method="post" action="/admin/auftrag/${job.id}/bearbeiten" class="form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <input type="hidden" name="back" value="${back}">
    ${jobFields(values, { admin: true, printedDate: job.status === 'done' })}
    <button class="btn btn-primary btn-lg" type="submit">${icon('check', { size: 18 })}<span>Speichern</span></button>
  </form>
</section>`;
  return layout(ctx, { title: 'Auftrag bearbeiten', body });
}

// --- Archiv ------------------------------------------------------------------------------

/** „5 Drucke · 14 Teile · 4 Personen“ – die Skripte passen Zahl und Einzahl/Mehrzahl live an. */
function statsLine(stats) {
  const stat = (id, iconName, count, one, many) => html`<span class="stat">${icon(iconName, { size: 16 })}${
    html`<strong id="stat-${id}">${count}</strong>`} <span data-one="${one}" data-many="${many}">${
    count === 1 ? one : many}</span></span>`;
  return html`<p class="archive-stats">
    ${stat('drucke', 'printer', stats.prints, 'Druck', 'Drucke')}
    ${stat('teile', 'box', stats.pieces, 'Teil', 'Teile')}
    ${stat('personen', 'users', stats.people, 'Person', 'Personen')}
  </p>`;
}

function searchField(attrs) {
  return html`<span class="search">${icon('search', { size: 18 })}${attrs}</span>`;
}

function archiveEntry(ctx, job, { text, visible = true, admin = true, back = '', day }) {
  const editLink = `/admin/auftrag/${job.id}/bearbeiten?back=${encodeURIComponent(back)}`;
  const chips = html`<div class="chips">
    ${chip('calendar', day(job.finishedAt))}
    ${chip('user', job.requester)}
    ${job.quantity > 1 ? chip('hash', `${job.quantity}×`) : ''}
    ${job.color ? chip('palette', job.color) : ''}
    ${linkChip(job, { warnMissing: false })}
  </div>`;
  const content = html`
        ${thumb(job)}
        <div class="job-body">
          <h3 class="job-title">${job.title}</h3>
          ${chips}
          ${jobNotes(job)}
          ${admin ? html`
          <div class="actions">
            ${action(ctx, job, 'nochmal', 'Nochmal drucken', { iconName: 'repeat', cls: 'btn btn-primary btn-sm', back })}
            <a class="btn btn-sm" href="${editLink}">${icon('pencil', { size: 16 })}<span>Bearbeiten</span></a>
            ${action(ctx, job, 'delete', 'Löschen', {
    iconName: 'trash', cls: 'icon-btn icon-btn-danger', iconOnly: true, confirm: `„${job.title}“ aus dem Archiv löschen?`, back,
  })}
          </div>` : ''}
        </div>`;
  if (!admin) {
    return html`
      <li class="job" data-search="${text}" data-person="${job.requester}" data-date="${job.finishedAt}"
          data-title="${job.title}" data-qty="${job.quantity || 1}">${content}
      </li>`;
  }
  return html`
      <li class="job job-admin" id="auftrag-${job.id}" data-search="${text}" data-qty="${job.quantity || 1}"
          data-person="${job.requester}"${visible ? '' : html` hidden`}>${content}
      </li>`;
}

function adminArchive(ctx, {
  q, person, sort, entries, stats, total, people, back, newValues, importValues, openNew, openImport,
}) {
  const sortOptions = [['neu', 'Neueste'], ['alt', 'Älteste'], ['titel', 'Titel A–Z'], ['person', 'Nach Person']];
  const body = html`
${pageHead('Druck-Archiv', {
    iconName: 'archive',
    sub: 'Alles, was du je gedruckt hast.',
    actions: html`
      <a class="btn btn-primary btn-sm" href="#eintragen" data-open="eintragen">${icon('plus', { size: 16 })}<span>Druck eintragen</span></a>
      ${total ? html`
      <a class="btn btn-sm" href="/admin/archiv.html" download
         title="Eine Datei mit allen Drucken – inklusive Suche, auch offline">${icon('file-down', { size: 16 })}<span>HTML mit Suche</span></a>
      <a class="btn btn-sm" href="/admin/archiv.csv${back.includes('?') ? back.slice(back.indexOf('?')) : ''}"
         download title="Aktuelle Auswahl als Tabelle für Excel">${icon('table', { size: 16 })}<span>CSV</span></a>` : ''}`,
  })}

<section class="card" id="eintragen">
  <details class="disclosure disclosure-lg"${openNew ? html` open` : ''}>
    <summary>${icon('plus-circle', { size: 18 })}<span>Druck eintragen</span></summary>
    <p class="muted small">Für alles, was nicht über die Warteschlange lief – z. B. was du für dich selbst
      gedruckt hast, oder ältere Drucke von früher.</p>
    <form method="post" action="/admin/archiv/eintragen" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      ${jobFields(newValues, { admin: true, printedDate: true })}
      <button class="btn btn-primary" type="submit">${icon('archive', { size: 18 })}<span>Ins Archiv aufnehmen</span></button>
    </form>
  </details>

  <details class="disclosure disclosure-lg"${openImport ? html` open` : ''}>
    <summary>${icon('link', { size: 18 })}<span>Mehrere MakerWorld-Links auf einmal eintragen</span></summary>
    <form method="post" action="/admin/archiv/import" class="form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      <label class="field">
        <span class="label">Links <em>*</em> <small>(einer pro Zeile, höchstens 50)</small></span>
        <textarea name="links" rows="6" required spellcheck="false"
                  placeholder="https://makerworld.com/de/models/…&#10;https://makerworld.com/de/models/…">${importValues.links}</textarea>
      </label>
      <div class="row row-even">
        <label class="field">
          <span class="label">Für wen <em>*</em></span>
          <input name="requester" maxlength="60" required value="${importValues.requester}">
        </label>
        <label class="field">
          <span class="label">Gedruckt am <em>*</em></span>
          <input name="printed_at" type="date" required value="${importValues.printedAt}">
        </label>
      </div>
      <button class="btn btn-primary" type="submit">${icon('archive', { size: 18 })}<span>Alle ins Archiv aufnehmen</span></button>
    </form>
  </details>
</section>

<section class="card">
  <form method="get" action="/admin/archiv" class="archive-filters" role="search">
    ${searchField(html`<input id="archiv-suche" name="q" type="search" value="${q}" autocomplete="off"
           placeholder="Suchen, z. B. Drache, Mama, 2025" aria-label="Archiv durchsuchen">`)}
    <select name="person" aria-label="Person">
      <option value="">Alle Personen</option>
      ${people.map((p) => html`<option value="${p.name}"${p.name.toLowerCase() === person.toLowerCase() ? html` selected` : ''}>${p.name} (${p.count})</option>`)}
    </select>
    <select name="sort" aria-label="Sortierung">
      ${sortOptions.map(([value, label]) => html`<option value="${value}"${value === sort ? html` selected` : ''}>${label}</option>`)}
    </select>
    <noscript><button class="btn" type="submit">Suchen</button></noscript>
  </form>

  ${statsLine(stats)}

  ${total ? html`
  <ul class="joblist" id="archiv-liste">
    ${entries.map(({ job, text, visible }) => archiveEntry(ctx, job, { text, visible, back, day: ctx.day }))}
  </ul>
  <p class="empty" id="archiv-leer"${stats.prints ? html` hidden` : ''}>Nichts gefunden – versuch es mit einem anderen Suchwort.</p>`
    : empty('archive', html`Noch keine Drucke im Archiv. Sobald du in der Warteschlange auf <strong>Gedruckt</strong>
      tippst, landet der Auftrag hier. Eigene oder ältere Drucke trägst du oben mit <strong>Druck eintragen</strong> ein.`)}
</section>`;
  return layout(ctx, { title: 'Druck-Archiv', body, scripts: html`<script src="${assetUrl('/archiv.js')}" defer></script>` });
}

/** Eigenständige HTML-Datei mit allen Drucken – mit Suche, Filter und Sortierung, auch offline. */
function archiveExport({ entries, people, stats, exportedAt, day }) {
  return html`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Druck-Archiv – Stand ${exportedAt}</title>
  <style>
${raw(EXPORT_CSS)}
    .page { padding-top: 24px; padding-bottom: 32px; }
    .export-foot { margin: 8px 0 32px; }
    @media print {
      body { background: #fff; color: #000; }
      .archive-filters, .export-foot { display: none !important; }
      .card { box-shadow: none; border: 0; padding: 0; }
      .job { break-inside: avoid; }
    }
  </style>
  <script>${raw(IMAGE_FALLBACK)}</script>
</head>
<body>
  <main class="wrap page">
    ${pageHead('Druck-Archiv', { iconName: 'archive', sub: `Stand: ${exportedAt}` })}
    <section class="card">
      <form id="filter" class="archive-filters" role="search">
        ${searchField(html`<input id="suche" type="search" autocomplete="off" autofocus
               placeholder="Suchen, z. B. Drache, Mama, 2025" aria-label="Archiv durchsuchen">`)}
        <select id="person" aria-label="Person">
          <option value="">Alle Personen</option>
          ${people.map((p) => html`<option value="${p.name}">${p.name} (${p.count})</option>`)}
        </select>
        <select id="sortierung" aria-label="Sortierung">
          <option value="neu">Neueste</option>
          <option value="alt">Älteste</option>
          <option value="titel">Titel A–Z</option>
          <option value="person">Nach Person</option>
        </select>
      </form>

      ${statsLine(stats)}

      <ul class="joblist" id="liste">
        ${entries.map(({ job, text }) => archiveEntry(null, job, { text, admin: false, day }))}
      </ul>
      <p class="empty" id="leer"${entries.length ? html` hidden` : ''}>${
        entries.length ? 'Nichts gefunden – versuch es mit einem anderen Suchwort.' : 'Noch keine Drucke im Archiv.'}</p>
    </section>
    <p class="muted small export-foot">Exportiert aus der 3D-Druck-Warteschlange. Diese Datei funktioniert
      ohne Internet – nur die Vorschaubilder brauchen eine Verbindung.</p>
  </main>
  <script>
${raw(EXPORT_JS)}
  </script>
</body>
</html>`;
}

const LEGAL_PAGES = {
  agb: { title: 'AGB', sub: 'Allgemeine Geschäftsbedingungen der Druck-Warteschlange', iconName: 'scale', field: 'agb' },
  datenschutz: { title: 'Datenschutz & Cookies', sub: 'Welche Daten gespeichert werden – und welche nicht', iconName: 'shield', field: 'datenschutz' },
};

function legalPage(ctx, { kind, legal: legalInfo, back }) {
  const page = LEGAL_PAGES[kind];
  const other = kind === 'agb' ? { href: '/datenschutz', label: 'Datenschutz & Cookies' } : { href: '/agb', label: 'AGB' };
  const body = html`
${pageHead(page.title, {
    iconName: page.iconName,
    sub: html`${page.sub} · Stand ${legalInfo.updatedAt ? ctx.day(legalInfo.updatedAt) : 'Vorlage'} (Version ${legalInfo.version})`,
    actions: ctx.isAdmin ? html`<a class="btn" href="/admin/rechtliches">${icon('pencil', { size: 18 })}<span>Bearbeiten</span></a>` : '',
  })}
<article class="card legal">${legal.render(legalInfo[page.field])}</article>
${ctx.consent && ctx.consent.needed ? html`
<section class="card consent-inline">
  <p><strong>Einverstanden?</strong> Mit dem Knopf akzeptierst du die AGB und das technisch notwendige Cookie
    (<a href="${withBack(other.href, back)}">${other.label} lesen</a>).</p>
  ${consentForm(ctx, back)}
</section>` : html`
<p class="muted small legal-foot">${icon('check-circle', { size: 16 })}<span>Du hast bereits zugestimmt.</span>
  <a href="${other.href}">${other.label}</a></p>`}`;
  return layout({ ...ctx, consentInline: true }, { title: page.title, body });
}

function adminLegal(ctx, { legal: legalInfo }) {
  const body = html`
${pageHead('AGB & Datenschutz', {
    iconName: 'scale',
    sub: html`Version ${legalInfo.version}${legalInfo.updatedAt
      ? html` · geändert am ${ctx.date(legalInfo.updatedAt)}${legalInfo.updatedBy ? html` von ${legalInfo.updatedBy}` : ''}` : ' · Vorlage'}`,
  })}
${legal.hasPlaceholder(legalInfo) ? html`<p class="note note-warn page-note">${icon('alert', { size: 16 })}<span>${
    `Trag ganz unten im Datenschutz-Hinweis noch ein, wer verantwortlich ist (Name und Kontakt) – statt ${legal.CONTACT_PLACEHOLDER}.`}</span></p>` : ''}
<section class="card">
  <form method="post" action="/admin/rechtliches" class="form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <label class="field">
      <span class="label">AGB</span>
      <textarea name="agb" rows="16" maxlength="${legal.MAX_LENGTH}" class="legal-editor">${legalInfo.agb}</textarea>
    </label>
    <label class="field">
      <span class="label">Datenschutz &amp; Cookies</span>
      <textarea name="datenschutz" rows="16" maxlength="${legal.MAX_LENGTH}" class="legal-editor">${legalInfo.datenschutz}</textarea>
    </label>
    <p class="muted small">Formatierung: <code>## Überschrift</code>, Zeilen mit <code>- </code> werden zur Aufzählung,
      <code>**fett**</code>, eine leere Zeile beginnt einen neuen Absatz. Ein leeres Feld stellt die Vorlage wieder her.
      Die Vorlagen sind ein Vorschlag, keine Rechtsberatung.</p>
    <label class="check">
      <input type="checkbox" name="neu_zustimmen" value="ja" checked>
      <span><strong>Alle müssen neu zustimmen</strong> – empfohlen, wenn sich inhaltlich etwas geändert hat.
        Ohne Haken gelten bisherige Zustimmungen weiter (z. B. bei Tippfehlern).</span>
    </label>
    <button class="btn btn-primary" type="submit">${icon('check', { size: 18 })}<span>Speichern</span></button>
  </form>
</section>`;
  return layout(ctx, { title: 'AGB & Datenschutz', body });
}

function maintenanceCard(ctx, myAddress) {
  const state = ctx.maintenance || { on: false, message: maintenance.DEFAULT_MESSAGE, onlyOwner: false, addresses: [] };
  return html`<section class="card" id="wartung">
  ${sectionHead('Wartungsmodus', { iconName: 'wrench', extra: html`<span class="status-pill ${state.on ? 'is-warn' : 'is-ok'}">${
    state.on ? 'An' : 'Aus'}</span>` })}
  <form method="post" action="/admin/wartung" class="form">
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    <label class="switch-row">
      <span><strong>Seite für Besucher schließen</strong>
        <small>${state.on ? html`An seit ${ctx.date(state.since)} – Besucher sehen nur die Wartungsseite.`
    : 'Besucher sehen dann nur eine Wartungsseite, bis du wieder ausschaltest.'}</small></span>
      <input type="checkbox" name="an" value="ja" class="switch" data-autosubmit${state.on ? html` checked` : ''}
             aria-label="Wartungsmodus">
    </label>
    <label class="field">
      <span class="label">Text auf der Wartungsseite</span>
      <textarea name="nachricht" rows="3" maxlength="${maintenance.MAX_MESSAGE}">${state.message}</textarea>
    </label>
    <fieldset class="choices">
      <legend class="label">Wer kommt während der Wartung rein?</legend>
      <label class="check"><input type="radio" name="zugang" value="alle"${state.onlyOwner ? '' : html` checked`}>
        <span><strong>Alle angemeldeten Konten</strong></span></label>
      <label class="check"><input type="radio" name="zugang" value="ich"${state.onlyOwner ? html` checked` : ''}>
        <span><strong>Nur ich (${ctx.user.displayName})</strong> – andere Konten sehen auch die Wartungsseite</span></label>
    </fieldset>
    <label class="field">
      <span class="label">Diese Internet-Adressen kommen immer rein <small>(auch ohne Anmeldung, eine pro Zeile)</small></span>
      <textarea name="adressen" rows="2" spellcheck="false" autocapitalize="off"
                placeholder="z. B. 203.0.113.7">${state.addresses.join('\n')}</textarea>
    </label>
    <div class="address-hint">
      ${myAddress ? html`<span class="muted small">Deine Adresse gerade: <code>${myAddress}</code></span>
      <button class="btn btn-sm btn-ghost" type="submit" name="meine_adresse" value="ja">${icon('plus', { size: 16 })}<span>Meine Adresse hinzufügen</span></button>`
    : html`<span class="muted small">Deine Internet-Adresse kommt beim Server nicht an – melde dich während der Wartung über das Schloss an.</span>`}
    </div>
    <p class="muted small">Zuhause und am Handy ändert sich die Adresse oft (spätestens beim nächsten Router-Neustart).
      Sicherer ist das Anmelden. MAC-Adressen sieht ein Webserver nie – die bleiben im Heimnetz.</p>
    <p class="muted small">Zum Anmelden während der Wartung: auf der Wartungsseite oben rechts auf das
      kleine Schloss tippen – oder direkt <code>/admin/login</code> öffnen.</p>
    <button class="btn" type="submit">${icon('check', { size: 18 })}<span>Speichern</span></button>
  </form>
</section>`;
}

/** Oben rechts ein unauffälliges Schloss – dahinter das Anmeldeformular. */
function hiddenLogin(ctx) {
  return html`<details class="hidden-login appbar-action">
    <summary class="icon-btn hidden-login-toggle" title="Anmelden" aria-label="Anmelden">${icon('lock', { size: 18 })}</summary>
    <form method="post" action="/admin/login" class="hidden-login-panel form">
      <input type="hidden" name="csrf_token" value="${ctx.csrf}">
      <input name="username" required maxlength="40" autocapitalize="off" spellcheck="false" autocomplete="username"
             placeholder="Benutzername" aria-label="Benutzername">
      <input name="password" type="password" required maxlength="200" autocomplete="current-password"
             placeholder="Passwort" aria-label="Passwort">
      <button class="btn btn-primary btn-block" type="submit">${icon('log-in', { size: 18 })}<span>Anmelden</span></button>
    </form>
  </details>`;
}

function maintenancePage(ctx, { state }) {
  const body = html`
<section class="card auth-card maint-card">
  <div class="auth-mark auth-mark-icon maint-icon">${icon('wrench', { size: 30 })}</div>
  <h1>Wartungsarbeiten</h1>
  <p class="lead maint-message">${state.message}</p>
  ${ctx.isAdmin ? html`<p class="note note-warn">${icon('lock', { size: 16 })}<span>${
    `Du bist als ${ctx.user.displayName} angemeldet – während dieser Wartung hat aber nur ${state.ownerName || 'der Admin'} Zugang.`
  }</span></p>` : ''}
</section>`;
  return layout(ctx, { title: 'Wartung', body, bare: true, headerAction: ctx.isAdmin ? '' : hiddenLogin(ctx) });
}

function errorPage(ctx, { status, message }) {
  const body = authCard(status === 404 ? 'Nicht gefunden' : 'Hoppla', message, html`
  <a class="btn btn-primary btn-block" href="/">${icon('home', { size: 18 })}<span>Zur Startseite</span></a>`);
  return layout(ctx, { title: 'Fehler', body });
}

/** Erscheint in der App, wenn es gerade kein Internet gibt (liefert der Service Worker aus). */
function offlinePage() {
  const ctx = { isAdmin: false, csrf: '', flashes: [], user: null, path: '' };
  const body = authCard('Keine Verbindung', 'Gerade gibt es kein Internet. Sobald die Verbindung wieder da ist, '
    + 'lädt die Seite von selbst neu.', html`
  <button class="btn btn-primary btn-block" type="button" id="nochmal">${icon('refresh', { size: 18 })}<span>Nochmal versuchen</span></button>`,
  { iconName: 'wifi-off' });
  return layout(ctx, {
    title: 'Offline',
    body,
    bare: true,
    scripts: html`<script>
    document.getElementById('nochmal').addEventListener('click', function () { location.reload(); });
    window.addEventListener('online', function () { location.reload(); });
  </script>`,
  });
}

module.exports = {
  index, publicQueue, adminLogin, adminSetup, adminUsers, adminLog, adminDashboard, adminEdit, adminArchive,
  archiveExport, errorPage, offlinePage, legalPage, adminLegal, maintenancePage,
};
