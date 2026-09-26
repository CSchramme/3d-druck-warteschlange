'use strict';

// Einlesen und Prüfen der Auftragsformulare (öffentlich und Admin).

const makerworld = require('./makerworld');

const FIELDS = {
  requester: { formName: 'requester', label: 'Name', max: 60 },
  title: { formName: 'title', label: 'Titel', max: 120 },
  color: { formName: 'color', label: 'Farbe/Material', max: 60 },
  notes: { formName: 'notes', label: 'Beschreibung', max: 1000 },
  adminNote: { formName: 'admin_note', label: 'Admin-Notiz', max: 1000 },
};

/**
 * Gibt { values, errors } zurück. Der Titel darf leer sein, wenn ein Link da
 * ist – den ergänzt dann completeFromMakerworld().
 */
function parseJobForm(body, { admin = false } = {}) {
  const errors = [];
  const values = {};
  const text = (name) => (typeof body[name] === 'string' ? body[name].trim() : '');

  for (const [key, field] of Object.entries(FIELDS)) {
    if (key === 'adminNote' && !admin) continue;
    const value = text(field.formName);
    if (value.length > field.max) errors.push(`${field.label} ist zu lang (max. ${field.max} Zeichen).`);
    values[key] = value || null;
  }

  try {
    values.makerworldUrl = makerworld.normalizeUrl(text('makerworld_url'));
  } catch (err) {
    errors.push(err.message);
    values.makerworldUrl = null;
  }

  if (admin) {
    const image = text('image_url');
    if (image && !image.startsWith('https://')) errors.push('Der Bild-Link muss mit https:// beginnen.');
    values.imageUrl = image.slice(0, 500) || null;
  }

  const quantity = Number(text('quantity') || 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    errors.push('Die Anzahl muss zwischen 1 und 99 liegen.');
  }
  values.quantity = Number.isInteger(quantity) ? quantity : 1;

  if (!values.requester) errors.push('Bitte gib deinen Namen an.');
  if (!values.title && !values.makerworldUrl) {
    errors.push('Bitte schreib, was gedruckt werden soll, oder füge einen MakerWorld-Link ein.');
  }
  return { values, errors };
}

/** Ergänzt fehlenden Titel/Vorschaubild aus der MakerWorld-Seite. */
async function completeFromMakerworld(values, enabled = true) {
  const url = values.makerworldUrl;
  if (!url || !makerworld.isMakerworld(url)) {
    if (!values.title) values.title = 'Modell über Link';
    return values;
  }
  const info = enabled ? await makerworld.fetchInfo(url) : { title: null, imageUrl: null };
  if (!values.title) values.title = info.title || makerworld.fallbackTitle(url);
  if (!values.imageUrl) values.imageUrl = info.imageUrl;
  return values;
}

/**
 * Datumsfeld ('JJJJ-MM-TT') -> ISO-Zeitpunkt. Mittags UTC, damit das Datum in
 * jeder europäischen Zeitzone gleich angezeigt wird. Ungültig -> null.
 */
function parseDate(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  if (date.getUTCFullYear() < 2000 || date.getTime() > Date.now() + 2 * 24 * 3600 * 1000) return null;
  return date.toISOString();
}

/** Liste von Links (einer pro Zeile) -> { urls, skipped }. Doppelte fallen raus. */
function parseLinkList(value, max = 50) {
  const urls = [];
  const skipped = [];
  const lines = (typeof value === 'string' ? value : '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const url = makerworld.normalizeUrl(line);
      if (!urls.includes(url)) urls.push(url);
    } catch {
      skipped.push(line.slice(0, 80));
    }
  }
  return { urls: urls.slice(0, max), skipped, tooMany: urls.length > max };
}

module.exports = { parseJobForm, completeFromMakerworld, parseDate, parseLinkList };
