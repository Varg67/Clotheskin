import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('theme tokens match the Kindroid v2 reference sampling', () => {
  assert.equal(tokens.bg, '#f5f0eb');
  assert.equal(tokens.accent, '#c7503c');
  assert.equal(tokens.text, '#2b2b2b');
});

test('text and accent pairs meet WCAG AA (4.5:1) on the page background and glass surface', () => {
  const pairs = [
    ['text', 'bg'], ['muted', 'bg'], ['muted', 'glass-solid'], ['accent-deep', 'bg'],
    ['danger', 'bg'], ['ok', 'bg'], ['on-accent', 'accent'], ['on-accent', 'accent-hover'],
  ];
  for (const [fg, bgName] of pairs) {
    const r = ratio(tokens[fg], tokens[bgName]);
    assert.ok(r >= 4.5, `${fg} on ${bgName} is ${r.toFixed(2)}:1`);
  }
});

test('brand colour is only used for large bold text (AA large: 3:1)', () => {
  const r = ratio(tokens.brand, tokens.bg);
  assert.ok(r >= 3, `brand on bg is ${r.toFixed(2)}:1`);
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const uses = styles.split('\n').filter((l) => l.includes('var(--brand)'));
  assert.equal(uses.length, 1);
  assert.match(uses[0], /\.app-head h1/); // 1.35rem, weight 800
});

test('components use theme tokens, not raw colours', () => {
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const raw = styles.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  // only the white used for text on the dark hero scrim and the spinner is allowed
  assert.deepEqual([...new Set(raw)].filter((c) => !['#fff', '#ffd9cf'].includes(c.toLowerCase())), []);
});
