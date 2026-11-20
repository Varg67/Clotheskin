// The screen's entry. Inside Kindroid it is a locked frame: it connects to the page around it, then shows the app.
// If nothing answers, it says so (and keeps trying) instead of showing an empty app.
import { frameChannel } from './channel.js';
import { startApp } from './app.js';
import { h } from './dom.js';
import { icon, spinner } from './icons.js';
import { SETTINGS_FILE } from '../core/state.js';

const RETRY_EVERY_MS = 10000;
const RETRY_FOR_MS = 5 * 60000;

export function boot() {
  const root = document.getElementById('app');
  const channel = frameChannel(window);
  let started = false;

  /**
   * Connected when the page lists the Kins. A page that answers files but not Kins also counts: the App Library takes
   * its picture of the screen from the sample/ files, with no Kindroid around (the names then come from status.json).
   * Both are asked at once, so neither waits for the other.
   */
  async function connect(timeout) {
    const files = channel.read(SETTINGS_FILE).then(() => true, () => false);
    try { return { kins: await channel.kins(timeout) }; } catch { /* no Kin list: maybe files */ }
    if (!channel.heard) return null; // nothing at all answered: no need to wait for the file read to time out
    return (await files) ? { kins: null } : null;
  }

  async function start(kins) {
    if (started) return;
    started = true;
    const hadFocus = root.contains(document.activeElement);
    await startApp({ root, channel, kins });
    if (hadFocus) { const el = root.querySelector('[data-key="update"], [data-key^="pick-"], button'); if (el) el.focus(); }
  }

  function notConnected(why) {
    let trying = false;
    const attempt = async () => {
      if (trying || started) return;
      trying = true; render();
      const c = channel ? await connect(5000) : null;
      trying = false;
      if (c) { await start(c.kins); return; }
      render();
    };
    const render = () => {
      if (started) return;
      const focused = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
      root.replaceChildren(
        h('section', { class: 'card empty', role: 'alert', 'data-testid': 'not-connected' },
          h('div', { class: 'empty-art' }, icon('alert', { size: 40 })),
          h('h1', { class: 'not-connected-title' }, 'Could not reach Kindroid'),
          h('p', { class: 'muted' }, why),
          channel ? h('button', { type: 'button', class: 'btn primary', 'data-key': 'connect-retry', 'aria-busy': String(trying), onClick: attempt },
            trying ? [spinner(), 'Trying…'] : [icon('refresh', { size: 18 }), 'Try again']) : null));
      if (focused) { const el = root.querySelector(`[data-key="${focused}"]`); if (el) el.focus(); }
    };
    render();
    if (!channel) return;
    const until = Date.now() + RETRY_FOR_MS;
    const timer = setInterval(() => { if (started || Date.now() > until) clearInterval(timer); else attempt(); }, RETRY_EVERY_MS);
  }

  if (!channel) {
    notConnected('Clotheskin is a Kindroid app: open it from Apps in Kindroid. To try it on your computer, run npm start and open the page it prints.');
    return;
  }
  connect().then((c) => {
    if (c) start(c.kins);
    else notConnected('The page around Clotheskin did not answer. It keeps trying by itself; if it keeps failing, close and reopen the app. Kindroid may be busy or under maintenance.');
  });
}
