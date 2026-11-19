// Browser test at the real Workshop window size (about 960x690 beside the Kindroid sidebar), in a pt-BR browser. Run: npm run test:e2e   (needs Playwright + Chromium; see README)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is not installed. See the README section "Browser test".'); process.exit(2); }

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PT_EXAMPLE = 'Isa: Visto um cardigan verde por cima da camiseta, prendo o cabelo num coque e levanto. Daqui a pouco vou pra faculdade.';

const results = [];
let closeDialogs = async () => {};
async function step(name, fn) {
  try { await closeDialogs(); await fn(); results.push(['ok', name]); console.log(`  ok   ${name}`); }
  catch (e) { results.push(['FAIL', name]); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`); }
}

(async () => {
  const { createAppServer } = await import('../../server.mjs');
  const server = createAppServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  // Browser deliberately set to Brazilian Portuguese: the product must still be English.
  const ctx = await browser.newContext({ viewport: { width: 960, height: 690 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(4000);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

  closeDialogs = async () => { while (await page.locator('dialog[open]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(30); } };
  const key = (k) => page.locator(`[data-key="${k}"]`);
  const text = () => page.locator('body').innerText();
  const openReader = async () => { const open = await page.locator('details.reader').evaluate((d) => d.open); if (!open) await key('reader-summary').click(); };
  const runScene = async (id) => { await openReader(); await key('scene-pick').selectOption(id); await key('demo-run').click(); await page.waitForFunction(() => document.querySelector('[data-key="update"]')?.getAttribute('aria-busy') === 'false'); };
  const itemNames = async (section) => page.locator(`.sheet section[aria-label="${section}"] .item-name`).allInnerTexts();

  await page.goto(url);
  await page.waitForSelector('[data-key="update"]');

  await step('English everywhere under a pt-BR browser; document language is en', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    const t = await text();
    for (const w of ['Current status', 'Location', 'Clothing', 'Accessories', 'Hair', 'Makeup', 'Posture', 'Update status', 'Last checked']) assert.ok(t.toLowerCase().includes(w.toLowerCase()), w);
    const domText = await page.evaluate(() => document.body.textContent);
    assert.ok(domText.includes('Current status') && domText.includes('Location'), 'DOM text keeps the exact English labels');
    assert.ok(!/Última|Atualizar|Roupa|Cabelo|Maquiagem|Postura/.test(t));
    assert.match(await page.locator('[data-testid="last-checked"]').innerText(), /Last checked: \d{1,2}:\d{2} (AM|PM) · just now/);
    assert.match(await text(), /Makeup\s+Unknown/);
  });

  await step('Workshop-sized window (960x690): card left (440 px), workspace right, update button in view, no horizontal overflow', async () => {
    const ov = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok((await ov()) <= 0);
    const card = await page.locator('.card').boundingBox();
    const work = await page.locator('.reader').boundingBox();
    assert.ok(Math.abs(card.width - 440) < 2, `card width ${card.width}`);
    assert.ok(work.x >= card.x + card.width + 20, 'workspace sits to the right of the card');
    assert.ok(work.width > 400, `workspace width ${work.width}`);
    assert.ok(await page.locator('#conversation').isVisible(), 'workspace is open by default');
    const u = await key('update').boundingBox();
    assert.ok(u.y + u.height <= 690, `Update status bottom at ${u.y + u.height}`);
    await page.screenshot({ path: path.join(SHOTS, '01-main-workshop-window.png') });
  });

  await step('lab coat off onto the chair: T-shirt stays, coat keeps "wet" and is left at the chair', async () => {
    await runScene('lab-coat');
    assert.match(await page.locator('[data-testid="look"]').innerText(), /^T-shirt, jeans, sneakers$/);
    await key('row-clothing').click();
    assert.deepEqual(await itemNames('Top'), ['T-shirt']);
    const notWorn = await page.locator('.sheet section[aria-label="Not worn"]').innerText();
    assert.match(notWorn, /lab coat/i); assert.match(notWorn, /Left at: chair/); assert.match(notWorn, /wet/);
    await key('row-clothing').evaluate(() => {}); await page.keyboard.press('Escape');
  });

  await step('cardigan scene applied in English, then the Portuguese version: still one cardigan over the T-shirt', async () => {
    await runScene('cardigan-bun'); await runScene('cardigan-bun-pt'); await runScene('cardigan-bun-pt');
    assert.match(await text(), /Hair\s+Bun/); assert.match(await text(), /Posture\s+Standing/);
    assert.match(await text(), /Living room at the shared house/);
    await key('row-clothing').click();
    assert.deepEqual(await itemNames('Top'), ['Green cardigan', 'T-shirt']);
    await page.screenshot({ path: path.join(SHOTS, '02-clothing-editor.png') });
    await page.keyboard.press('Escape');
  });

  await step('Portuguese conversation stays verbatim in the field and in the generated prompt', async () => {
    await openReader();
    await page.locator('#conversation').fill(PT_EXAMPLE);
    await key('prepare').click(); // same text was already processed by the demo scene
    assert.match(await page.locator('[data-testid="banner"]').innerText(), /no new messages/i);
    await key('read-again').click();
    await page.waitForSelector('#prompt-view');
    const prompt = await page.locator('#prompt-view').inputValue();
    assert.ok(prompt.includes(PT_EXAMPLE));
    assert.match(prompt, /TARGET CHARACTER: Isa \(stable ID: demo-isa; pronouns: she\/her\)/);
    assert.match(prompt, /OPERATION CONTRACT/);
    assert.equal(await page.locator('#conversation').inputValue(), PT_EXAMPLE);
    assert.equal(await key('update').getAttribute('aria-busy'), 'true');
    assert.match(await key('update').innerText(), /Reading…/);
  });

  await step('manual correction during a pending reading survives the late response', async () => {
    await key('hero').click();
    await page.locator('#field-input').fill('kitchen');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('#response').fill(JSON.stringify({ state_updates: { location: 'garden', hair: 'braid' }, item_changes: [] }));
    await key('apply').click();
    await page.waitForFunction(() => document.querySelector('[data-key="update"]')?.getAttribute('aria-busy') === 'false');
    const t = await text();
    assert.match(t, /Hair\s+Braid/);
    assert.match(t, /Kitchen/);
    assert.ok(!/Garden/.test(await page.locator('[data-key="hero"]').innerText()));
    assert.match(t, /Edited manually/);
    assert.match(await page.locator('[data-testid="banner"]').innerText(), /skipped/i);
  });

  await step('invalid JSON: alert in English, saved data intact, retry offered', async () => {
    const before = await page.locator('.rows').innerText();
    await openReader();
    await page.locator('#conversation').fill('Isa: another line');
    await page.locator('#response').fill('{ broken');
    await key('apply').click();
    const banner = page.locator('[data-testid="banner"]');
    await banner.waitFor();
    assert.equal(await banner.getAttribute('role'), 'alert');
    assert.match(await banner.innerText(), /not valid JSON/);
    assert.ok((await banner.innerText()).includes('Try again'));
    assert.equal(await page.locator('.rows').innerText(), before);
  });

  await step('"No makeup" and arrival: location changes only after arriving', async () => {
    await runScene('no-makeup');
    assert.match(await text(), /Makeup\s+No makeup/);
    await runScene('leaving');
    assert.match(await page.locator('[data-key="hero"]').innerText(), /Kitchen/);
    await runScene('arrived');
    assert.match(await page.locator('[data-key="hero"]').innerText(), /Hospital/);
    assert.match(await page.locator('.card-top').innerText(), /Hospital/);
  });

  await step('editor: layers, take off, wear again, Cancel discards, Save keeps', async () => {
    await key('row-clothing').click();
    await page.locator('[aria-label="Move green cardigan inward"]').click();
    assert.deepEqual(await itemNames('Top'), ['T-shirt', 'Green cardigan']);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await key('row-clothing').click();
    assert.deepEqual(await itemNames('Top'), ['Green cardigan', 'T-shirt'], 'Cancel must discard');
    await page.locator('[aria-label="Take off T-shirt"]').click();
    await page.locator('[data-key="add-headwear"]').fill('baseball cap');
    await page.locator('[data-key="addbtn-headwear"]').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    assert.match(await page.locator('[data-testid="look"]').innerText(), /baseball cap/i);
    assert.ok(!/T-shirt/.test(await page.locator('[data-testid="look"]').innerText()));
  });

  await step('phone in the brown bag, glasses in the cardigan pocket (scenes) reflected in editors', async () => {
    await runScene('glasses-pocket'); await runScene('phone-bag');
    await key('row-accessories').click();
    const sheet = await page.locator('.sheet').innerText();
    assert.match(sheet, /brown bag/i);
    assert.match(sheet, /In the left pocket of green cardigan/);
    await page.keyboard.press('Escape');
  });

  await step('dress + clip: one dress item, clip in head accessories, hair unchanged', async () => {
    await runScene('dress-clip');
    assert.match(await page.locator('[data-testid="look"]').innerText(), /^Black dress, jeans/);
    assert.ok(!/dress.*dress/i.test(await page.locator('[data-testid="look"]').innerText()), 'dress named once');
    assert.match(await text(), /Hair\s+Braid/);
    await key('row-clothing').click();
    assert.equal((await itemNames('Top')).filter((n) => /Black dress/.test(n)).length, 1);
    await page.keyboard.press('Escape');
  });

  await step('keyboard: toggle, rows and dialogs are reachable; Escape closes and returns focus', async () => {
    await key('toggle').focus();
    await page.keyboard.press('Enter');
    assert.equal(await key('toggle').getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Enter');
    assert.equal(await key('toggle').getAttribute('aria-expanded'), 'true');
    await key('row-hair').focus();
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('dialog[open] #field-input').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'field-input');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-key')), 'row-hair');
  });

  await step('new companion starts unknown (no demo items); two same-name Kins stay independent; renaming keeps data', async () => {
    const make = async (name, id) => {
      await key('switch').click();
      await key('new-profile').click();
      await page.locator('#pf-name').fill(name); await page.locator('#pf-id').fill(id);
      await key('pf-save').click();
      await page.waitForSelector('dialog', { state: 'detached' });
    };
    await make('Alex', 'alex-A');
    assert.match(await page.locator('.card-top .name').innerText(), /Alex/);
    assert.match(await text(), /Clothing\s+Unknown/); assert.match(await text(), /Hair\s+Unknown/);
    assert.ok(!/Black dress|Isa/.test(await page.locator('.card').innerText()));
    await key('row-hair').click(); await page.locator('#field-input').fill('short and wavy');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await make('Alex', 'alex-B');
    assert.match(await text(), /Hair\s+Unknown/);
    await key('switch').click();
    await key('edit-alex-A').click(); await page.locator('#pf-name').fill('Alexander');
    await key('pf-save').click();
    await page.waitForSelector('dialog', { state: 'detached' });
    await key('switch').click(); await key('pick-alex-A').click();
    await page.waitForSelector('dialog', { state: 'detached' });
    assert.match(await page.locator('.card-top .name').innerText(), /Alexander/);
    assert.match(await text(), /Hair\s+Short and wavy/);
    await page.screenshot({ path: path.join(SHOTS, '03-new-companion.png'), fullPage: true });
  });

  await step('reading started for one Alex lands on that Alex after switching and renaming', async () => {
    await openReader();
    await page.locator('#conversation').fill('Alex: I put on a black coat');
    await key('prepare').click(); await page.waitForSelector('#prompt-view');
    await key('switch').click(); await key('pick-alex-B').click(); await page.waitForSelector('dialog', { state: 'detached' });
    await page.evaluate(() => window.__clotheskin.S.pending && null);
    await key('switch').click(); await key('edit-alex-A').click(); await page.locator('#pf-name').fill('Alex Prime'); await key('pf-save').click();
    await page.waitForSelector('dialog', { state: 'detached' });
    await page.evaluate(() => window.__clotheskin.provider.resolve(JSON.stringify({ item_changes: [{ op: 'wear', item_name: 'black coat', slot: 'topwear' }] })));
    await page.waitForTimeout(300);
    assert.match(await text(), /Clothing\s+Unknown/); // Alex B untouched
    await key('switch').click(); await key('pick-alex-A').click(); await page.waitForSelector('dialog', { state: 'detached' });
    assert.match(await page.locator('[data-testid="look"]').innerText(), /Black coat/);
    assert.match(await page.locator('.card-top .name').innerText(), /Alex Prime/);
  });

  await step('demo responses refuse to touch a non-demo companion', async () => {
    await runScene('no-makeup');
    assert.match(await page.locator('[data-testid="banner"]').innerText(), /Demo responses only update the demo profile/);
  });

  await step('data survives reload; switching profiles restores each one', async () => {
    await page.reload(); await page.waitForSelector('[data-key="update"]');
    assert.match(await page.locator('.card-top .name').innerText(), /Alex Prime/);
    assert.match(await page.locator('[data-testid="look"]').innerText(), /Black coat/);
    await key('switch').click(); await key('pick-demo-isa').click(); await page.waitForSelector('dialog', { state: 'detached' });
    assert.match(await page.locator('[data-testid="look"]').innerText(), /Black dress/);
    assert.match(await text(), /Hospital/);
  });

  await step('theme switch: sage green applies, persists after reload and keeps the layout', async () => {
    const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    assert.equal(await bg(), '#f5f0eb');
    await openReader();
    await page.locator('#theme-pick').selectOption('sage');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'sage');
    assert.equal(await bg(), '#f4f6f5');
    await page.reload(); await page.waitForSelector('[data-key="update"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'sage');
    assert.equal(await page.locator('#theme-pick').inputValue(), 'sage');
    assert.equal(await page.evaluate(() => document.querySelector('meta[name=theme-color]').content), '#f4f6f5');
    await page.screenshot({ path: path.join(SHOTS, '05-sage-theme.png') });
    await key('row-clothing').click();
    await page.screenshot({ path: path.join(SHOTS, '06-sage-editor.png') });
    await page.keyboard.press('Escape');
    await page.locator('#theme-pick').selectOption('warm');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
  });

  await step('first-time empty state: Select a companion', async () => {
    const fresh = await browser.newContext({ viewport: { width: 960, height: 690 }, locale: 'pt-BR' });
    fresh.setDefaultTimeout(4000);
    const p2 = await fresh.newPage();
    await p2.goto(url); await p2.waitForSelector('[data-key="update"]');
    await p2.evaluate(async () => { const a = window.__clotheskin; await a.selectProfile(null); });
    assert.ok(await p2.getByRole('heading', { name: 'Select a companion' }).isVisible());
    await p2.screenshot({ path: path.join(SHOTS, '04-select-companion.png') });
    await fresh.close();
  });

  await step('no page errors or console errors', async () => { assert.deepEqual(problems, []); });

  await browser.close(); server.close();
  const failed = results.filter(([s]) => s !== 'ok').length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
})();
