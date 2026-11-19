// Generates kin.json so the action schema can never drift from the contract.
// `node scripts/build-manifest.mjs` writes it; `--check` only compares (used by the tests).
import { readFileSync, writeFileSync } from 'node:fs';
import { contractJsonSchema } from '../screen/src/core/contract.js';

export function buildManifest() {
  return {
    kin: 1,
    name: 'Clotheskin',
    purpose: 'Keeps track of what each Kin is wearing and where they are, and lets the person correct it.',
    run: { entry: 'node main.js', timeout: '2m' },
    screens: [{ slot: 'panel', entry: 'screen/index.html', title: 'Clotheskin' }],
    actions: [
      {
        name: 'read_scene',
        description: 'Reads the Kin’s recent chat and updates the scene tracker (clothes, accessories, hair, makeup, posture, location).',
        input: { type: 'object', properties: { kin: { type: 'string' }, name: { type: 'string' }, pronouns: { type: 'string' } }, required: ['kin'] },
        by: ['user'],
      },
      {
        name: 'update_scene',
        description: 'Use when something about your own look or place just changed in the chat: clothes put on or taken off, belongings moved, hair, makeup, posture or location. Report only things already done, never plans.',
        input: contractJsonSchema(),
        by: ['kin'],
      },
      {
        name: 'scene_status',
        description: 'Use to check what you are wearing and where you are before describing it.',
        input: { type: 'object', properties: {} },
        by: ['kin'],
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
