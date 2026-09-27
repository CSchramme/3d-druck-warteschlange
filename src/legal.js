'use strict';

// AGB und Datenschutz-/Cookie-Hinweis: Texte (im Admin-Bereich änderbar) und die
// Zustimmung dazu. Jede Zustimmung gilt für eine Version – wird die Version
// erhöht, müssen alle beim nächsten Besuch neu zustimmen.
//
// Die Vorlagen sind ein Vorschlag für ein privates Familien-Angebot, keine
// Rechtsberatung.

const { raw, escape } = require('./html');

const STATE = 'rechtliches';
const MAX_LENGTH = 20_000;
const CONTACT_PLACEHOLDER = '[Name und Kontakt eintragen]';

const DEFAULT_AGB = `## 1. Worum es geht
Die 3D-Druck-Warteschlange ist ein privates, kostenloses Angebot für Familie und Freunde. Über diese Seite kannst du Druckwünsche einreichen; gedruckt wird in der Freizeit auf einem privaten 3D-Drucker.

## 2. Anfragen und Freigabe
- Jede Anfrage wird geprüft. Es gibt keinen Anspruch darauf, dass eine Anfrage angenommen oder gedruckt wird.
- Anfragen können ohne Angabe von Gründen abgelehnt, verschoben oder gelöscht werden.
- Die Reihenfolge in der Warteschlange kann sich jederzeit ändern. Feste Termine gibt es nicht.

## 3. Was nicht gedruckt wird
Nichts, was verboten, gefährlich oder beleidigend ist – zum Beispiel Waffen oder Waffenteile, Nachbauten geschützter Produkte zum Weiterverkauf oder Dinge, mit denen andere verletzt werden können.

## 4. Modelle und Rechte
- Bei Links zu MakerWorld gelten die Lizenzbedingungen des jeweiligen Modells. Die Drucke sind nur für den privaten Gebrauch.
- Wer eine eigene Vorlage oder Idee einreicht, versichert, dass er sie verwenden darf.

## 5. Kosten
Das Drucken ist kostenlos. Bei großen oder aufwendigen Drucken kann vorher eine Beteiligung an den Materialkosten abgesprochen werden.

## 6. Qualität und Haftung
3D-Drucke können kleine Fehler, Maßabweichungen oder Farbunterschiede haben. Gedruckte Teile sind nicht für sicherheitskritische Zwecke, für Lebensmittel oder als Spielzeug für Kleinkinder geprüft – die Nutzung erfolgt auf eigene Verantwortung. Gehaftet wird nur bei Vorsatz und grober Fahrlässigkeit.

## 7. Deine Angaben
Dein Name und deine Anfrage werden gespeichert, damit sie bearbeitet werden kann. Freigegebene Anfragen sind mit dem angegebenen Namen in der öffentlichen Warteschlange zu sehen. Mehr dazu unter **Datenschutz & Cookies**.

## 8. Änderungen
Diese Bedingungen können sich ändern. Dann wirst du beim nächsten Besuch gebeten, erneut zuzustimmen.`;

const DEFAULT_PRIVACY = `## Cookies
Diese Seite setzt genau ein Cookie („druck_session“). Es ist technisch notwendig: Es schützt die Formulare vor Missbrauch, merkt sich deine Zustimmung und – falls du dich anmeldest – deine Anmeldung. Es enthält keine Werbe- oder Tracking-Daten, wird nicht an Dritte weitergegeben und läuft nach einem Jahr ab.

Damit die Seite als App funktioniert und schneller lädt, werden außerdem Aussehen, Skripte und Logo auf deinem Gerät zwischengespeichert. Tracking, Statistik oder Werbung gibt es nicht.

## Was gespeichert wird
Wenn du einen Auftrag einreichst: dein Name, der Link bzw. deine Beschreibung, Anzahl, Farbe, Wünsche und der Zeitpunkt. Das wird gebraucht, um den Auftrag zu bearbeiten. Freigegebene Aufträge erscheinen mit Namen in der öffentlichen Warteschlange; erledigte Aufträge bleiben im Druck-Archiv, bis sie gelöscht werden.

## Weitergabe
- Neue Anfragen und die Warteschlange werden in einen privaten Discord-Kanal geschickt (Discord Inc., USA).
- Vorschaubilder von MakerWorld werden direkt von MakerWorld geladen; dabei sieht MakerWorld deine IP-Adresse.
- Die Seite läuft bei einem Webhoster, der – wie jeder Server – technisch bedingt Zugriffsprotokolle führt.

## Deine Rechte
Du kannst jederzeit Auskunft über deine gespeicherten Angaben verlangen und sie berichtigen oder löschen lassen – sag einfach Bescheid.

## Verantwortlich
${CONTACT_PLACEHOLDER}`;

const clean = (text) => String(text || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_LENGTH);

/** Aktueller Stand: Version und Texte (ohne eigene Texte die Vorlagen). */
async function load(store) {
  const state = await store.readState(STATE);
  return {
    version: Number.isInteger(state.version) && state.version > 0 ? state.version : 1,
    agb: state.agb || DEFAULT_AGB,
    datenschutz: state.datenschutz || DEFAULT_PRIVACY,
    updatedAt: state.updatedAt || null,
    updatedBy: state.updatedBy || null,
  };
}

/** Texte speichern; renew erhöht die Version, dann müssen alle neu zustimmen. */
function save(store, { agb, datenschutz, renew, userName }) {
  return store.withLock(STATE, async () => {
    const state = await store.readState(STATE);
    const version = (Number.isInteger(state.version) && state.version > 0 ? state.version : 1) + (renew ? 1 : 0);
    // Unveränderte Vorlagen nicht speichern – so kommen verbesserte Vorlagen bei Updates an.
    const own = (text, fallback) => (clean(text) && clean(text) !== clean(fallback) ? clean(text) : '');
    const next = {
      version,
      agb: own(agb, DEFAULT_AGB),
      datenschutz: own(datenschutz, DEFAULT_PRIVACY),
      updatedAt: new Date().toISOString(),
      updatedBy: userName || null,
    };
    await store.writeState(STATE, next);
    return next;
  });
}

const inline = (text) => escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/**
 * Einfache Formatierung: „## Überschrift“, „### Unterüberschrift“, Zeilen mit
 * „- “ als Aufzählung, **fett**, Leerzeile = neuer Absatz. Alles andere wird
 * als Text angezeigt (kein HTML).
 */
function render(text) {
  const out = [];
  for (const block of clean(text).split(/\n\s*\n/)) {
    let lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    while (lines.length && /^#{2,3} /.test(lines[0])) {
      const level = lines[0].startsWith('### ') ? 3 : 2;
      out.push(`<h${level}>${inline(lines[0].replace(/^#{2,3} /, ''))}</h${level}>`);
      lines = lines.slice(1);
    }
    if (!lines.length) continue;
    if (lines.every((line) => /^[-•] /.test(line))) {
      out.push(`<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`);
    } else {
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
  }
  return raw(out.join('\n'));
}

/** Stand der Zustimmung für diese Sitzung. */
function consentState(legal, session) {
  const accepted = Number(session.zustimmung) || 0;
  return { version: legal.version, needed: accepted !== legal.version, renewed: accepted > 0 && accepted !== legal.version };
}

const hasPlaceholder = (legal) => legal.datenschutz.includes(CONTACT_PLACEHOLDER);

module.exports = {
  STATE, MAX_LENGTH, CONTACT_PLACEHOLDER, DEFAULT_AGB, DEFAULT_PRIVACY,
  load, save, render, consentState, hasPlaceholder,
};
