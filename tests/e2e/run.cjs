// Browser test of local mode at the Workshop window size (about 960x690), in a pt-BR browser. Run: npm run test:e2e
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is not installed. See the README.'); process.exit(2); }

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PT_CHAT = 'Isa: Hoje estou vestindo uma calça jeans azul, uma jaqueta de couro e uma camisa branca perfumada.';
const results = [];
let closeDialogs = async () => {};
const step = async (name, fn) => {
  try { await closeDialogs(); await fn(); results.push('ok'); console.log(`  ok   ${name}`); }
  catch (e) { results.push('FAIL'); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); }
};

(async () => {
  const { createAppServer } = await import('../../server.mjs');
  const server = createAppServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  // Browser deliberately in Brazilian Portuguese: the product must still be English.
  const ctx = await browser.newContext({ viewport: { width: 960, height: 690 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  ctx.setDefaultTimeout(4000);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  closeDialogs = async () => { while (await page.locator('dialog[open]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(30); } };
  const key = (k) => page.locator(`[data-key="${k}"]`);
  const outfit = () => page.locator('[data-testid="outfit"]').innerText();
  const idle = () => page.locator('[data-key="update"][aria-busy="false"]').waitFor();
  const runScene = async (id) => { await key('scene-pick').selectOption(id); await key('demo-run').click(); await idle(); };

  await page.goto(url);
  await page.waitForSelector('[data-key="update"]');

  await step('English everywhere under a pt-BR browser; nothing is read until asked', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    const dom = await page.evaluate(() => document.body.textContent);
    for (const w of ['Current outfit', 'Update status', 'Last checked: never', 'No outfit read yet. Press Update status.']) assert.ok(dom.includes(w), w);
    assert.ok(!/Atualizar|Roupa|Última/.test(dom));
  });

  await step('window-sized layout: card 440 px on the left, workspace on the right, button in view, no horizontal scroll', async () => {
    const card = await page.locator('.card').boundingBox();
    const work = await page.locator('.reader').boundingBox();
    assert.ok(Math.abs(card.width - 440) < 2, `${card.width}`);
    assert.ok(work.x >= card.x + card.width + 20);
    const u = await key('update').boundingBox();
    assert.ok(u.y + u.height <= 690, `${u.y + u.height}`);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await page.screenshot({ path: path.join(SHOTS, '01-local-empty.png') });
  });

  await step('the brief example: a Portuguese chat becomes one English sentence', async () => {
    await runScene('pt-jeans-jacket');
    assert.equal(await outfit(), 'Wearing a leather jacket, a perfumed white shirt and blue jeans.');
    assert.match(await page.locator('[data-testid="last-checked"]').innerText(), /Last checked: \d{1,2}:\d{2} (AM|PM) · just now/);
    assert.equal(await page.locator('#chat').inputValue(), 'Isa: *sorri e ajeita a gola* Hoje estou vestindo uma calça jeans azul, uma jaqueta de couro e uma camisa branca perfumada.', 'pasted chat is kept verbatim');
    await page.screenshot({ path: path.join(SHOTS, '02-local-sentence.png') });
  });

  await step('manual flow: Prepare prompt shows activity and the chat verbatim; the pasted JSON becomes the sentence', async () => {
    await page.locator('#chat').fill(PT_CHAT);
    await key('prepare').click();
    await page.waitForSelector('#prompt-view');
    const prompt = await page.locator('#prompt-view').inputValue();
    assert.ok(prompt.includes(PT_CHAT));
    assert.match(prompt, /^You are Isa\./);
    assert.equal(await key('update').getAttribute('aria-busy'), 'true');
    assert.match(await key('update').innerText(), /Waiting for the answer/);
    await page.locator('#response').fill('{"topwear":["a white shirt"],"bottomwear":["blue jeans"],"footwear":["sneakers"]}');
    await key('apply').click();
    await idle();
    assert.equal(await outfit(), 'Wearing a white shirt, blue jeans and sneakers.');
  });

  await step('a bad answer: alert in English, the previous sentence stays, retry offered', async () => {
    await page.locator('#response').fill('{ broken');
    await key('apply').click();
    const b = page.locator('[data-testid="banner"]');
    assert.equal(await b.getAttribute('role'), 'alert');
    assert.match(await b.innerText(), /not valid JSON/);
    assert.ok((await b.innerText()).includes('Try again'));
    assert.equal(await outfit(), 'Wearing a white shirt, blue jeans and sneakers.');
    await runScene('in-character');
    assert.match(await page.locator('[data-testid="banner"]').innerText(), /not valid JSON/);
  });

  await step('accessories and bags, a taken-off cardigan, answers without slot names, and a chat that says nothing', async () => {
    await runScene('accessories-bag');
    assert.equal(await outfit(), 'Wearing a black dress and ankle boots, with round glasses, a silver necklace and a brown backpack.');
    await runScene('taken-off');
    assert.equal(await outfit(), 'Wearing a T-shirt and jeans.');
    await runScene('loose-keys');
    assert.equal(await outfit(), 'Wearing a striped sweater, sneakers and a cap, with a watch.');
    await runScene('nothing-said');
    assert.equal(await outfit(), 'No outfit described in the recent chat.');
    assert.equal(await page.locator('[data-testid="banner"]').count(), 0, 'a successful reading clears the old error');
  });

  await step('keyboard: Update status is reachable and activates with Enter', async () => {
    await page.locator('#chat').fill(PT_CHAT);
    await key('update').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#prompt-view');
    await key('cancel-read').click();
    assert.match(await page.locator('[data-testid="banner"]').innerText(), /cancelled/);
  });

  await step('nothing about the outfit is saved: only preferences survive a reload', async () => {
    await page.locator('#theme-pick').selectOption('sage');
    await page.reload(); await page.waitForSelector('[data-key="update"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'sage', 'theme persists');
    assert.equal(await outfit(), 'No outfit read yet. Press Update status.', 'the outfit is gone after reload');
    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    assert.deepEqual(Object.keys(stored), ['clotheskin:v2:settings']);
    assert.ok(!/jeans|jacket|sweater|dress/i.test(JSON.stringify(stored)), 'no garment in storage');
    await page.screenshot({ path: path.join(SHOTS, '03-local-sage.png') });
    await page.locator('#theme-pick').selectOption('warm');
  });

  await step('no page errors or console errors', async () => { assert.deepEqual(problems, []); });

  await browser.close(); server.close();
  const failed = results.filter((r) => r !== 'ok').length;
  console.log(`\n${results.length - failed}/${results.length} local-mode checks passed`);
  process.exit(failed ? 1 : 0);
})();
