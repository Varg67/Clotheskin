// Browser test of the Workshop mode: the screen runs in a 390-wide iframe inside a fake Workshop page that
// speaks the postMessage protocol from the Workshop guide. Files and actions are served from Node, and
// actions execute the REAL run code (run/actions.js) with a scripted stand-in for the Kin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is not installed.'); process.exit(2); }

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const step = async (name, fn) => {
  try { await closeDialogs(); await fn(); results.push('ok'); console.log(`  ok   ${name}`); }
  catch (e) { results.push('FAIL'); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); }
};
let closeDialogs = async () => {};

const PARENT = `<!doctype html><html><body style="margin:0;background:#e8ece9;display:flex;justify-content:center">
<iframe id="f" src="/index.html" style="width:390px;height:700px;border:0;background:#fff"></iframe>
<script>
const f = document.getElementById('f');
const reply = (m) => f.contentWindow.postMessage(m, '*');
window.pushKins = async () => reply({ kin: 'kins', ok: true, kins: await window.hostKins() });
window.addEventListener('message', async (e) => {
  if (e.source !== f.contentWindow) return;
  const m = e.data; if (!m || typeof m.kin !== 'string') return;
  if (m.kin === 'kins') return window.pushKins();
  if (m.kin === 'files.read') return reply({ kin: 'files.read', path: m.path, body: await window.hostRead(m.path) });
  if (m.kin === 'files.write') { await window.hostWrite(m.path, m.body); return reply({ kin: 'files.write', path: m.path, ok: true }); }
  if (m.kin === 'action') { const r = await window.hostAction(m.name, m.input); return reply({ kin: 'action', name: m.name, ok: r.ok, summary: r.message }); }
});
</script></body></html>`;

(async () => {
  const { createAppServer } = await import('../../server.mjs');
  const { Repository } = await import('../../screen/src/core/store.js');
  const { keyToPath } = await import('../../screen/src/host/paths.js');
  const { handleRun } = await import('../../run/actions.js');

  // ---- fake Workshop back end (files + actions) -------------------------------------------------
  const files = new Map();
  const nodeStorage = {
    get: async (k) => (files.has(keyToPath(k)) && files.get(keyToPath(k)) !== '' ? files.get(keyToPath(k)) : null),
    set: async (k, v) => { files.set(keyToPath(k), v); },
    remove: async (k) => { files.delete(keyToPath(k)); },
    keys: async () => [],
  };
  const runRepo = new Repository(nodeStorage);
  let kins = [{ id: 'k-isa', name: 'Isa' }, { id: 'k-alex-1', name: 'Alex' }, { id: 'k-alex-2', name: 'Alex' }];
  let kinAnswer = async () => '{}';
  let actionDelay = 350;
  const asked = [];
  const provider = { extract: async ({ prompt, profile }) => { asked.push({ prompt, profile }); return kinAnswer({ prompt, profile }); } };
  const runAction = async (name, input, kin) => {
    await new Promise((r) => setTimeout(r, actionDelay));
    return handleRun({ event: { trigger: 'action', action: name, input, ...(kin ? { kin } : {}) }, repo: runRepo, provider });
  };

  const server = createAppServer();
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 700, height: 740 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  ctx.setDefaultTimeout(5000);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.route('**/__parent.html', (route) => route.fulfill({ contentType: 'text/html', body: PARENT }));
  await page.exposeFunction('hostKins', () => kins);
  await page.exposeFunction('hostRead', (p) => (files.has(p) && files.get(p) !== '' ? files.get(p) : null));
  await page.exposeFunction('hostWrite', (p, body) => { files.set(p, body); });
  await page.exposeFunction('hostAction', (name, input) => runAction(name, input));

  const open = async () => { await page.goto(`${base}/__parent.html`); const f = page.frameLocator('#f'); await f.locator('body').waitFor(); return f; };
  let fr = await open();
  const key = (k) => fr.locator(`[data-key="${k}"]`);
  const text = () => fr.locator('body').innerText();
  closeDialogs = async () => { while (await fr.locator('dialog[open]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(30); } };
  const frameEval = (fn, arg) => page.frame({ url: /index\.html/ }).evaluate(fn, arg);
  const until = async (fn, what) => { const end = Date.now() + 4000; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await page.waitForTimeout(50); } throw new Error(`timed out waiting for: ${what} (${last})`); };
  const idle = () => fr.locator('[data-key="update"][aria-busy="false"]').waitFor();
  const pick = async (id) => { if (await key('switch').count()) await key('switch').click(); else await key('select-companion').click(); await key(`pick-${id}`).click(); await fr.locator('dialog').waitFor({ state: 'detached' }); };

  await step('Workshop is detected: frame mode, Kins come from the host, nothing is auto-selected with several Kins', async () => {
    await fr.getByRole('heading', { name: 'Select a companion' }).waitFor();
    assert.equal(await frameEval(() => document.body.classList.contains('mode-workshop')), true);
    assert.equal(await frameEval(() => localStorage.length), 0, 'no localStorage in a Workshop frame');
    await key('select-companion').click();
    const sheet = await fr.locator('dialog').innerText();
    assert.equal((sheet.match(/Alex/g) || []).length, 2, 'both same-name Kins are listed');
    assert.ok(!/New companion|Delete/.test(sheet), 'identity is owned by the host');
    assert.ok(!/Isa \(demo\)|Demo example/.test(sheet), 'no demo profile in the Workshop');
    await page.screenshot({ path: path.join(SHOTS, '07-workshop-select.png') });
  });

  await step('390 px frame: card fits without horizontal scrolling and the update button is in view', async () => {
    await closeDialogs();
    await pick('k-isa');
    const m = await frameEval(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, w: document.documentElement.clientWidth }));
    assert.ok(m.over <= 0, `overflow ${m.over}`); assert.equal(m.w, 390);
    await until(async () => /Clothing\s+Unknown/.test(await text()), 'Isa selected, clothing unknown');
    const b = await key('update').boundingBox();
    assert.ok(b.y + b.height <= 740, `update bottom ${b.y + b.height}`);
    assert.ok((await text()).match(/Last checked: never/));
    await page.screenshot({ path: path.join(SHOTS, '08-workshop-card-390.png') });
  });

  await step('Update status: the button shows activity, the run asks the Kin (no pasted chat), and the card updates', async () => {
    kinAnswer = async () => JSON.stringify({ state_updates: { hair: 'low bun', position: 'standing', location: 'living room' }, item_changes: [{ op: 'wear', item_name: 'green cardigan', slot: 'topwear' }, { op: 'wear', item_name: 'glasses', slot: 'eyes-accessory' }] });
    await key('update').click();
    assert.equal(await key('update').getAttribute('aria-busy'), 'true');
    assert.match(await key('update').innerText(), /Reading…/);
    await key('update').click(); // repeated click joins the reading in progress
    await idle();
    assert.equal(asked.length, 1, 'one question to the Kin despite two clicks');
    assert.ok(asked[0].prompt.length <= 8000);
    assert.ok(!asked[0].prompt.includes('RECENT EXCHANGE'));
    assert.equal(asked[0].profile.id, 'k-isa');
    const t = await text();
    assert.match(t, /Hair\s+Low bun/); assert.match(t, /Posture\s+Standing/); assert.match(t, /Accessories\s+Glasses/);
    assert.match(await fr.locator('[data-testid="look"]').innerText(), /^Green cardigan$/);
    assert.match(await fr.locator('[data-testid="banner"]').innerText(), /hair: unknown → low bun/);
    assert.match(await fr.locator('[data-testid="last-checked"]').innerText(), /Last checked: \d{1,2}:\d{2} (AM|PM)/);
    assert.ok(files.has('cs/clotheskin~3av1~3arecord~3ak-isa~3a~3a-.json'), 'state lives in the program files');
    await page.screenshot({ path: path.join(SHOTS, '09-workshop-after-read.png') });
  });

  await step('the Kin answering in character: error in English, data untouched, retry offered', async () => {
    const before = await text();
    kinAnswer = async () => '*giggles* Oh, a form? How cute. Not today!';
    await key('update').click(); await idle();
    const b = fr.locator('[data-testid="banner"]');
    assert.equal(await b.getAttribute('role'), 'alert');
    assert.match(await b.innerText(), /not valid JSON/);
    assert.ok((await b.innerText()).includes('Try again'));
    assert.match(await text(), /Hair\s+Low bun/);
    assert.equal((await text()).includes('Wore'), false);
  });

  await step('the Kin reports changes itself (update_scene): the card notices without a click', async () => {
    const r = await runAction('update_scene', { state_updates: { makeup: 'none' }, item_changes: [{ op: 'move', item_name: 'phone', to: { type: 'pocket', container_item_name: 'green cardigan', pocket: 'left pocket' } }] }, 'k-isa');
    assert.equal(r.ok, true);
    await frameEval(() => window.__clotheskin.pollNow());
    await fr.locator('.row', { hasText: 'Makeup' }).filter({ hasText: 'No makeup' }).waitFor();
    await key('row-clothing').click(); // contents belong to the garment's own detail, not to an inventory screen
    const detail = await fr.locator('dialog').evaluate((d) => d.textContent);
    assert.match(detail, /Carrying: phone/);
  });

  await step('manual correction through the editor is saved in the Workshop files and survives a reload', async () => {
    await closeDialogs();
    await key('row-hair').click();
    await fr.locator('#field-input').fill('wet, loose');
    await fr.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => /Hair\s+Wet, loose/.test(await text()), 'hair row shows the saved correction');
    await until(async () => /Edited manually/.test(await text()), 'manual edit time');
    fr = await open();
    await key('toggle').waitFor();
    assert.match(await fr.locator('.card-top').innerText(), /Alex|Isa/);
  });

  await step('same-name Kins: a reading started for the first Alex lands on it even after switching to the second', async () => {
    await pick('k-alex-1');
    kinAnswer = async () => JSON.stringify({ state_updates: { hair: 'braid' } });
    await key('update').click();
    await pick('k-alex-2'); // switch while the first reading runs
    await until(async () => /Hair\s+Unknown/.test(await text()) && (await key('update').getAttribute('aria-busy')) === 'false', 'second Alex shown, not reading');
    await page.waitForTimeout(700);
    assert.equal((await fr.locator('[data-testid="banner"]').count()), 0, 'the first Alex result is not shown on the second');
    await pick('k-alex-1');
    await until(async () => /Hair\s+Braid/.test(await text()), 'first Alex has the braid');
    await pick('k-alex-2');
    await until(async () => /Hair\s+Unknown/.test(await text()), 'second Alex still unknown');
  });

  await step('the host attaches or detaches Kins while the screen is open', async () => {
    kins = [{ id: 'k-isa', name: 'Isa' }];
    await page.evaluate(() => window.pushKins()); // the selected Alex is gone; one Kin is left, so it is selected
    await until(async () => /Isa/.test(await fr.locator('.card-top .name').innerText()), 'Isa selected automatically');
    await key('switch').click();
    assert.equal((await fr.locator('dialog').innerText()).includes('Alex'), false, 'detached Kins are not listed');
    await closeDialogs();
    kins = [];
    await page.evaluate(() => window.pushKins());
    await fr.getByText('No Kin is attached to this app yet').waitFor();
    await page.screenshot({ path: path.join(SHOTS, '10-workshop-no-kins.png') });
    kins = [{ id: 'k-isa', name: 'Isa' }, { id: 'k-alex-1', name: 'Alex' }];
    await page.evaluate(() => window.pushKins());
    await key('select-companion').waitFor(); // several Kins: the person chooses (the button only exists when there is something to pick)
    assert.equal(await fr.locator('.card-top').count(), 0, 'no Kin is selected automatically');
  });

  await step('settings: theme works inside the frame and is stored in the Workshop files', async () => {
    await key('reader-summary').click();
    await fr.locator('#theme-pick').selectOption('sage');
    await until(async () => (await frameEval(() => document.documentElement.dataset.theme)) === 'sage', 'sage applied');
    await until(async () => /"theme":"sage"/.test(files.get('cs/clotheskin~3av1~3asettings.json') || ''), 'theme saved in the Workshop files');
    await page.screenshot({ path: path.join(SHOTS, '11-workshop-settings-sage.png') });
  });

  await step('no page errors or console errors', async () => { assert.deepEqual(problems, []); });

  await browser.close(); server.close();
  const failed = results.filter((r) => r !== 'ok').length;
  console.log(`\n${results.length - failed}/${results.length} Workshop-mode checks passed`);
  process.exit(failed ? 1 : 0);
})();
