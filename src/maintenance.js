'use strict';

// Wartungsmodus: Solange er an ist, sehen Besucher nur eine Wartungsseite.
// Wer mit einem Konto angemeldet ist, kommt weiter rein – oder, wenn so
// eingestellt, nur das Konto, das den Schalter umgelegt hat.

const STATE = 'wartung';
const MAX_MESSAGE = 1000;
const DEFAULT_MESSAGE = 'Die Druck-Warteschlange wird gerade überarbeitet. Schau bald wieder vorbei!';

// Bleiben auch während der Wartung erreichbar – sonst käme niemand mehr rein.
const OPEN_PATHS = new Set(['/admin/login', '/admin/logout', '/admin/einrichten']);

const clean = (text) => String(text || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_MESSAGE);

async function load(store) {
  const state = await store.readState(STATE);
  return {
    on: state.on === true,
    message: state.message || DEFAULT_MESSAGE,
    onlyOwner: state.onlyOwner === true,
    ownerId: state.ownerId ?? null,
    ownerName: state.ownerName || null,
    since: state.since || null,
  };
}

/**
 * Ändert die Einstellungen. changes: { on, message, onlyOwner } – was fehlt,
 * bleibt wie es ist. user: wer den Schalter umlegt (bei „nur ich“ der Inhaber).
 */
function update(store, changes, user) {
  return store.withLock(STATE, async () => {
    const before = await store.readState(STATE);
    const on = changes.on ?? before.on === true;
    const message = changes.message === undefined ? before.message || '' : clean(changes.message);
    const next = {
      on,
      message: message === DEFAULT_MESSAGE ? '' : message,
      onlyOwner: changes.onlyOwner ?? before.onlyOwner === true,
      ownerId: user ? user.id : before.ownerId ?? null,
      ownerName: user ? user.displayName : before.ownerName || null,
      since: on ? (before.on === true && before.since ? before.since : new Date().toISOString()) : null,
    };
    await store.writeState(STATE, next);
    return { before: before.on === true, ...next };
  });
}

/** Darf diese Person die Seite während der Wartung benutzen? */
function allows(state, user) {
  if (!state.on) return true;
  if (!user) return false;
  return !state.onlyOwner || user.id === state.ownerId;
}

module.exports = { STATE, MAX_MESSAGE, DEFAULT_MESSAGE, OPEN_PATHS, load, update, allows };
