'use strict';

// Das Logo der App: eine Druckdüse, die Schicht für Schicht druckt – weiß auf
// grünem Verlauf. Daraus entstehen Favicon, App-Symbole (public/*.png) und das
// Zeichen oben links in der Seite.

let counter = 0;

/**
 * variant:
 *  - 'rounded'  abgerundetes Quadrat (Favicon, in der Seite)
 *  - 'square'   volles Quadrat (App-Symbol – das Handy rundet selbst ab)
 *  - 'maskable' volles Quadrat mit mehr Rand (Android schneidet Kreise/Formen aus)
 * decorative: in der Seite steht der Name ohnehin daneben – Screenreader überspringen es.
 */
function logoSvg(size = 64, { variant = 'rounded', decorative = false } = {}) {
  const id = `druck-logo-${++counter}`;
  const scale = { rounded: 0.9, square: 0.86, maskable: 0.72 }[variant];
  const offset = Number((256 * (1 - scale)).toFixed(2));
  const radius = variant === 'rounded' ? 112 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" `
    + `${decorative ? 'aria-hidden="true" focusable="false"' : 'role="img" aria-label="3D-Druck-Warteschlange"'}>`
    + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">`
    + '<stop offset="0" stop-color="#27C862"/><stop offset="1" stop-color="#00953A"/></linearGradient></defs>'
    + `<rect width="512" height="512" rx="${radius}" fill="url(#${id})"/>`
    + `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="#fff">`
    // Filament, Heizblock, Düse
    + '<rect x="236" y="58" width="40" height="64" rx="12" opacity=".7"/>'
    + '<rect x="168" y="114" width="176" height="96" rx="24"/>'
    + '<path d="M212 210h88l-26 56h-36z"/>'
    // gedruckte Schichten – die oberste ist gerade im Druck
    + '<rect x="140" y="290" width="148" height="44" rx="22"/>'
    + '<rect x="112" y="350" width="288" height="44" rx="22" opacity=".85"/>'
    + '<rect x="84" y="410" width="344" height="44" rx="22" opacity=".65"/>'
    + '</g></svg>';
}

module.exports = { logoSvg };
