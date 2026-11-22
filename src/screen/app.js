// The screen: a view of status.json (written by the run) and the controls that write settings.json. The run does the
// work, every 15 minutes or when Update status is pressed; the screen never asks the Kin anything itself.
// Here the pieces meet: the store (state and actions), the announcer (screen reader), the views (the page) and what
// only the page knows: focus, the ruler's drag, the theme and the timers.
import { h, keepFocus } from './dom.js';
import { createStore } from './store.js';
import { createAnnouncer } from './announcer.js';
import { renderCard } from './views/card.js';
import { renderSettings } from './views/settings.js';
import { formatRelative } from '../core/format.js';

const POLL_MS = 60000; // status.json is read again every minute while the screen is visible
const RELATIVE_MS = 30000; // "5 minutes ago" is brought up to date this often

function applyTheme(id) {
  if (id === 'sage') document.documentElement.setAttribute('data-theme', 'sage');
  else document.documentElement.removeAttribute('data-theme');
}

/**
 * Starts the screen on a connected channel. `kins` is the first list from the page (null when the page answered
 * files but not the Kins, e.g. a still picture of the screen: the names then come from status.json).
 */
export async function startApp({ root, channel, kins, clock = () => new Date() }) {
  const announcer = createAnnouncer(document);
  const store = createStore({ channel, kins, clock, announcer, onChange: () => render() });

  // A render asked for while the ruler's thumb is held waits for the release.
  let dragging = false;
  let renderPending = false;
  const endDrag = () => { if (!dragging) return; dragging = false; if (renderPending) render(); };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  const ui = {
    renderAndFocus(key) { render(); const el = root.querySelector(`[data-key="${key}"]`); if (el) el.focus(); },
    startDrag() { dragging = true; },
    stopDrag() { dragging = false; },
    applyTheme,
  };

  function render() {
    if (dragging) { renderPending = true; return; }
    renderPending = false;
    const now = clock();
    const v = { S: store.S, store, ui, now, at: { settings: store.S.settings, now } };
    const hadFocus = root.contains(document.activeElement);
    keepFocus(root, () => {
      root.replaceChildren(
        h('header', { class: 'app-head' }, h('h1', {}, 'Clotheskin'), h('p', {}, 'Where your Kin is, what it is doing and what it is wearing')),
        renderCard(v),
        ...(store.selectedKin() ? [renderSettings(v)] : []), // replaceChildren would show a null as the text "null"
      );
    });
    // The focused control is gone (a banner closed, Wake now done, the Kin detached): the keyboard stays in the app.
    if (hadFocus && !root.contains(document.activeElement)) {
      const fallback = root.querySelector('[data-key="update"], [data-key^="pick-"], button');
      if (fallback) fallback.focus();
    }
  }

  await store.loadSettings();
  applyTheme(store.S.settings.theme);
  await store.loadStatus();
  store.syncSettings();
  channel.onKins((list) => store.kinsChanged(list));
  setInterval(() => { if (document.visibilityState !== 'hidden') store.loadStatus(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.loadStatus(); });
  setInterval(() => { for (const el of root.querySelectorAll('.rel[data-iso]')) el.textContent = formatRelative(el.dataset.iso, clock()); }, RELATIVE_MS);
  render();
}
