// Clotheskin: the run. Kindroid starts it for an action with JSON on stdin:
// {"trigger":"action","action":"update_look","input":{...},"kin":"<id when a Kin calls it in chat>"}
// Same pattern as Kin Bank and Planner: `kin files get/put`, body of put on stdin, always one `kin end`.
import { spawnSync } from 'node:child_process';

function kin(args, input) {
  const r = spawnSync('kin', args, { input, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) throw Error((r.stderr || r.error?.message || 'Kindroid storage did not respond.').trim());
  return r.stdout;
}

const fileFor = (id) => `looks/kin-${id}.json`;
const FIELDS = { location: 120, doing: 160, wearing: 300, hair: 120 };
const clean = (v, max) => String(v).replace(/\s+/g, ' ').trim().slice(0, max);

function load(path) {
  try { return JSON.parse(kin(['files', 'get', path])); }
  catch (e) { if (/^kin: 404\b/i.test(e.message)) return null; throw e; }
}

function who(event) {
  const input = event.input ?? {};
  if (event.kin && input.profile !== undefined && input.profile !== event.kin) throw Error('A Kin can only change its own look.');
  const id = event.kin ?? input.profile;
  if (!id) throw Error('Choose a Kin on the screen first.');
  if (!/^[-\w]{1,100}$/.test(id)) throw Error('That Kin id is not valid.');
  if (!event.kin && !kin(['kins']).split('\n').some((l) => l.split('\t')[0].trim() === id)) throw Error('Link this Kin in Clotheskin settings first.');
  return id;
}

function describe(look) {
  if (!look) return 'Nothing saved yet.';
  return [
    look.location && `Location: ${look.location}`,
    look.doing && `Doing: ${look.doing}`,
    look.wearing && `Wearing: ${look.wearing}`,
    look.hair && `Hair: ${look.hair}`,
  ].filter(Boolean).join('\n') || 'Nothing saved yet.';
}

function run(event) {
  if (event.trigger !== 'action') throw Error('Open Clotheskin or use it in chat.');
  const id = who(event);
  const path = fileFor(id);
  const look = load(path);
  if (event.action === 'get_look') return describe(look);
  if (event.action === 'update_look') {
    const input = event.input ?? {};
    const next = { ...(look ?? {}) };
    let changed = 0;
    for (const [k, max] of Object.entries(FIELDS)) {
      if (typeof input[k] === 'string' && clean(input[k], max)) { next[k] = clean(input[k], max); changed++; }
    }
    if (!changed) throw Error('Nothing to save: give at least one of location, doing, wearing or hair.');
    next.at = new Date().toISOString();
    next.by = event.kin ? 'kin' : 'user';
    kin(['files', 'put', path], JSON.stringify(next));
    return `Saved.\n${describe(next)}`;
  }
  throw Error('Unknown Clotheskin action.');
}

try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  kin(['end', run(JSON.parse(raw)).slice(0, 3800)]);
} catch (e) {
  kin(['end', '--failed', String(e.message).slice(0, 480)]);
  process.exitCode = 1;
}
