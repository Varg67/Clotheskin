// The card: the Kin on screen, its reading (location, pose and action, outfit, hair, makeup, last dream), Update
// status, a warning or a problem, and the automatic update. Without a Kin: connecting, none attached, or the picker.
import { h } from '../dom.js';
import { icon, spinner, poseIcon, hairIcon } from '../icons.js';
import { warningOf, AUTO } from '../../core/state.js';
import { describeDream } from '../../core/sleep.js';
import { formatClock, formatRelative } from '../../core/format.js';
import { warningText, problemText, visibleDream } from '../texts.js';
import { avatar, renderKinList } from './kinList.js';
import { renderAutomation } from './automation.js';

/** `v` is the view: { S, store, ui, now, at }. */
export function renderCard(v) {
  const kin = v.store.selectedKin();
  if (!kin) return renderNoKin(v);
  const entry = v.store.entryOf(kin.id);
  const busy = v.S.busy[kin.id];
  return h('section', { class: 'card', 'aria-label': `${kin.name}: current status` },
    renderTop(v, kin),
    v.S.picking ? h('div', { class: 'card-body' }, renderKinList(v, null)) : null,
    h('div', { class: 'card-body' },
      h('h2', { class: 'section-title' }, 'Current status'),
      renderFacts(entry.reading, visibleDream(entry, v.now)),
      renderUpdate(v, entry.reading, busy),
      renderBanner(v, { kin, entry, busy }),
      renderAutomation(v, entry, busy)));
}

function renderNoKin(v) {
  if (!v.store.known().length && !v.S.kinsKnown) return h('section', { class: 'card empty' }, h('p', { class: 'muted' }, 'Connecting to Kindroid…'));
  if (!v.store.known().length) {
    return h('section', { class: 'card empty' },
      h('div', { class: 'empty-art' }, icon('users', { size: 40 })),
      h('h2', {}, 'Select a Kin'),
      h('p', { class: 'muted' }, 'No Kin is attached to this app yet. In Kindroid Apps, open Clotheskin’s settings, go to Kins and tick the Kin you want to follow.'));
  }
  return h('section', { class: 'card picker-card', 'aria-labelledby': 'picker-title' },
    renderKinList(v, [h('h2', { id: 'picker-title' }, 'Select a Kin'), h('p', { class: 'muted' }, 'Which Kin is in your roleplay now?')]));
}

/** The Kin's name, and when others are attached, how many and the button that opens the list. */
function renderTop(v, kin) {
  const others = v.store.known().length - 1;
  const toggle = () => { v.S.picking = !v.S.picking; v.ui.renderAndFocus(v.S.picking ? `pick-${kin.id}` : 'switch'); };
  return h('div', { class: 'card-top' },
    h('div', { class: 'who-row' }, avatar(48), h('span', { class: 'who' }, h('span', { class: 'name' }, kin.name),
      others > 0 ? h('span', { class: 'muted small', 'data-testid': 'only-this' }, `Only this Kin is read · ${others} other${others > 1 ? 's' : ''} attached`) : null)),
    others > 0 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': v.S.picking ? 'Close the Kin list' : 'Switch Kin', 'aria-expanded': String(v.S.picking), 'data-key': 'switch', onClick: toggle },
      icon(v.S.picking ? 'close' : 'users', { size: 20 })) : null);
}

/** One row of the reading: an icon, a label, and the sentence (or what to say when there is none yet). */
function fact({ iconName, label, testid, value, empty = '' }) {
  return h('div', { class: `fact${value ? '' : ' empty'}` },
    h('span', { class: 'row-icon' }, icon(iconName, { size: 24 })),
    h('span', { class: 'fact-text' }, h('span', { class: 'row-label' }, label), h('span', { class: 'fact-value', 'data-testid': testid }, value || empty)));
}

/** Hair, makeup and the dream have a row only when there is something to say. */
function renderFacts(r, dream) {
  return h('div', { class: 'facts' },
    fact({ iconName: 'pin', label: 'Location', testid: 'location', value: r && r.location, empty: 'No location read yet.' }),
    fact({ iconName: r ? poseIcon(r.doing) : 'person', label: 'Pose and action', testid: 'doing', value: r && r.doing, empty: 'No pose or action read yet.' }),
    fact({ iconName: 'hanger', label: 'Outfit', testid: 'outfit', value: r && r.outfit, empty: 'No outfit read yet. Press Update status.' }),
    r && r.hair ? fact({ iconName: hairIcon(r.hair), label: 'Hair', testid: 'hair', value: r.hair }) : null,
    r && r.makeup ? fact({ iconName: 'makeup', label: 'Makeup', testid: 'makeup', value: r.makeup }) : null,
    dream ? fact({ iconName: 'moon', label: 'Last dream', testid: 'dream', value: describeDream(dream) }) : null);
}

/** Update status (busy while a run goes on) and when the last reading was. */
function renderUpdate(v, r, busy) {
  return [
    h('button', { type: 'button', class: 'btn primary block', 'data-key': 'update', 'aria-busy': String(Boolean(busy)), onClick: () => v.store.update('read') },
      busy ? [spinner(), busy === 'wake' ? 'Asking about the dream…' : 'Reading…'] : [icon('refresh', { size: 18 }), 'Update status']),
    h('p', { class: 'meta', 'data-testid': 'last-checked' }, 'Last read: ',
      r && r.at ? [h('time', { datetime: r.at }, formatClock(r.at, { now: v.now })), ' · ', h('span', { class: 'rel', 'data-iso': r.at }, formatRelative(r.at, v.now))] : 'never'),
  ];
}

function banner(v, { kind, testid, text, button }) {
  return h('div', { class: `banner ${kind}`, 'data-testid': testid }, icon('alert', { size: 18 }), h('span', { class: 'banner-text' }, text),
    h('button', { type: 'button', class: 'btn small', 'data-key': 'retry', onClick: () => v.store.update('read') }, button));
}

/**
 * A warning about Kindroid itself (while the automatic update runs), else the problem: a setting that was not saved,
 * the action's own error, or the last run's (never while a run goes on).
 */
function renderBanner(v, { kin, entry, busy }) {
  const warning = v.S.settings.autoState === AUTO.RUNNING ? warningOf(entry) : null;
  if (warning) return banner(v, { kind: 'warn', testid: 'server-warning', text: warningText(warning, entry, v.at), button: 'Try now' });
  const own = v.S.error && (v.S.error.save || v.S.error.kinId === kin.id) ? v.S.error.text : null;
  const problem = own || (entry.error ? problemText(entry, kin.name, v.at) : null);
  return problem && !busy ? banner(v, { kind: 'error', testid: 'banner', text: problem, button: 'Try again' }) : null;
}
