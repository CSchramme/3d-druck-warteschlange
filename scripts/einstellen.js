'use strict';

// npm run einstellen                       -> zeigt, was in .env steht (Passwörter verdeckt)
// npm run einstellen NAME=wert [NAME=wert]  -> trägt Werte in .env ein bzw. ändert sie
// npm run einstellen NAME=                  -> entfernt einen Wert
//
// Für den Fall, dass du keine Dateien bearbeiten kannst. Werte aus den Plesk-
// Umgebungsvariablen haben Vorrang vor .env.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const SECRET = /PASSWORD|SECRET|WEBHOOK|TOKEN/;

function quote(value) {
  return /^[\w@%+=:,./~-]*$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/** Setzt/ändert/entfernt Zeilen „NAME=wert“ in einem .env-Text; Kommentare bleiben erhalten. */
function updateEnvText(text, assignments) {
  const lines = text ? text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [];
  for (const [name, value] of Object.entries(assignments)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line));
    if (value === '') {
      if (index !== -1) lines.splice(index, 1);
    } else if (index !== -1) {
      lines[index] = `${name}=${quote(value)}`;
    } else {
      lines.push(`${name}=${quote(value)}`);
    }
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** Liest „NAME=wert“-Argumente. Ungültige Namen -> Fehler. */
function parseAssignments(args) {
  const assignments = {};
  for (const arg of args) {
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (eq === -1 || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error(`„${arg}“ verstehe ich nicht – bitte so: NAME=wert (Name in GROSSBUCHSTABEN).`);
    }
    assignments[name] = arg.slice(eq + 1);
  }
  return assignments;
}

function show(text) {
  const entries = text.split('\n')
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line))
    .filter(Boolean);
  if (!entries.length) {
    console.log('In .env steht noch nichts. Beispiel: npm run einstellen DB_NAME=meine_db DB_USER=meine_db');
    return;
  }
  console.log('In .env steht:');
  for (const [, name, value] of entries) {
    console.log(`  ${name}=${SECRET.test(name) && value ? '•••••• (gesetzt)' : value}`);
  }
}

function main() {
  const current = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const args = process.argv.slice(2);
  if (!args.length) {
    show(current);
    return;
  }
  const assignments = parseAssignments(args);
  fs.writeFileSync(ENV_FILE, updateEnvText(current, assignments), { mode: 0o600 });
  for (const [name, value] of Object.entries(assignments)) {
    console.log(value === '' ? `🗑️  ${name} entfernt` : `✅ ${name} gespeichert`);
  }
  // Passenger (Plesk) startet die App neu, wenn sich tmp/restart.txt ändert.
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp', 'restart.txt'), new Date().toISOString());
  console.log('🔄 Die App startet beim nächsten Seitenaufruf mit den neuen Einstellungen.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

module.exports = { updateEnvText, parseAssignments };
