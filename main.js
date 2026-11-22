// The run's entry (kin.json: "run": { "entry": "node main.js" }). Kindroid starts it every 15 minutes and when the
// screen uses the action; what started it arrives as JSON on stdin. The guide's one rule for an entry: it always ends
// with `kin end "..."` or `kin end --failed "..."`. So every path below, crashes included, reaches kin end once.
import { createKin } from './run/kin.js';
import { runProgram } from './run/program.js';
import { errorMessage } from './src/core/text.js';

const log = (m) => console.error(`[clotheskin] ${m}`); // stderr: diagnostics only, never the scene

// What starts a run is a small JSON (an action's input is at most 16,000 characters): far more is not a trigger.
const MAX_STDIN_CHARS = 1024 * 1024;

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.length > MAX_STDIN_CHARS) throw new Error('its input is too large to be a trigger');
  }
  return data;
}

/** The trigger: { event } when stdin is a JSON object (nothing on stdin is an empty trigger), otherwise { problem }. */
function parseEvent(text) {
  let event;
  try { event = JSON.parse(text || '{}'); } catch { return { problem: 'Clotheskin was started with input that is not JSON.' }; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { problem: 'Clotheskin was started with JSON that is not a trigger.' };
  return { event };
}

// kin.json gives a run 2 minutes. program.js keeps to 100 s; if anything still hangs, this ends the run properly
// at 110 s, so Kindroid never has to kill it without a kin end.
const WATCHDOG_MS = Number(process.env.CLOTHESKIN_WATCHDOG_MS) || 110000;

const kin = createKin();
let ended = false;
async function end(result) {
  if (ended) return;
  ended = true;
  clearTimeout(watchdog);
  try {
    await kin.end(result.message, { failed: !result.ok });
  } catch (e) {
    log(`kin end failed: ${errorMessage(e)}`);
    log(`the run meant to say: ${result.message}`);
    process.exitCode = 1;
  }
}
const watchdog = setTimeout(async () => {
  log(`still running after ${WATCHDOG_MS / 1000} s: ending the run`);
  await end({ ok: false, message: 'Clotheskin ran out of time in this run. It tries again at the next start.' });
  process.exit(); // whatever still hangs (a kin call) stops here
}, WATCHDOG_MS);

let result;
try {
  const { event, problem } = parseEvent(await readStdin());
  result = problem ? { ok: false, message: problem } : await runProgram({ event, kin, log });
} catch (e) {
  result = { ok: false, message: `Clotheskin could not finish: ${errorMessage(e)}` };
}
await end(result);
