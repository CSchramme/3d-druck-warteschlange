'use strict';

// Winzige Template-Hilfe: html`...` maskiert alle eingesetzten Werte automatisch,
// außer sie stammen selbst aus html`...` (dann sind sie schon sicher).

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escape(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(escape).join('');
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += escape(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

/** Bereits sicheres HTML/CSS/JS unverändert einsetzen (nur für eigene Dateien!). */
const raw = (value) => new SafeHtml(String(value));

module.exports = { html, escape, raw };
