import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatRelative } from '../src/core/format.js';

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

test('formatWhen: a time tomorrow says so; today is just the time', async () => {
  const { formatWhen } = await import('../src/core/format.js');
  const now = new Date('2026-11-20T22:00:00-03:00');
  assert.equal(formatWhen('2026-11-21T10:30:00Z', { timeZone: 'America/Sao_Paulo', now }), '7:30 AM tomorrow');
  assert.equal(formatWhen('2026-11-21T01:50:00Z', { timeZone: 'America/Sao_Paulo', now }), '10:50 PM');
  assert.equal(formatWhen('2026-11-23T10:30:00Z', { timeZone: 'America/Sao_Paulo', now }), 'Nov 23, 7:30 AM');
});

test('formatWhen: the nights of a daylight-saving change still say "tomorrow" only for the next calendar day', async () => {
  const { formatWhen } = await import('../src/core/format.js');
  const tz = 'America/New_York';
  // 00:30 on Nov 1 (the clocks go back that night): 07:30 the same day is not "tomorrow"
  assert.equal(formatWhen('2026-11-01T12:30:00Z', { timeZone: tz, now: new Date('2026-11-01T04:30:00Z') }), '7:30 AM');
  // 23:30 on Mar 7 (the clocks go forward that night): 07:30 on Mar 8 is "tomorrow"
  assert.equal(formatWhen('2026-03-08T11:30:00Z', { timeZone: tz, now: new Date('2026-03-08T04:30:00Z') }), '7:30 AM tomorrow');
  // the last day of a month
  assert.equal(formatWhen('2026-12-01T10:30:00Z', { timeZone: 'America/Sao_Paulo', now: new Date('2026-12-01T01:00:00Z') }), '7:30 AM tomorrow');
});
