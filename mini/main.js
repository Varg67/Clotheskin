// Clotheskin Mini: the run. The screen's "read_now" action starts it with {"input":{"kin":"<id>"}} on stdin.
// It asks the Kin, saves status.json and always ends with exactly one `kin end`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const KIN = process.env.KIN_BIN || 'kin';

function kin(args) {
  try {
    return execFileSync(KIN, args, { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const why = String(e.stderr || e.message || '').trim().split('\n').pop();
    throw new Error(`kin ${args[0]} ${args[0] === 'files' ? args[1] : ''}: ${why}`.slice(0, 300));
  }
}

function end(text, failed) {
  const line = String(text).replace(/\s+/g, ' ').trim().slice(0, 480) || 'done';
  try { kin(['end', ...(failed ? ['--failed'] : []), line]); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

const PROMPT = `From your recent chat with the person, as of your last message, describe yourself in English.
Reply with exactly these three lines and nothing else (no roleplay, no narration):
Location: <where you are, e.g. in the kitchen>
Doing: <your pose and what you are doing, e.g. sitting on the sofa, drinking coffee>
Wearing: <your clothes and accessories, e.g. a white shirt and blue jeans>
If the chat does not say, write "unknown" on that line.`;

function pick(text, label) {
  const m = text.match(new RegExp(`^\\s*\\**${label}\\**\\s*:\\s*(.+)$`, 'im'));
  return m ? m[1].replace(/\*+/g, '').trim() : '';
}

try {
  let event = {};
  try { event = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no input */ }
  const kinId = String(event?.input?.kin || '').trim();
  if (!kinId) throw new Error('No Kin was chosen on the screen.');

  const answer = kin(['ask', '--kin', kinId, PROMPT]).trim();
  const status = {
    kin: kinId,
    at: new Date().toISOString(),
    location: pick(answer, 'Location'),
    doing: pick(answer, 'Doing'),
    wearing: pick(answer, 'Wearing'),
    raw: answer.slice(0, 2000),
  };
  writeFileSync('/tmp/status.json', JSON.stringify(status));
  kin(['files', 'put', 'status.json', '/tmp/status.json']);
  end(status.wearing ? `Read: ${status.wearing}` : 'The Kin answered, but not in the three lines. See the screen.', false);
} catch (e) {
  end(`Failed: ${e.message}`, true);
}
