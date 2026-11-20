// Generates kin.json, the only file Kindroid reads (guide: "What a program is").
//   node scripts/build-manifest.mjs          writes kin.json
//   node scripts/build-manifest.mjs --check  fails if kin.json is not what this gives (a test runs this)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTION, OPS } from '../run/program.js';

export const CHAT_DAYS = 2; // the Kin sees 2 days of its chat: an outfit described yesterday is still in view

export function buildManifest() {
  return {
    kin: 1,
    name: 'Clotheskin',
    purpose: 'Shows where your Kin is, what it is doing and what it is wearing, read from its recent chat, and follows its nights: when it sleeps and what it dreamt.',
    // Every 15 minutes, on the person's clock. Each start checks whether a reading is due (settings.json) and most
    // end at once; the interval the person picks (15 min to 4 h) decides how often the Kin is actually asked.
    triggers: [{ on: 'schedule', cron: '*/15 * * * *', tz: 'user' }],
    run: { entry: 'node main.js', timeout: '2m' },
    screens: [{ slot: 'panel', entry: 'screen/index.html', title: 'Clotheskin' }],
    // One action, so one input rule (a published program saw an action's input checked against another action's).
    actions: [
      {
        name: ACTION,
        description: 'Reads the selected Kin now (where it is, its pose and action, its outfit), or asks about its dream when it is asleep.',
        input: {
          type: 'object',
          properties: { kin: { type: 'string' }, name: { type: 'string' }, op: { type: 'string', enum: OPS } },
          required: ['kin'],
        },
        by: ['user'],
      },
    ],
    grants: ['kin:read', `chat:read:${CHAT_DAYS}`],
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const target = new URL('../kin.json', import.meta.url);
  const text = `${JSON.stringify(buildManifest(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
    if (current !== text) { console.error('kin.json is out of date: run npm run build'); process.exit(1); }
  } else {
    writeFileSync(target, text);
    console.log('kin.json written');
  }
}
