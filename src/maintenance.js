'use strict';

// Wartungsmodus: Solange er an ist, sehen Besucher nur eine Wartungsseite.
// Wer mit einem Konto angemeldet ist, kommt weiter rein – oder, wenn so
// eingestellt, nur das Konto, das den Schalter umgelegt hat. Außerdem lassen
// sich Internet-Adressen (IP) freischalten, die auch ohne Anmeldung reinkommen.
// (MAC-Adressen verlassen das Heimnetz nie – die sieht kein Webserver.)

const net = require('net');

const { isInternal } = require('./ratelimit');

const STATE = 'wartung';
const MAX_ADDRESSES = 20;
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
    addresses: Array.isArray(state.addresses) ? state.addresses : [],
  };
}

// --- Freigeschaltete Adressen ---------------------------------------------------------------

const normalize = (address) => String(address || '').trim().toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');

/** IPv6 in 8 volle Gruppen zerlegen („2001:db8::1“ → 2001, db8, 0, 0, 0, 0, 0, 1). */
function ipv6Groups(address) {
  const [head, tail] = address.split('::');
  const first = head ? head.split(':') : [];
  const last = tail === undefined ? [] : (tail ? tail.split(':') : []);
  const fill = tail === undefined ? [] : Array(8 - first.length - last.length).fill('0');
  return [...first, ...fill, ...last].map((group) => group.replace(/^0+(?=.)/, ''));
}

/**
 * Eine Zeile aus dem Formular prüfen: einzelne Adresse oder Bereich
 * (IPv4 ab /16, IPv6 ab /48 – weiter gefasst würde zu viele reinlassen).
 * Adressen des Servers selbst werden abgelehnt, sonst käme jeder rein.
 */
function parseEntry(entry) {
  const [rawAddress, bits, extra] = normalize(entry).split('/');
  const type = net.isIP(rawAddress);
  if (!type || extra !== undefined) return null;
  if (isInternal(rawAddress)) return null;
  if (bits === undefined) return rawAddress;
  if (!/^\d{1,3}$/.test(bits)) return null;
  const prefix = Number(bits);
  if (type === 4 ? prefix < 16 || prefix > 32 : prefix < 48 || prefix > 128) return null;
  return `${rawAddress}/${prefix}`;
}

/** Liste aus dem Formular (eine pro Zeile oder mit Komma getrennt). */
function parseAddresses(text) {
  const addresses = [];
  const invalid = [];
  for (const entry of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const parsed = parseEntry(entry);
    if (!parsed) invalid.push(entry.slice(0, 60));
    else if (!addresses.includes(parsed) && addresses.length < MAX_ADDRESSES) addresses.push(parsed);
  }
  return { addresses, invalid };
}

/**
 * Was „meine Adresse hinzufügen“ einträgt: IPv4 genau so, IPv6 als Heimnetz
 * (/64) – Handys und PCs wechseln den hinteren Teil regelmäßig. null, wenn die
 * Adresse beim Server nicht richtig ankommt (dann ginge es für alle auf).
 */
function ownEntry(address) {
  const ip = normalize(address);
  const type = net.isIP(ip);
  if (!type || isInternal(ip)) return null;
  if (type === 4) return ip;
  return `${ipv6Groups(ip).slice(0, 4).join(':')}::/64`.replace(/(:0)+::/, '::');
}

function addressAllowed(state, address) {
  const ip = normalize(address);
  const type = net.isIP(ip);
  if (!type || !state.addresses.length) return false;
  const list = new net.BlockList();
  for (const entry of state.addresses) {
    const [network, bits] = entry.split('/');
    const family = net.isIP(network) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(network, family);
    else list.addSubnet(network, Number(bits), family);
  }
  return list.check(ip, type === 6 ? 'ipv6' : 'ipv4');
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
      addresses: changes.addresses ?? (Array.isArray(before.addresses) ? before.addresses : []),
    };
    await store.writeState(STATE, next);
    return { before: before.on === true, ...next };
  });
}

/** Darf diese Person die Seite während der Wartung benutzen? */
function allows(state, user, address) {
  if (!state.on) return true;
  if (addressAllowed(state, address)) return true;
  if (!user) return false;
  return !state.onlyOwner || user.id === state.ownerId;
}

module.exports = {
  STATE, MAX_MESSAGE, MAX_ADDRESSES, DEFAULT_MESSAGE, OPEN_PATHS,
  load, update, allows, addressAllowed, parseAddresses, ownEntry,
};
