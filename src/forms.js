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

module.exports = { parseJobForm, completeFromMakerworld };
