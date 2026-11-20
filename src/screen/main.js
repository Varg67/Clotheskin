// The screen's entry. Inside Kindroid it is a locked frame: it connects to the page around it, then shows the app.
// If nothing answers, it says so (and keeps trying for a while) instead of showing an empty app.
import { frameChannel } from './channel.js';
import { startApp } from './app.js';
import { h } from './dom.js';
import { icon, spinner } from './icons.js';
import { SETTINGS_FILE } from '../core/state.js';

const RETRY_EVERY_MS = 10000;
const RETRY_FOR_MS = 5 * 60000;
const FILES_ONLY_AFTER_MS = 1500; // the page answered files but not the Kins this long: a still picture of the screen

export function boot() {
  const root = document.getElementById('app');
  const channel = frameChannel(window);
  let started = false;

  /**
   * Connected when the page lists the Kins (Kindroid answers that at once). A page that answers files but not the Kins
   * also counts, after a short wait: the App Library takes its picture of the screen from the sample/ files, with no
   * Kindroid around (the names then come from status.json; if the Kins come later, the app takes them then).
   */
  function connect(timeout) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      channel.kins(timeout).then((kins) => finish({ kins }), () => { if (!channel.heard) finish(null); });
      channel.read(SETTINGS_FILE).then(() => setTimeout(() => finish({ kins: null }), FILES_ONLY_AFTER_MS), () => finish(null));
    });
  }

  async function start(kins) {
    if (started) return;
    started = true;
    const hadFocus = root.contains(document.activeElement);
    await startApp({ root, channel, kins });
    if (hadFocus) { const el = root.querySelector('[data-key="update"], [data-key^="pick-"], button'); if (el) el.focus(); }
  }

  /** The "Could not reach Kindroid" card: the alert is built once; later attempts only change the button and the text. */
  function notConnected(why) {
    let trying = false;
    let givenUp = false;
    const text = h('p', { class: 'muted' }, why);
    const button = h('button', { type: 'button', class: 'btn primary', 'data-key': 'connect-retry', onClick: () => attempt() });
    const paint = () => {
      button.setAttribute('aria-busy', String(trying));
      button.replaceChildren(...(trying ? [spinner(), 'Trying…'] : [icon('refresh', { size: 18 }), 'Try again']));
      if (givenUp) text.textContent = 'Clotheskin stopped trying by itself. Press Try again, or close and reopen the app.';
    };
    root.replaceChildren(h('section', { class: 'card empty', role: 'alert', 'data-testid': 'not-connected' },
      h('div', { class: 'empty-art' }, icon('alert', { size: 40 })),
      h('h1', { class: 'not-connected-title' }, 'Could not reach Kindroid'),
      text, channel ? button : null));
    paint();
    if (!channel) return;

    async function attempt() {
      if (trying || started) return;
      trying = true; paint();
      const c = await connect(5000);
      trying = false;
      if (c) { await start(c.kins); return; }
      paint();
    }
    const until = Date.now() + RETRY_FOR_MS;
    const timer = setInterval(() => {
      if (started) { clearInterval(timer); return; }
      if (Date.now() > until) { clearInterval(timer); givenUp = true; paint(); return; }
      attempt();
    }, RETRY_EVERY_MS);
  }

  if (!channel) {
    notConnected('Clotheskin is a Kindroid app: open it from Apps in Kindroid. To try it on your computer, run npm start and open the page it prints.');
    return;
  }
  connect().then((c) => {
    if (c) start(c.kins);
    else notConnected('The page around Clotheskin did not answer. It keeps trying by itself for a few minutes; if it keeps failing, close and reopen the app. Kindroid may be busy or under maintenance.');
  });
}
