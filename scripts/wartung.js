'use strict';

// npm run wartung        -> zeigt, ob der Wartungsmodus an ist
// npm run wartung aus    -> schaltet ihn aus (Notausgang, falls du nicht mehr reinkommst)
// npm run wartung an     -> schaltet ihn an (alle angemeldeten Konten kommen weiter rein)

const { loadConfig } = require('../src/config');
const maintenance = require('../src/maintenance');
const { createStorage, databaseHint } = require('../src/storage');

const BY_COMMAND = { id: null, displayName: 'npm run wartung' };

async function main() {
  const command = String(process.argv[2] || '').toLowerCase();
  if (command && !['an', 'aus'].includes(command)) {
    console.log('Aufruf: npm run wartung [an|aus]');
    process.exitCode = 1;
    return;
  }
  const store = createStorage(loadConfig());
  try {
    await store.ready();
    if (command) {
      const saved = await maintenance.update(store, { on: command === 'an', ...(command === 'an' ? { onlyOwner: false } : {}) },
        BY_COMMAND);
      if (saved.before !== saved.on) {
        await store.addLog({ userName: BY_COMMAND.displayName, action: saved.on ? 'wartung_an' : 'wartung_aus',
          details: saved.on ? 'alle angemeldeten Konten' : null });
      }
    }
    const state = await maintenance.load(store);
    if (state.on) {
      console.log(`🔧 Wartungsmodus ist AN (seit ${new Date(state.since).toLocaleString('de-DE')}) – `
        + `${state.onlyOwner ? `nur ${state.ownerName} kommt rein` : 'alle angemeldeten Konten kommen rein'}.`);
      if (state.addresses.length) console.log(`   Ohne Anmeldung kommen rein: ${state.addresses.join(', ')}`);
      console.log('   Ausschalten: wartung aus');
    } else {
      console.log('✅ Wartungsmodus ist aus – die Seite ist für alle offen.');
    }
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  console.error(`❌ ${err.code ? `${databaseHint(err)} (${err.code})` : err.message}`);
  process.exit(1);
});
