import { ReadCoordinator } from '../screen/src/core/reader.js';
import { sceneStatusText } from '../screen/src/core/summary.js';

const clip = (s, n = 480) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

async function ensureProfile(repo, id, input = {}) {
  let profile = await repo.getProfile(id);
  if (!profile) {
    profile = { id, name: input.name || id, pronouns: input.pronouns || null, avatarUrl: null, demo: false, createdAt: new Date().toISOString(), places: [] };
    await repo.saveProfile(profile);
  } else if ((input.name && input.name !== profile.name) || (input.pronouns !== undefined && (input.pronouns || null) !== (profile.pronouns || null))) {
    profile = await repo.updateProfile(id, (p) => ({ ...p, ...(input.name ? { name: input.name } : {}), ...(input.pronouns !== undefined ? { pronouns: input.pronouns || null } : {}) }));
  }
  return profile;
}

function summarize(result) {
  if (result.status !== 'ok') return { ok: false, message: clip(result.message) };
  const bits = result.applied.length ? result.applied.join('; ') : 'No changes found';
  const extra = result.unresolved.length ? ` ${result.unresolved.length} item(s) need review.` : '';
  const skipped = result.skipped.length ? ` ${result.skipped.length} change(s) skipped.` : '';
  return { ok: true, message: clip(`${bits}.${extra}${skipped}`) };
}

/**
 * Handles one run. `event` is the JSON the Workshop sends on stdin, e.g.
 *   {"trigger":"action","action":"read_scene","input":{"kin":"...","name":"..."},"kin":"<id when a Kin used it>"}
 * Returns { ok, message }; the caller turns that into `kin end`.
 */
export async function handleRun({ event, repo, provider, clock = () => new Date() }) {
  if (event?.trigger !== 'action') return { ok: false, message: `Unsupported trigger: ${event?.trigger}` };
  const input = event.input || {};
  const kinId = event.kin || input.kin;
  if (!kinId) return { ok: false, message: 'No Kin was given for this action.' };
  const coordinator = new ReadCoordinator({ repo, provider, clock });

  switch (event.action) {
    case 'read_scene': {
      await ensureProfile(repo, kinId, input);
      return summarize(await coordinator.read({ profileId: kinId, conversationId: null, messages: null }));
    }
    case 'update_scene': {
      await ensureProfile(repo, kinId, {});
      const { kin, ...doc } = input; // `kin` is never part of the document
      return summarize(await coordinator.submit({ profileId: kinId, text: JSON.stringify(doc) }));
    }
    case 'scene_status': {
      const record = await repo.getRecord(kinId, null);
      return { ok: true, message: sceneStatusText(record) };
    }
    default: return { ok: false, message: `Unknown action: ${event.action}` };
  }
}
