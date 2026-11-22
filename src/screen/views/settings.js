// The Settings section under the card: the dream options, the theme, and how Clotheskin works.
import { h } from '../dom.js';
import { THEMES } from '../../core/state.js';

function dreamOptions(v) {
  const s = v.S.settings;
  return [
    h('h3', { class: 'sub' }, 'Dreams'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-key': 'tell-dream', checked: s.tellDream || undefined, onChange: (ev) => v.store.saveSettings({ tellDream: ev.target.checked }) }),
      h('span', {}, 'Tell my Kin its dream, so it can remember it during the day')),
    h('label', { class: `check${s.tellDream ? '' : ' off'}` }, h('input', {
      type: 'checkbox', 'data-key': 'reach-out', checked: (s.tellDream && s.reachOut) || undefined, disabled: !s.tellDream || undefined,
      'aria-describedby': s.tellDream ? undefined : 'reach-why', onChange: (ev) => v.store.saveSettings({ reachOut: ev.target.checked }),
    }), h('span', {}, 'Let my Kin bring the dream up by itself', s.tellDream ? null : h('span', { class: 'why', id: 'reach-why' }, ' (needs the option above)'))),
  ];
}

function themePicker(v) {
  const pickTheme = (ev) => { v.ui.applyTheme(ev.target.value); v.store.saveSettings({ theme: ev.target.value }); };
  return [
    h('h3', { class: 'sub' }, 'Appearance'),
    h('label', { class: 'label', for: 'theme-pick' }, 'Theme'),
    h('select', { id: 'theme-pick', class: 'text-input', 'data-key': 'theme-pick', onChange: pickTheme },
      ...Object.entries(THEMES).map(([id, text]) => h('option', { value: id, selected: v.S.settings.theme === id ? '' : undefined }, text))),
  ];
}

export function renderSettings(v) {
  return h('details', { class: 'reader', open: v.S.settingsOpen ? '' : undefined, onToggle: (ev) => { v.S.settingsOpen = ev.currentTarget.open; } },
    h('summary', { 'data-key': 'settings-summary' }, 'Settings'),
    h('div', { class: 'reader-body' },
      dreamOptions(v),
      themePicker(v),
      h('h3', { class: 'sub' }, 'How it works'),
      h('p', { class: 'help' }, 'Your Kin looks at its recent chat with you and says where it is, how it is positioned, what it is doing, what it is wearing, and its hair and makeup; Clotheskin shows that as short sentences. When it is asleep, Clotheskin asks when it will wake up, lets it sleep, and asks about its dream in the morning. Only the last reading and the night’s times are kept, never the chat.')));
}
