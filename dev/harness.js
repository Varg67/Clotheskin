// The dev harness: a stand-in for Kindroid around the real screen, running the real program (run/program.js).
//   - the page side of the screen protocol (kins, files.read, files.write, action), as in the Kindroid guide;
//   - the run side: the `kin` functions program.js expects (files, kins, ask, tell), with a stand-in Kin whose answers
//     come from a scene and can be edited;
//   - the schedule: "Run the 15-minute start now", or at each quarter hour.
// Browser tests drive it through window.dev (tests/e2e/screen.cjs).
import { runProgram } from '/run/program.js';
import { DEMO_SCENES } from '/dev/scenes.js';

const STORE = 'clotheskin-dev';
const frame = document.getElementById('frame');
const $ = (id) => document.getElementById(id);

const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
const state = {
  files: new Map(Object.entries(saved.files || {})),
  kins: saved.kins || [{ id: 'kin-isa', name: 'Isa', attached: true }, { id: 'kin-bea', name: 'Bea', attached: true }, { id: 'kin-alex', name: 'Alex', attached: false }],
  silent: false, // the page does not answer at all (to see the "Could not reach Kindroid" screen)
  noKins: false, // the page answers files but not the Kin list (as when the App Library takes the card's picture)
  actionDelayMs: 600,
  calls: [],
};
const persist = () => localStorage.setItem(STORE, JSON.stringify({ files: Object.fromEntries(state.files), kins: state.kins }));
const attached = () => state.kins.filter((k) => k.attached).map(({ id, name }) => ({ id, name }));

function log(...entry) {
  state.calls.push(entry);
  const li = document.createElement('li');
  li.textContent = entry.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('  ').slice(0, 400);
  $('log').prepend(li);
}

// ---------------------------------------------------------------- the stand-in Kin and `kin` for the run
const kindOf = (prompt) => (/are you asleep right now/.test(prompt) ? 'sleep' : /what did you dream/.test(prompt) ? 'dream' : 'reading');
const kin = {
  async get(path) { log('kin files get', path); return state.files.has(path) ? state.files.get(path) : null; },
  async put(path, text) { log('kin files put', path); state.files.set(path, text); persist(); },
  async kins() { log('kin kins'); return attached(); },
  async ask(prompt, { kin: id } = {}) {
    const kind = kindOf(prompt);
    log('kin ask', kind, id);
    await new Promise((r) => setTimeout(r, 150));
    const mode = $('kindroid').value;
    if (mode === 'down') throw new Error('kin ask failed: connection refused');
    if (mode === 'maintenance') throw new Error('kin ask failed: 503 Service Unavailable');
    return $(`a-${kind}`).value;
  },
  async tell(fact, opts) { log('kin tell', fact, opts); },
};

async function run(event) {
  log('run', event);
  const r = await runProgram({ event, kin, log: (m) => log('stderr', m) });
  log(r.ok ? 'kin end' : 'kin end --failed', r.message);
  return r;
}

// ---------------------------------------------------------------- the page side of the screen protocol
const reply = (m) => frame.contentWindow.postMessage(m, '*');
window.addEventListener('message', async (e) => {
  if (e.source !== frame.contentWindow || state.silent) return;
  const m = e.data;
  if (!m || typeof m.kin !== 'string') return;
  if (m.kin === 'kins') { if (!state.noKins) reply({ kin: 'kins', ok: true, kins: attached() }); }
  else if (m.kin === 'files.read') reply({ kin: 'files.read', path: m.path, body: state.files.has(m.path) ? state.files.get(m.path) : null });
  else if (m.kin === 'files.write') { state.files.set(m.path, m.body); persist(); log('screen files.write', m.path); reply({ kin: 'files.write', path: m.path, ok: true }); }
  else if (m.kin === 'action') {
    log('screen action', m.name, m.input);
    await new Promise((r) => setTimeout(r, state.actionDelayMs));
    const r = await run({ trigger: 'action', action: m.name, input: m.input });
    reply({ kin: 'action', name: m.name, ok: r.ok, summary: r.message });
  }
});
const pushKins = () => reply({ kin: 'kins', ok: true, kins: attached() });

// ---------------------------------------------------------------- controls
function renderKins() {
  $('kins').replaceChildren(...state.kins.map((k) => {
    const label = document.createElement('label');
    label.className = 'inline';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = k.attached;
    box.dataset.kin = k.id;
    box.addEventListener('change', () => { k.attached = box.checked; persist(); pushKins(); });
    label.append(box, ` ${k.name} `, Object.assign(document.createElement('code'), { textContent: k.id }));
    return label;
  }));
}

function loadScene(id) {
  const s = DEMO_SCENES.find((x) => x.id === id) || DEMO_SCENES[0];
  $('scene').value = s.id;
  $('chat').textContent = s.chat;
  $('a-reading').value = s.response;
  $('a-sleep').value = s.sleep || '{"sleeping":false}';
  $('a-dream').value = s.dream || '{"dream":"","remembered":"nothing"}';
}

$('scene').append(...DEMO_SCENES.map((s) => Object.assign(document.createElement('option'), { value: s.id, textContent: s.title })));
$('scene').addEventListener('change', (e) => loadScene(e.target.value));
$('tick').addEventListener('click', () => run({ trigger: 'schedule' }));
$('reset').addEventListener('click', () => { state.files.clear(); persist(); frame.contentWindow.location.reload(); });
let lastQuarter = Math.floor(Date.now() / 900000);
setInterval(() => {
  const q = Math.floor(Date.now() / 900000);
  if (q !== lastQuarter) { lastQuarter = q; if ($('auto-ticks').checked) run({ trigger: 'schedule' }); }
}, 1000);
renderKins();
loadScene('pt-jeans-jacket');

// ---------------------------------------------------------------- for the browser tests
window.dev = {
  state,
  files: () => Object.fromEntries(state.files),
  setFiles(obj) { state.files = new Map(Object.entries(obj)); persist(); },
  setKins(list) { state.kins = list.map((k) => ({ attached: true, ...k })); persist(); renderKins(); pushKins(); },
  scene: loadScene,
  answers({ reading, sleep, dream } = {}) {
    if (reading !== undefined) $('a-reading').value = reading;
    if (sleep !== undefined) $('a-sleep').value = sleep;
    if (dream !== undefined) $('a-dream').value = dream;
  },
  kindroid(mode) { $('kindroid').value = mode; },
  tick: () => run({ trigger: 'schedule' }),
  asks: () => state.calls.filter((c) => c[0] === 'kin ask').map((c) => c[1]),
  tells: () => state.calls.filter((c) => c[0] === 'kin tell'),
  silent(on) { state.silent = on; },
  noKins(on) { state.noKins = on; },
  reloadScreen() { frame.contentWindow.location.reload(); },
};
