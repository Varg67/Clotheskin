import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatRelative } from '../screen/src/core/format.js';
import { lookSummary, accessorySummary, hairIcon, postureIcon } from '../screen/src/core/summary.js';
import { buildDemoRecord } from '../screen/src/demo/demo.js';
import { displayValue } from '../screen/src/core/model.js';

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

test('demo record summary and display values', () => {
  const r = buildDemoRecord('2026-11-19T12:00:00Z');
  assert.equal(lookSummary(r), 'Wet lab coat over T-shirt, jeans, sneakers');
  assert.equal(accessorySummary(r), 'Glasses');
  assert.equal(displayValue('hair', 'low bun'), 'Low bun');
  assert.equal(displayValue('makeup', null), 'Unknown');
  assert.equal(displayValue('makeup', 'none'), 'No makeup');
  assert.equal(r.fields.makeup.value, null);
  assert.equal(hairIcon('low bun'), 'hair-up');
  assert.equal(hairIcon('loose'), 'hair-down');
  assert.equal(postureIcon('sitting on the sofa'), 'sitting');
  assert.equal(postureIcon('standing'), 'standing');
});

test('a one-piece garment is named once in the look summary', async () => {
  const { run, fresh } = await import('./helpers.js');
  const r = run(fresh(), { item_changes: [
    { op: 'wear', item_name: 'jeans', slot: 'bottomwear' },
    { op: 'wear', item_name: 'black dress', slot: 'topwear', covers: ['bottomwear'] },
  ] }).record;
  assert.equal((lookSummary(r).match(/dress/g) || []).length, 1);
});
