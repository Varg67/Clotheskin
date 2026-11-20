import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatRelative } from '../screen/src/core/format.js';

test('times are English and respect the supplied time zone', () => {
  const now = new Date('2026-11-19T15:00:00Z');
  assert.equal(formatClock('2026-11-19T12:30:00Z', { timeZone: 'America/Sao_Paulo', now }), '9:30 AM');
  assert.equal(formatClock('2026-11-18T12:30:00Z', { timeZone: 'UTC', now }), 'Nov 18, 12:30 PM');
});

test('relative times are English', () => {
  const now = new Date('2026-11-19T15:00:00Z');
  assert.equal(formatRelative('2026-11-19T14:59:40Z', now), 'just now');
  assert.equal(formatRelative('2026-11-19T14:55:00Z', now), '5 minutes ago');
  assert.equal(formatRelative('2026-11-19T12:00:00Z', now), '3 hours ago');
  assert.equal(formatRelative('2026-11-18T12:00:00Z', now), 'yesterday');
});

test('formatting dates is cheap: formatters are reused, so a screen full of times stays fast', () => {
  const iso = '2026-11-20T12:00:00Z';
  const now = new Date('2026-11-21T12:00:00Z');
  formatClock(iso, { now }); formatRelative(iso, now); // warm up
  const t = performance.now();
  for (let i = 0; i < 2000; i += 1) { formatClock(iso, { now }); formatRelative(iso, now); }
  const ms = performance.now() - t;
  assert.ok(ms < 250, `${ms.toFixed(0)} ms for 2000 (creating formatters each time took ~500 ms)`);
});
