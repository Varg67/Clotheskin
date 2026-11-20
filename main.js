// Workshop run entry (kin.json: "run.entry": "node main.js"). Reads the trigger JSON from stdin, asks the Kin,
// and always ends with `kin end`. Triggers: the Update status action, and a schedule beat for automatic updates.
import { handleRun } from './run/actions.js';
import { KinAskProvider, KinFilesStorage, kinEnd, runKin } from './run/kin-cli.js';

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  const event = JSON.parse((await readStdin()) || '{}');
  // History and diagnostics are a convenience: their files get a short timeout so they can never delay a reading much.
  const journalStorage = new KinFilesStorage((args, opts) => runKin(args, { ...opts, timeoutMs: 15000 }));
  const result = await handleRun({ event, provider: new KinAskProvider(), storage: new KinFilesStorage(), journalStorage });
  await kinEnd(result.message, { failed: !result.ok });
} catch (e) {
  await kinEnd(`Clotheskin could not finish: ${e.message}`, { failed: true });
  process.exitCode = 1;
}
