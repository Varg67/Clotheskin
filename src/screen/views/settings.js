// The Settings section at the bottom: the theme, how Clotheskin works and what it keeps, and its version. (The choices
// that tell the Kin something are cards of their own, in plain sight: views/choices.js.)
import { h } from '../dom.js';
import { THEMES } from '../../core/state.js';
import { APP_VERSION } from '../../core/constants.js';

const HOW_IT_WORKS = 'Your Kin looks at its recent chat with you and says where it is, how it is positioned, what it is doing, what it is wearing, and its hair and makeup; Clotheskin shows that as short sentences. When it is asleep, Clotheskin asks when it will wake up, lets it sleep, and asks about its dream in the morning. Kept in the app’s files: the last reading, the night’s times, the last dream, and when your Kin was last told its look (a fingerprint, not the words). The dream is erased after a day, and Stop erases the night, the dream and what was told within 15 minutes. The chat is never kept.';

/** The dream choices (in views/choices.js, on a card of their own). */
export function dreamOptions(v) {
  const settings = v.S.settings;
  return [
    h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-key': 'tell-dream', checked: settings.tellDream || undefined, onChange: (ev) => v.store.saveSettings({ tellDream: ev.target.checked }) }),
      h('span', {}, 'Tell my Kin its dream, so it can remember it during the day')),
    h('label', { class: `check${settings.tellDream ? '' : ' off'}` }, h('input', {
      type: 'checkbox', 'data-key': 'reach-out', checked: (settings.tellDream && settings.reachOut) || undefined, disabled: !settings.tellDream || undefined,
      'aria-describedby': settings.tellDream ? undefined : 'reach-why', onChange: (ev) => v.store.saveSettings({ reachOut: ev.target.checked }),
    }), h('span', {}, 'Let my Kin bring the dream up by itself', settings.tellDream ? null : h('span', { class: 'why', id: 'reach-why' }, ' (needs the option above)'))),
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
      themePicker(v),
      h('h3', { class: 'sub' }, 'How it works'),
      h('p', { class: 'help' }, HOW_IT_WORKS),
      h('p', { class: 'help', 'data-testid': 'version' }, `Clotheskin ${APP_VERSION}`)));
}
