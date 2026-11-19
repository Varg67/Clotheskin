// A stand-in for the `kin` command used to test timeouts and failures. Behaviour comes from FAKE_KIN.
import { writeFileSync } from 'node:fs';
const mode = process.env.FAKE_KIN || 'ok';
if (process.env.FAKE_KIN_PID_FILE) writeFileSync(process.env.FAKE_KIN_PID_FILE, String(process.pid));
if (mode === 'ok') { process.stdout.write('{"location":"in the kitchen"}'); }
else if (mode === 'fail503') { process.stderr.write('503 Service Unavailable: the model is overloaded'); process.exit(1); }
else if (mode === 'fail403') { process.stderr.write('403 Forbidden: grant chat:read is missing'); process.exit(1); }
else if (mode === 'silent-fail') { process.exit(2); }
else if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'ignore-term') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
