// What a screen reader is told. Two regions that stay in the page (a region rebuilt on every render would be read
// again and again): results and notes are polite, errors are assertive.
import { h } from './dom.js';

export function createAnnouncer(doc) {
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const alertLive = h('div', { class: 'sr-only', role: 'alert' });
  doc.body.append(live, alertLive);
  // Emptied first, then filled a moment later: the same text twice in a row is still read.
  const say = (region, text) => { region.textContent = ''; setTimeout(() => { region.textContent = text; }, 30); };
  let lastAlert = '';
  return {
    announce(text) { if (text) say(live, text); },
    /** An error is told once; the same error again only after forget() (a new try). */
    alertOnce(text) {
      if (text && text !== lastAlert) say(alertLive, text);
      lastAlert = text || '';
    },
    forget() { lastAlert = ''; },
  };
}
