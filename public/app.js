// Kleine Helfer für alle Seiten: Einblendungen, Sicherheitsabfragen, App-Installation.
(function () {
  'use strict';

  // Einblendungen verschwinden beim Antippen.
  document.addEventListener('click', function (e) {
    var toast = e.target.closest && e.target.closest('.toast');
    if (toast) toast.remove();
  });

  // Knöpfe mit data-confirm fragen vorher nach.
  document.addEventListener('submit', function (e) {
    var message = e.target.getAttribute('data-confirm');
    if (message && !window.confirm(message)) e.preventDefault();
  });

  // Service Worker: macht die Seite installierbar und zeigt ohne Internet die Offline-Seite.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* z. B. ohne HTTPS */ });
    });
  }

  // --- Hinweis „Als App installieren“ -------------------------------------------------
  var banner = document.getElementById('install');
  if (!banner) return;

  var KEY = 'druck-install-ausgeblendet';
  var PAUSE_DAYS = 30;

  function isStandalone() {
    return window.navigator.standalone === true
      || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function dismissedRecently() {
    try {
      var at = Number(window.localStorage.getItem(KEY));
      return at > 0 && Date.now() - at < PAUSE_DAYS * 864e5;
    } catch (err) {
      return false;
    }
  }
  function remember() {
    try { window.localStorage.setItem(KEY, String(Date.now())); } catch (err) { /* privates Fenster */ }
  }
  function show(mode) {
    banner.setAttribute('data-mode', mode);
    banner.hidden = false;
  }
  function hide() {
    banner.hidden = true;
    remember();
  }

  if (isStandalone()) return;

  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var deferredPrompt = null;

  // Android/Chrome: Der Browser meldet, dass die Seite installierbar ist.
  window.addEventListener('beforeinstallprompt', function (e) {
    if (!touch || dismissedRecently()) return; // am Computer bleibt das Symbol in der Adressleiste
    e.preventDefault();
    deferredPrompt = e;
    show('prompt');
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hide();
  });

  // iPhone/iPad: Installieren geht nur über „Teilen → Zum Home-Bildschirm“.
  if (ios && !dismissedRecently()) show('ios');

  banner.querySelector('[data-install]').addEventListener('click', function () {
    if (!deferredPrompt) return;
    var prompt = deferredPrompt;
    deferredPrompt = null;
    prompt.prompt();
    prompt.userChoice.then(hide, hide);
  });
  banner.querySelector('[data-dismiss]').addEventListener('click', hide);
})();
