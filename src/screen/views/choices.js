// The choices that tell the Kin something, in plain sight on cards of their own (not inside Settings): nothing is told
// to the Kin unless the person ticks it (App Library review, Nov 2026).
import { h } from '../dom.js';
import { lookProblemText } from '../texts.js';
import { dreamOptions } from './settings.js';

/** Telling the Kin its outfit, hair and makeup when they change; and, when the last note failed, why and when again. */
export function renderLook(v) {
  const kin = v.store.selectedKin();
  const problem = lookProblemText(kin && v.store.entryOf(kin.id), v.at);
  return h('section', { class: 'card dreams', 'aria-labelledby': 'look-title' },
    h('div', { class: 'card-body' },
      h('h2', { class: 'section-title', id: 'look-title' }, 'Current look'),
      h('p', { class: 'help' }, 'Clotheskin can tell your Kin its outfit, hair and makeup when they change, so it stays consistent in your roleplay. Each note lasts 12 hours. Your Kin is not told anything unless you turn this on.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-key': 'tell-look', checked: v.S.settings.tellLook || undefined, onChange: (ev) => v.store.saveSettings({ tellLook: ev.target.checked }) }),
        h('span', {}, 'Tell my Kin its current look')),
      problem ? h('p', { class: 'help', role: 'status', 'data-testid': 'look-problem' }, problem) : null));
}

/** What Clotheskin does with the dream: shown for a day; told to the Kin only by choice. */
export function renderDreams(v) {
  return h('section', { class: 'card dreams', 'aria-labelledby': 'dreams-title' },
    h('div', { class: 'card-body' },
      h('h2', { class: 'section-title', id: 'dreams-title' }, 'Dreams'),
      h('p', { class: 'help' }, 'When your Kin wakes up, Clotheskin asks what it dreamt and shows it here for a day. Your Kin is not told its dream unless you turn this on.'),
      dreamOptions(v)));
}
