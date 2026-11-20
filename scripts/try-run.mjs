// Runs the real entry (node main.js) with Kindroid's own `kin` command in mock mode, as the guide suggests:
// "To try an entry without touching anything real, set KIN_MOCK=/tmp/try.jsonl: every kin call is written to that
// file and answered as if it worked. KIN_MOCK_ASK="an answer" stands in for the Kin."
//
//   curl -fsSO https://downloads.kinusercontent.com/workshop/kin.mjs
//   npm run try                       # a scheduled start
//   npm run try -- action             # the screen's Update status for a Kin "k1"
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = process.env.KIN_BIN || 'kin.mjs';
if (!existsSync(bin)) {
  console.error(`No ${bin} here. Download it first: curl -fsSO https://downloads.kinusercontent.com/workshop/kin.mjs`);
  process.exit(2);
}
const event = process.argv[2] === 'action'
  ? { trigger: 'action', action: 'update_status', input: { kin: 'k1', op: 'read' } }
  : { trigger: 'schedule' };
const mock = join(tmpdir(), 'clotheskin-try.jsonl');
rmSync(mock, { force: true });
const answer = process.env.KIN_MOCK_ASK || JSON.stringify({ location: 'in the kitchen', pose: 'standing at the counter', action: 'making coffee', topwear: ['a grey hoodie'], bottomwear: ['black leggings'] });
const r = spawnSync(process.execPath, ['main.js'], { input: JSON.stringify(event), encoding: 'utf8', env: { ...process.env, KIN_BIN: bin, KIN_MOCK: mock, KIN_MOCK_ASK: answer } });
console.log(`trigger: ${JSON.stringify(event)}\nexit code: ${r.status}`);
if (r.stderr.trim()) console.log(`stderr:\n${r.stderr.trim()}`);
console.log(`kin calls (${mock}):`);
console.log(existsSync(mock) ? readFileSync(mock, 'utf8').trim() : '(none recorded)');
