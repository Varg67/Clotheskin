// Own icon set: 24x24, stroke-based, inherits colour through currentColor.
const P = {
  hanger: '<path d="M12 7.2a2.2 2.2 0 1 1 2.2 2.2c-1.2.3-2.2 1-2.2 2.2v.9"/><path d="M12 12.5 3.6 17.8a1.3 1.3 0 0 0 .7 2.4h15.4a1.3 1.3 0 0 0 .7-2.4z"/>',
  sitting: '<circle cx="8.5" cy="5" r="2"/><path d="M8.5 8.2v5h6.2l1.8 5.3M8.5 13.2l-1.3 5.3M5.5 18.5h4"/>',
  standing: '<circle cx="12" cy="4.8" r="2"/><path d="M12 8v6M8 10.4 12 8l4 2.4M12 14l-3 7M12 14l3 7"/>',
  person: '<circle cx="12" cy="8.2" r="3.8"/><path d="M4.5 20.5c0-3.8 3.4-6 7.5-6s7.5 2.2 7.5 6"/>',
  pin: '<path d="M12 21s7-6 7-11.2a7 7 0 0 0-14 0C5 15 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.4-4.2L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.4 4.2L20 15"/><path d="M20 20v-5h-5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c0-3.3 2.7-5.2 6-5.2s6 1.9 6 5.2"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.8c1.8.7 3 2.2 3 4.7"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
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

/** Icon for the pose and action row: sitting, standing, or a plain person. */
export function poseIcon(pose) {
  const v = pose || '';
  if (/\b(sitting|seated|lying|laying|kneeling|crouching|squatting|reclining|resting|lounging|sleeping|curled)\b/i.test(v)) return 'sitting';
  if (/\b(standing|walking|leaning|stretched)\b/i.test(v)) return 'standing';
  return 'person';
}
