// A fake of what a run sees inside Kindroid: the program's folder, the attached Kins, a Kin that answers each kind of
// question from a script, kin tell, and a clock. Used by the program tests; the dev harness has its own in the browser.
export function fakeKindroid({ kins = [{ id: 'k1', name: 'Isa' }], settings = null, now = '2026-11-20T22:00:00-03:00' } = {}) {
  const files = new Map();
  if (settings) files.set('settings.json', JSON.stringify({ tz: 'America/Sao_Paulo', ...settings }));
  const calls = [];
  const answers = { reading: [], sleep: [], dream: [] };
  let clock = new Date(now);
  const kindOf = (prompt) => (/are you asleep right now/.test(prompt) ? 'sleep' : /what did you dream/.test(prompt) ? 'dream' : 'reading');
  const kin = {
    async get(path) {
      calls.push(['get', path]);
      if (fake.unreadable === path) throw new Error(`kin files get ${path} failed: 500 internal error`);
      return files.has(path) ? files.get(path) : null;
    },
    async put(path, text) { calls.push(['put', path]); files.set(path, text); },
    async kins() { calls.push(['kins']); return fake.kins; },
    async ask(prompt, { kin: id } = {}) {
      const kind = kindOf(prompt);
      calls.push(['ask', kind, id, prompt]);
      const a = answers[kind].length > 1 ? answers[kind].shift() : answers[kind][0];
      if (a === undefined) throw new Error(`no ${kind} answer scripted`);
      if (a instanceof Error) throw a;
      return typeof a === 'function' ? a(prompt) : a;
    },
    async tell(fact, opts) { calls.push(['tell', fact, opts]); if (fake.tellFails) throw new Error('kin tell failed: busy'); },
  };
  const fake = {
    kin, files, calls, answers, kins,
    unreadable: null,
    tellFails: false,
    clock: () => clock,
    at: (iso) => { clock = new Date(iso); },
    advance: (minutes) => { clock = new Date(clock.getTime() + minutes * 60000); },
    settings: (patch) => files.set('settings.json', JSON.stringify({ ...JSON.parse(files.get('settings.json') || '{}'), ...patch })),
    status: () => JSON.parse(files.get('status.json') || '{"kins":{}}'),
    entry: (id = 'k1') => fake.status().kins[id],
    asks: () => calls.filter((c) => c[0] === 'ask').map((c) => c[1]),
    tells: () => calls.filter((c) => c[0] === 'tell'),
    puts: () => calls.filter((c) => c[0] === 'put').length,
  };
  return fake;
}

export const READING = (pose, action, extra = {}) => JSON.stringify({ location: 'in the bedroom', pose, action, topwear: ['pyjamas'], ...extra });
