import { createLocalHost } from './host/local.js';
import { detectWorkshopHost } from './host/workshop.js';
import { Settings } from './core/store.js';
import { startApp } from './ui/app.js';
import { h } from './ui/dom.js';
import { icon, spinner } from './ui/icons.js';

const root = document.getElementById('app');
let started = false; // only one app ever starts (a late Workshop answer must not start a second one over local mode)

async function start(host) {
  if (started) return;
  started = true;
  const settings = new Settings(host.storage);
  await settings.load();
  window.__clotheskin = await startApp({ root, settings, host }); // handy for manual inspection and the browser tests
}

/**
 * Inside a frame the page around it should be the Kindroid Workshop. If it does not answer, say so instead of quietly
 * showing local mode, which has no Kins and would look like a broken app. The screen keeps trying in the background
 * (a slow Workshop connects by itself); Try again tries at once.
 */
function showNotConnected() {
  let trying = false;
  const attempt = async () => {
    if (trying || started) return;
    trying = true; render();
    const host = await detectWorkshopHost({ timeouts: { kins: 5000 } }); // a slow host gets more time
    trying = false;
    if (host) {
      const hadFocus = root.contains(document.activeElement);
      await start(host);
      if (hadFocus) root.querySelector('[data-key="update"], [data-key^="pick-"], button')?.focus(); // keep the keyboard in the app
      return;
    }
    if (!started) render();
  };
  const render = () => {
    if (started) return;
    const hadFocus = root.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    root.replaceChildren(
      h('section', { class: 'card empty', role: 'alert', 'data-testid': 'not-connected' },
        h('div', { class: 'empty-art' }, icon('alert', { size: 40 })),
        h('h1', { class: 'not-connected-title' }, 'Could not reach the Kindroid Workshop'),
        h('p', { class: 'muted' }, 'Clotheskin is open inside a frame, but the Workshop around it did not answer. It keeps trying by itself. If it keeps failing, close and reopen the app: the Workshop may be down or under maintenance.'),
        // stays enabled while trying (aria-busy says so), so keyboard focus is never dropped
        h('button', { type: 'button', class: 'btn primary', 'data-key': 'connect-retry', 'aria-busy': String(trying), onClick: attempt },
          trying ? [spinner(), 'Trying…'] : [icon('refresh', { size: 18 }), 'Try again']),
        h('button', { type: 'button', class: 'link-btn', 'data-key': 'use-local', onClick: () => start(createLocalHost()) }, 'Use local mode instead')));
    if (hadFocus) root.querySelector(`[data-key="${hadFocus}"]`)?.focus();
  };
  render();
  let left = 30; // every 10 s for 5 minutes; each try listens on its own channel, so they are not endless
  const retry = setInterval(() => { left -= 1; if (started || left < 0) clearInterval(retry); else attempt(); }, 10000);
}

// Inside the Kindroid Workshop the page around the frame answers; a plain page is local mode.
const inFrame = window.parent !== window;
const host = await detectWorkshopHost({ timeouts: { kins: 3000 } });
if (host) await start(host);
else if (inFrame) showNotConnected();
else await start(createLocalHost());
