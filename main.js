// Workshop run entry (kin.json: "run.entry": "node main.js"). Reads the trigger JSON from stdin,
// does the work, and always ends with `kin end`.
import { Repository } from './screen/src/core/store.js';
import { handleRun } from './run/actions.js';
import { KinFilesStorage, KinAskProvider, kinEnd } from './run/kin-cli.js';

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  const event = JSON.parse((await readStdin()) || '{}');
  const result = await handleRun({ event, repo: new Repository(new KinFilesStorage()), provider: new KinAskProvider() });
  await kinEnd(result.message, { failed: !result.ok });
} catch (e) {
  await kinEnd(`Clotheskin could not finish: ${e.message}`, { failed: true });
  process.exitCode = 1;
}
