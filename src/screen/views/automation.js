// Start / Pause / Stop and the ruler. The ruler's label follows the thumb while dragging; the choice is saved on
// release (the app holds a render back while the thumb is held, so a status refresh cannot cut the drag short).
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { AUTO } from '../../core/state.js';
import { INTERVAL_STEPS, formatInterval, snapInterval } from '../../core/schedule.js';
import { automationStatus } from '../texts.js';

const STATE_WORDS = { [AUTO.RUNNING]: 'Running', [AUTO.PAUSED]: 'Paused', [AUTO.STOPPED]: 'Stopped' };
const every = (s) => `Every ${formatInterval(s)}`;

/** One of Start / Pause / Stop: sets the state, then the keyboard goes to `focusAfter`. */
function control(v, { key, text, iconName, enabled, state, focusAfter }) {
  return h('button', {
    type: 'button', class: `btn small${key === 'auto-start' ? ' primary' : ''}`, 'data-key': key, disabled: !enabled,
    onClick: () => { v.store.setRun(state); v.ui.renderAndFocus(focusAfter); },
  }, icon(iconName, { size: 16 }), text);
}

function ruler(v, value, label) {
  return h('input', {
    type: 'range', id: 'auto-ruler', class: 'ruler', 'data-key': 'auto-ruler', min: 0, max: INTERVAL_STEPS.length - 1, step: 1,
    value: Math.max(0, INTERVAL_STEPS.indexOf(value)), 'aria-valuetext': every(value),
    onPointerdown: () => v.ui.startDrag(),
    onInput: (ev) => { const s = INTERVAL_STEPS[Number(ev.target.value)]; label.textContent = every(s); ev.target.setAttribute('aria-valuetext', every(s)); },
    onChange: (ev) => { v.ui.stopDrag(); v.store.saveSettings({ intervalS: INTERVAL_STEPS[Number(ev.target.value)] }); },
  });
}

/** The line under the controls; while the Kin sleeps (and nothing runs), a "Wake now" link after it. */
function statusLine(v, entry, busy) {
  const { text, wakeNow } = automationStatus(entry, v.at);
  const link = wakeNow && !busy ? h('button', { type: 'button', class: 'link-btn', 'data-key': 'wake-now', onClick: () => v.store.update('wake') }, 'Wake now') : null;
  return h('p', { class: 'meta auto-status', 'data-testid': 'auto-status' }, text, link);
}

export function renderAutomation(v, entry, busy) {
  const run = v.S.settings.autoState;
  const value = snapInterval(v.S.settings.intervalS);
  const label = h('span', { class: 'auto-value', 'data-testid': 'auto-value', 'aria-hidden': 'true' }, every(value));
  return h('div', { class: 'auto', role: 'group', 'aria-labelledby': 'auto-title' },
    h('div', { class: 'auto-head' },
      h('span', { class: 'row-label', id: 'auto-title' }, 'Automatic update'),
      h('span', { class: `auto-state ${run}`, 'data-testid': 'auto-state' }, STATE_WORDS[run])),
    h('div', { class: 'auto-controls' },
      control(v, { key: 'auto-start', text: run === AUTO.PAUSED ? 'Resume' : 'Start', iconName: 'play', enabled: run !== AUTO.RUNNING, state: AUTO.RUNNING, focusAfter: 'auto-pause' }),
      control(v, { key: 'auto-pause', text: 'Pause', iconName: 'pause', enabled: run === AUTO.RUNNING, state: AUTO.PAUSED, focusAfter: 'auto-start' }),
      control(v, { key: 'auto-stop', text: 'Stop', iconName: 'stop', enabled: run !== AUTO.STOPPED, state: AUTO.STOPPED, focusAfter: 'auto-start' })),
    h('div', { class: 'auto-head' }, h('label', { class: 'row-label', for: 'auto-ruler' }, 'How often'), label),
    ruler(v, value, label),
    h('div', { class: 'ruler-ends muted', 'aria-hidden': 'true' }, h('span', {}, '15 min'), h('span', {}, '4 h')),
    statusLine(v, entry, busy),
    h('p', { class: 'help cost' }, 'Kindroid starts Clotheskin every 15 minutes, even while it is stopped. Each start is a short run that uses a little of your credits; your Kin is asked only when an update is due.'));
}
