#!/usr/bin/env node
// A stand-in for the `kin` command, for running the real main.js as Kindroid would (tests/run-main.test.js).
// FAKE_DIR holds the program's folder (files/), the call log (calls.jsonl) and options (options.json).
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.FAKE_DIR;
const opt = existsSync(join(dir, 'options.json')) ? JSON.parse(readFileSync(join(dir, 'options.json'), 'utf8')) : {};
const [cmd, ...args] = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify([cmd, ...args])}\n`);
const files = join(dir, 'files');
mkdirSync(files, { recursive: true });

if (cmd === 'files' && args[0] === 'get') {
  const f = join(files, args[1]);
  if (!existsSync(f)) { process.stderr.write(`404 ${args[1]} not found\n`); process.exit(4); }
  process.stdout.write(readFileSync(f));
} else if (cmd === 'files' && args[0] === 'put') {
  writeFileSync(join(files, args[1]), readFileSync(args[2]));
} else if (cmd === 'kins') {
  process.stdout.write('k1\tIsa\nk2\tBea Maria\n');
} else if (cmd === 'ask') {
  if (opt.askFails) { process.stderr.write('kin: 503 Service Unavailable\n'); process.exit(3); }
  // The answer leaves in two writes, split inside a 3-byte character (a curly quote): it must still be read whole.
  const buf = Buffer.from(opt.answer, 'utf8');
  const cut = buf.indexOf(Buffer.from('“')) + 1 || 1;
  process.stdout.write(buf.subarray(0, cut));
  setTimeout(() => process.stdout.write(buf.subarray(cut)), 40);
} else if (cmd === 'end') {
  if (opt.endFails) { process.stderr.write('kin end: rejected\n'); process.exit(2); }
} else if (cmd === 'tell') {
  // accepted
} else {
  process.stderr.write(`unknown command ${cmd}\n`);
  process.exit(9);
}
