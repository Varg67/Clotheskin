// The list of attached Kins, to pick the one of the current roleplay.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { kinStateLine } from '../texts.js';

/** The round picture of a Kin (the same person icon for all: Clotheskin has no access to their pictures). */
export function avatar(size) {
  return h('span', { class: 'avatar', style: `width:${size}px;height:${size}px` }, icon('person', { size: Math.round(size * 0.55) }));
}

/** `v` is the view: { S, store, ui, now, at }. `intro` goes above the list (null on the card). */
export function renderKinList(v, intro) {
  const current = v.store.selectedKin();
  return h('div', { class: 'picker' },
    intro,
    h('ul', { class: 'profile-list', role: 'list' }, ...v.store.known().map((k) => {
      const isCurrent = Boolean(current && current.id === k.id);
      const pick = () => { v.store.pick(k); v.ui.renderAndFocus('update'); };
      return h('li', {},
        h('button', { type: 'button', class: `profile-pick${isCurrent ? ' selected' : ''}`, 'aria-pressed': String(isCurrent), 'data-key': `pick-${k.id}`, onClick: pick },
          avatar(36), h('span', { class: 'pp-text' }, h('strong', {}, k.name), h('span', { class: 'muted' }, kinStateLine(v.store.entryOf(k.id), v.now))),
          isCurrent ? h('span', { class: 'tag' }, 'Selected') : null));
    })),
    h('p', { class: 'help' }, 'Only the selected Kin is read. To attach or detach a Kin, open Clotheskin’s settings in Kindroid Apps and use Kins.'));
}
