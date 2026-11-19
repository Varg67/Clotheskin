import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
const parse = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
const [warmBlock, sageBlock] = css.split(/:root\[data-theme="sage"\]/);
const warm = parse(warmBlock);
const sage = { ...warm, ...parse(sageBlock) };
const THEME_SETS = { warm, sage };
let tokens = warm;

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('warm theme matches the Kindroid v2 reference sampling', () => {
  assert.equal(warm.bg, '#f5f0eb');
  assert.equal(warm.accent, '#c7503c');
  assert.equal(warm.text, '#2b2b2b');
});

test('sage theme matches the green theme sampled from the desktop window', () => {
  assert.equal(sage.bg, '#f4f6f5');
  assert.equal(sage.text, '#283e36');
  assert.equal(sage['glass-solid'], '#f9faf9');
});

for (const [name, set] of Object.entries(THEME_SETS)) {
  test(`${name}: text and accent pairs meet WCAG AA (4.5:1)`, () => {
    const pairs = [
      ['text', 'bg'], ['muted', 'bg'], ['muted', 'glass-solid'], ['text', 'glass-solid'], ['accent-deep', 'bg'],
      ['danger', 'bg'], ['ok', 'bg'], ['on-accent', 'accent'], ['on-accent', 'accent-hover'],
    ];
    for (const [fg, bgName] of pairs) {
      const r = ratio(set[fg], set[bgName]);
      assert.ok(r >= 4.5, `${name}: ${fg} on ${bgName} is ${r.toFixed(2)}:1`);
    }
  });

  test(`${name}: brand colour is only for large bold text (AA large: 3:1)`, () => {
    const r = ratio(set.brand, set.bg);
    assert.ok(r >= 3, `${name}: brand on bg is ${r.toFixed(2)}:1`);
  });
}

test('brand colour is used once, for the large bold app title', () => {
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const uses = styles.split('\n').filter((l) => l.includes('var(--brand)'));
  assert.equal(uses.length, 1);
  assert.match(uses[0], /\.app-head h1/);
});

test('components use theme tokens, not raw colours', () => {
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const raw = styles.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual([...new Set(raw)].filter((c) => !['#fff', '#ffd9cf'].includes(c.toLowerCase())), []);
});
