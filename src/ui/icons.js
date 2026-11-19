// Own icon set: 24x24, stroke-based, inherits colour through currentColor.
const P = {
  hanger: '<path d="M12 7.2a2.2 2.2 0 1 1 2.2 2.2c-1.2.3-2.2 1-2.2 2.2v.9"/><path d="M12 12.5 3.6 17.8a1.3 1.3 0 0 0 .7 2.4h15.4a1.3 1.3 0 0 0 .7-2.4z"/>',
  glasses: '<circle cx="6.5" cy="14.5" r="3.5"/><circle cx="17.5" cy="14.5" r="3.5"/><path d="M10 14.5h4M3 14.5 4.6 8M21 14.5 19.4 8"/>',
  'hair-down': '<circle cx="12" cy="8" r="3.6"/><path d="M8.4 8c-.4 5-1.4 8.4-3.4 11M15.6 8c.4 5 1.4 8.4 3.4 11M12 11.6V14"/>',
  'hair-up': '<circle cx="12" cy="4.6" r="2.3"/><path d="M7.2 14.2a4.8 4.8 0 0 1 9.6 0v.8a4.8 4.8 0 0 1-9.6 0z"/><path d="M12 7v2.6"/>',
  makeup: '<path d="M3 12.2c2.6-3.6 5.6-4 9-1.9 3.4-2.1 6.4-1.7 9 1.9-2.6 4.6-5.6 6.2-9 6.2s-6.4-1.6-9-6.2z"/><path d="M3 12.2h18"/>',
  sitting: '<circle cx="8.5" cy="5" r="2"/><path d="M8.5 8.2v5h6.2l1.8 5.3M8.5 13.2l-1.3 5.3M5.5 18.5h4"/>',
  standing: '<circle cx="12" cy="4.8" r="2"/><path d="M12 8v6M8 10.4 12 8l4 2.4M12 14l-3 7M12 14l3 7"/>',
  person: '<circle cx="12" cy="8.2" r="3.8"/><path d="M4.5 20.5c0-3.8 3.4-6 7.5-6s7.5 2.2 7.5 6"/>',
  pin: '<path d="M12 21s7-6 7-11.2a7 7 0 0 0-14 0C5 15 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.4-4.2L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.4 4.2L20 15"/><path d="M20 20v-5h-5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c0-3.3 2.7-5.2 6-5.2s6 1.9 6 5.2"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.8c1.8.7 3 2.2 3 4.7"/>',
  bag: '<path d="M6 8h12l1.2 11.2a1 1 0 0 1-1 1.1H5.8a1 1 0 0 1-1-1.1z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  trash: '<path d="M4 7h16M10 7V4.5h4V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.6"/><path d="m4 17.5 5-4.5 4 3.5 3-2.5 4 3.5"/>',
};

export function icon(name, { size = 22, cls = '' } = {}) {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">${P[name] || P.person}</svg>`;
  return span;
}

export function spinner() {
  const s = document.createElement('span');
  s.className = 'spinner';
  s.setAttribute('aria-hidden', 'true');
  return s;
}
