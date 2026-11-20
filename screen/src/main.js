import { createLocalHost } from './host/local.js';
import { detectWorkshopHost } from './host/workshop.js';
import { Settings } from './core/store.js';
import { startApp } from './ui/app.js';
import { h } from './ui/dom.js';
import { icon, spinner } from './ui/icons.js';

const root = document.getElementById('app');

async function start(host) {
  const settings = new Settings(host.storage);
  await settings.load();
  window.__clotheskin = await startApp({ root, settings, host }); // handy for manual inspection and the browser tests
}

/**
 * Inside a frame the page around it should be the Kindroid Workshop. If it does not answer, say so (with a retry)
 * instead of quietly showing local mode, which has no Kins and would look like a broken app.
 */
function showNotConnected() {
  let busy = false;
  const render = () => root.replaceChildren(
    h('section', { class: 'card empty', role: 'alert', 'data-testid': 'not-connected' },
      h('div', { class: 'empty-art' }, icon('alert', { size: 40 })),
      h('h2', {}, 'Could not reach the Kindroid Workshop'),
      h('p', { class: 'muted' }, 'Clotheskin is open inside a frame, but the Workshop around it did not answer. Close and reopen the app. If it keeps happening, the Workshop may be down or under maintenance.'),
      h('button', { type: 'button', class: 'btn primary', 'data-key': 'connect-retry', 'aria-busy': String(busy), disabled: busy,
        onClick: async () => {
          busy = true; render();
          const host = await detectWorkshopHost({ timeouts: { kins: 5000 } }); // a slow host gets more time on a retry
          if (host) { await start(host); return; }
          busy = false; render();
          root.querySelector('[data-key="connect-retry"]')?.focus();
        } }, busy ? [spinner(), 'Trying…'] : [icon('refresh', { size: 18 }), 'Try again']),
      h('button', { type: 'button', class: 'link-btn', 'data-key': 'use-local', onClick: () => start(createLocalHost()) }, 'Use local mode instead')));
  render();
}

// Inside the Kindroid Workshop the page around the frame answers; a plain page is local mode.
const inFrame = window.parent !== window;
const host = await detectWorkshopHost({ timeouts: { kins: 3000 } });
if (host) await start(host);
else if (inFrame) showNotConnected();
else await start(createLocalHost());
