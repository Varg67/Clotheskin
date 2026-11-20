// Generates kin.json. `node scripts/build-manifest.mjs` writes it; the tests check it is up to date.
import { readFileSync, writeFileSync } from 'node:fs';
import { SCHEDULE_TICK_MINUTES } from '../screen/src/core/auto.js';

export function buildManifest() {
  return {
    kin: 1,
    name: 'Clotheskin',
    purpose: 'Shows where a Kin is, what it is doing, what it is wearing and how its hair and makeup look, read from its recent chat, now or on a schedule.',
    // The schedule beat is fixed here; the person's interval is applied by the run (see screen/src/core/auto.js).
    triggers: [{ on: 'schedule', cron: `*/${SCHEDULE_TICK_MINUTES} * * * *`, tz: 'user' }],
    run: { entry: 'node main.js', timeout: '4m' },
    screens: [{ slot: 'panel', entry: 'screen/index.html', title: 'Clotheskin' }],
    actions: [
      {
        name: 'read_outfit',
        description: 'Reads the Kin’s recent chat and describes where it is, what it is doing, what it is wearing and its hair and makeup, one sentence each.',
        input: { type: 'object', properties: { kin: { type: 'string' }, name: { type: 'string' } }, required: ['kin'] },
        by: ['user'],
      },
    ],
    grants: ['kin:read', 'chat:read:1'],
  };
}

const target = new URL('../kin.json', import.meta.url);
const text = `${JSON.stringify(buildManifest(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text) { console.error('kin.json is out of date: run node scripts/build-manifest.mjs'); process.exit(1); }
} else if (process.argv[1] && process.argv[1].endsWith('build-manifest.mjs')) {
  writeFileSync(target, text);
  console.log('kin.json written');
}
