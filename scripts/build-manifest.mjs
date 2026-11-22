// Generates kin.json, the only file Kindroid reads (guide: "What a program is").
//   node scripts/build-manifest.mjs          writes kin.json
//   node scripts/build-manifest.mjs --check  fails if kin.json is not what this gives (a test runs this)
import { isMainModule, writeOrCheck } from './lib/generated.mjs';
import { ACTION, OPS } from '../src/core/state.js';

export const CHAT_DAYS = 2; // the Kin sees 2 days of its chat: an outfit described yesterday is still in view

export function buildManifest() {
  return {
    kin: 1,
    name: 'Clotheskin',
    purpose: 'Shows where your Kin is, what it is doing and what it is wearing, from its recent chat. Follows its nights and, if you allow it, tells it the dream it remembers and its current look.',
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
          properties: { kin: { type: 'string' }, op: { type: 'string', enum: OPS } },
          required: ['kin'],
        },
        by: ['user'],
      },
    ],
    grants: ['kin:read', `chat:read:${CHAT_DAYS}`],
  };
}

if (isMainModule(import.meta.url)) writeOrCheck('kin.json', `${JSON.stringify(buildManifest(), null, 2)}\n`);
