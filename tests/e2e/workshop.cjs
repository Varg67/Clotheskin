// Browser test of the Workshop mode: the screen runs in a 390-wide iframe inside a fake Workshop page that speaks
// the postMessage protocol from the Workshop guide. Actions execute the REAL run code (run/actions.js) with a
// scripted stand-in for the Kin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is not installed.'); process.exit(2); }

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
let closeDialogs = async () => {};
const step = async (name, fn) => {
  try { await closeDialogs(); await fn(); results.push('ok'); console.log(`  ok   ${name}`); }
  catch (e) { results.push('FAIL'); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); }
};

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
  if (m.kin === 'files.write') { const ok = await window.hostWrite(m.path, m.body); return reply({ kin: 'files.write', path: m.path, ok: ok !== false }); }
  if (m.kin === 'action') { const r = await window.hostAction(m.name, m.input); return reply({ kin: 'action', name: m.name, ok: r.ok, summary: r.message }); }
});
</script></body></html>`;

(async () => {
  const { createAppServer } = await import('../../server.mjs');
  const { handleRun } = await import('../../run/actions.js');
  const { keyToPath } = await import('../../screen/src/host/paths.js');
  const files = new Map();
  let kins = [{ id: 'k-isa', name: 'Isa' }, { id: 'k-alex-1', name: 'Alex' }, { id: 'k-alex-2', name: 'Alex' }];
  let kinAnswer = async () => '{}';
  const asked = [];
  const provider = { extract: async ({ prompt, kinId }) => { asked.push({ prompt, kinId }); return kinAnswer({ prompt, kinId }); } };
  // The run reads and writes the same files the screen does (the program folder), through the real adapters' interface.
  const nodeStorage = {
    get: async (k) => (files.has(keyToPath(k)) && files.get(keyToPath(k)) !== '' ? files.get(keyToPath(k)) : null),
    set: async (k, v) => { files.set(keyToPath(k), v); },
    remove: async (k) => { files.delete(keyToPath(k)); },
  };
  let delay = 350;
  let plainSummary = false; // simulates an older run that ended with plain text
  const NONE = 'No outfit read yet. Press Update status.';

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
  let failWrites = false; // the Workshop refuses to save: a flaky connection
  await page.exposeFunction('hostWrite', (p, body) => { if (failWrites) return false; files.set(p, body); return true; });
  // The platform's schedule beat. The test chooses the clock so time can pass without waiting.
  await page.exposeFunction('hostSchedule', (iso) => handleRun({ event: { trigger: 'schedule' }, provider, storage: nodeStorage, clock: () => new Date(iso), sleep: async () => {} }));
  await page.exposeFunction('hostAction', async (name, input) => { await new Promise((r) => setTimeout(r, delay)); const r = await handleRun({ event: { trigger: 'action', action: name, input }, provider, storage: nodeStorage, sleep: async () => {} }); return plainSummary && r.ok ? { ...r, message: JSON.parse(r.message).outfit } : r; });

  await page.goto(`${base}/__parent.html`);
  const fr = page.frameLocator('#f');
  await fr.locator('body').waitFor();
  const key = (k) => fr.locator(`[data-key="${k}"]`);
  const text = () => fr.locator('body').innerText();
  const outfit = () => fr.locator('[data-testid="outfit"]').innerText();
  const where = () => fr.locator('[data-testid="location"]').innerText();
  const doing = () => fr.locator('[data-testid="doing"]').innerText();
  const NOD = 'No pose or action described in the recent chat.';
  closeDialogs = async () => { while (await fr.locator('dialog[open]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(30); } };
  const frameEval = (fn, arg) => page.frame({ url: /index\.html/ }).evaluate(fn, arg);
  const until = async (fn, what) => { const end = Date.now() + 4000; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await page.waitForTimeout(50); } throw new Error(`timed out waiting for: ${what} (${last})`); };
  const idle = () => fr.locator('[data-key="update"][aria-busy="false"]').waitFor();
  const pick = async (id) => { if (await key('switch').count()) await key('switch').click(); else await key('select-companion').click(); await key(`pick-${id}`).click(); await fr.locator('dialog').waitFor({ state: 'detached' }); };

  await step('Workshop is detected; with several Kins the person chooses; no browser storage is used', async () => {
    await fr.getByRole('heading', { name: 'Select a Kin' }).waitFor();
    assert.equal(await frameEval(() => document.body.classList.contains('mode-workshop')), true);
    assert.equal(await frameEval(() => localStorage.length), 0);
    await key('select-companion').click();
    const sheet = await fr.locator('dialog').innerText();
    assert.equal((sheet.match(/Alex/g) || []).length, 2, 'both same-name Kins are listed');
    assert.ok(!/New|Delete|demo/i.test(sheet));
    await page.screenshot({ path: path.join(SHOTS, '07-workshop-select.png') });
  });

  await step('390 px frame: the card fits, no horizontal scroll, the button is in view, nothing read yet', async () => {
    await closeDialogs(); await pick('k-isa');
    await until(async () => /Current status/i.test(await text()), 'card shown');
    const m = await frameEval(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, w: document.documentElement.clientWidth }));
    assert.ok(m.over <= 0); assert.equal(m.w, 390);
    assert.equal(await outfit(), NONE);
    assert.equal(await where(), 'No location read yet.');
    assert.equal(await doing(), 'No pose or action read yet.');
    const b = await key('update').boundingBox();
    assert.ok(b.y + b.height <= 740, `${b.y + b.height}`);
  });

  await step('Update status: activity on the button, one question to the Kin despite two clicks, the sentence appears', async () => {
    kinAnswer = async () => '{"location":"in the living room","pose":"sitting on the sofa","action":"drinking coffee","topwear":["a perfumed white shirt","a leather jacket"],"bottomwear":["blue jeans"]}';
    await key('update').click();
    assert.equal(await key('update').getAttribute('aria-busy'), 'true');
    assert.match(await key('update').innerText(), /Reading…/);
    await key('update').click();
    await idle();
    assert.equal(asked.length, 1);
    assert.equal(asked[0].kinId, 'k-isa');
    assert.ok(!asked[0].prompt.includes('RECENT CHAT'), 'the Kin sees its own chat');
    assert.match(asked[0].prompt, /^You are Isa\./);
    assert.equal(await where(), 'In the living room.');
    assert.equal(await doing(), 'Sitting on the sofa, drinking coffee.');
    assert.equal(await outfit(), 'Wearing a leather jacket, a perfumed white shirt and blue jeans.');
    assert.match(await fr.locator('[data-testid="last-checked"]').innerText(), /Last checked: \d{1,2}:\d{2} (AM|PM)/);
    await page.screenshot({ path: path.join(SHOTS, '08-workshop-sentence.png') });
  });

  await step('the Kin answers in character: error in English, the previous sentence stays, retry offered', async () => {
    kinAnswer = async () => '*giggles* Oh, a form? How cute. Not today!';
    await key('update').click(); await idle();
    const b = fr.locator('[data-testid="banner"]');
    assert.equal(await b.getAttribute('role'), 'alert');
    assert.match(await b.innerText(), /not valid JSON/);
    assert.ok((await b.innerText()).includes('Try again'));
    assert.equal(await outfit(), 'Wearing a leather jacket, a perfumed white shirt and blue jeans.');
    assert.equal(await where(), 'In the living room.', 'the previous place stays too');
    assert.equal(await doing(), 'Sitting on the sofa, drinking coffee.', 'and the previous pose and action');
    kinAnswer = async () => '{"location":"at the hospital","pose":"standing","action":"washing hands","topwear":["a green cardigan"]}';
    await key('retry').click(); await idle();
    assert.equal(await where(), 'At the hospital.');
    assert.equal(await doing(), 'Standing, washing hands.');
    assert.equal(await outfit(), 'Wearing a green cardigan.');
    assert.equal(await fr.locator('[data-testid="banner"]').count(), 0, 'success clears the error');
  });

  await step('same-name Kins: a reading started for the first Alex is shown on it, not on the second', async () => {
    await pick('k-alex-1');
    kinAnswer = async () => '{"location":"on the bus to college","pose":"sitting by the window","footwear":["red boots"]}';
    await key('update').click();
    await pick('k-alex-2'); // switch while the first reading runs
    await until(async () => (await outfit()) === NONE && (await key('update').getAttribute('aria-busy')) === 'false', 'second Alex is idle and empty');
    await page.waitForTimeout(700);
    assert.equal(await outfit(), NONE, 'the first Alex result is not shown on the second');
    assert.equal(await where(), 'No location read yet.');
    assert.equal(await doing(), 'No pose or action read yet.');
    await pick('k-alex-1');
    await until(async () => (await outfit()) === 'Wearing red boots.', 'first Alex has the boots');
    assert.equal(await where(), 'On the bus to college.');
    assert.equal(await doing(), 'Sitting by the window.');
    await pick('k-isa');
    assert.equal(await outfit(), 'Wearing a green cardigan.', 'each Kin keeps its own result during the session');
    assert.equal(await where(), 'At the hospital.');
    assert.equal(await doing(), 'Standing, washing hands.');
  });

  const SETTINGS = 'cs/clotheskin~3av2~3asettings.json';
  const readingFile = (id) => JSON.parse(files.get(`cs/clotheskin~3av2~3areading~3a${id}.json`) || 'null');
  const savedSettings = () => JSON.parse(files.get(SETTINGS) || '{}');
  const beat = (minutes) => page.evaluate((iso) => window.hostSchedule(iso), new Date(Date.now() + minutes * 60000).toISOString());
  const poll = () => frameEval(() => window.__clotheskin.pollNow());

  await step('the latest reading is remembered: it shows again after a reload, without asking the Kin', async () => {
    await pick('k-isa');
    const before = asked.length;
    await page.reload();
    await key('update').waitFor();
    await until(async () => (await outfit()) === 'Wearing a green cardigan.', 'the stored reading is shown');
    assert.equal(await where(), 'At the hospital.');
    assert.equal(asked.length, before, 'showing it cost no question');
    assert.match(await fr.locator('[data-testid="last-checked"]').innerText(), /Last checked: \d{1,2}:\d{2} (AM|PM)/);
    const stored = readingFile('k-isa');
    assert.deepEqual(Object.keys(stored).sort(), ['at', 'attemptedAt', 'doing', 'error', 'errorKind', 'failures', 'hair', 'location', 'makeup', 'outfit', 'source', 'stableCount']);
    assert.equal(stored.source, 'manual');
  });

  await step('automatic updates: the interval is validated and says what really happens', async () => {
    await key('reader-summary').click();
    const interval = fr.locator('#auto-interval');
    assert.equal(await interval.inputValue(), '15');
    await interval.fill('7'); await interval.blur();
    await until(async () => /behaves like 10/.test(await fr.locator('#auto-interval-help').innerText()), 'rounding explained');
    await interval.fill('1'); await interval.blur();
    await until(async () => (await interval.inputValue()) === '5', 'clamped up to 5 minutes');
    await interval.fill(''); await interval.blur();
    await until(async () => (await interval.inputValue()) === '15', 'empty gives the default');
    await interval.fill('99999'); await interval.blur();
    await until(async () => (await interval.inputValue()) === '1440', 'clamped down to 24 hours');
    await interval.fill('30'); await interval.blur();
    await until(async () => savedSettings().autoIntervalMinutes === 30, 'saved for the run to read');
    assert.equal(savedSettings().autoUpdate, false, 'still off until switched on');
    await page.screenshot({ path: path.join(SHOTS, '11-workshop-auto-settings.png') });
  });

  await step('automatic updates: switching on ticks the selected Kin; the platform beat then asks it and the card shows the result', async () => {
    kins = [{ id: 'k-isa', name: 'Isa' }, { id: 'k-alex-1', name: 'Alex' }, { id: 'k-alex-2', name: 'Alex' }];
    await page.evaluate(() => window.pushKins());
    await fr.locator('#auto-enable').check();
    await until(async () => savedSettings().autoUpdate === true && (savedSettings().autoKins || []).some((k) => k.id === 'k-isa'), 'on, with the selected Kin ticked');
    assert.deepEqual(savedSettings().autoKins, [{ id: 'k-isa', name: 'Isa' }]);
    assert.equal(await fr.locator('#auto-kin-k-isa').isChecked(), true);
    assert.equal(await fr.locator('#auto-kin-k-alex-1').isChecked(), false);
    await fr.locator('#auto-kin-k-alex-1').check();
    await until(async () => (savedSettings().autoKins || []).length === 2, 'second Kin ticked');

    kinAnswer = async ({ kinId }) => JSON.stringify({ location: kinId === 'k-isa' ? 'in the garden' : 'on a bench', pose: 'standing', topwear: ['a raincoat'] });
    const before = asked.length;
    const r = await beat(31);
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /Checked 2/);
    assert.equal(asked.length, before + 2, 'one question for each ticked Kin');
    assert.deepEqual(asked.slice(-2).map((a) => a.kinId).sort(), ['k-alex-1', 'k-isa']);
    assert.ok(!asked.slice(-2).some((a) => a.kinId === 'k-alex-2'), 'the unticked Kin is never asked');
    await poll();
    await until(async () => (await where()) === 'In the garden.', 'the automatic reading is shown on the card');
    assert.equal(await outfit(), 'Wearing a raincoat.');
    assert.match(await fr.locator('[data-testid="last-checked"]').innerText(), /automatic/);
    assert.equal(readingFile('k-isa').source, 'auto');
    await page.screenshot({ path: path.join(SHOTS, '12-workshop-auto-result.png') });
  });

  await step('the interval is respected by the beat: nothing before it, again after it', async () => {
    const before = asked.length;
    assert.match((await beat(35)).message, /No Kin is due yet/);
    assert.equal(asked.length, before);
    await new Promise((r) => setTimeout(r, 5));
    const later = await beat(31 + 31);
    assert.match(later.message, /Checked 2/);
    assert.equal(asked.length, before + 2);
  });

  await step('an automatic failure keeps the last good sentences and says so; Try again recovers', async () => {
    kinAnswer = async () => '*giggles* No forms today!';
    // The beat at 62 found nothing new, so the adaptive interval doubled the 30-minute wait: due again at 122.
    assert.match((await beat(31 + 31 + 31)).message, /No Kin is due yet/);
    const r = await beat(31 + 31 + 62);
    assert.equal(r.ok, false);
    await poll();
    const banner = fr.locator('[data-testid="banner"]');
    await banner.waitFor();
    assert.equal(await banner.getAttribute('role'), 'alert');
    assert.match(await banner.innerText(), /The last automatic check failed: .*not valid JSON/);
    assert.equal(await where(), 'In the garden.', 'the last good place is still shown');
    assert.ok((await fr.locator('[data-testid="auto-status"]').innerText()).includes('(failed)'));
    kinAnswer = async () => JSON.stringify({ location: 'at the library', topwear: ['a cardigan'] });
    await key('retry').click(); await idle();
    assert.equal(await where(), 'At the library.');
    assert.equal(await fr.locator('[data-testid="banner"]').count(), 0);
  });

  await step('another Kin\'s automatic reading shows when that Kin is selected, and not before', async () => {
    assert.equal(await where(), 'At the library.', 'Isa still shows her own');
    await pick('k-alex-1');
    await until(async () => (await where()) === 'On a bench.', 'Alex 1 has its own automatic reading');
    await pick('k-alex-2');
    await until(async () => (await outfit()) === NONE, 'Alex 2 (not ticked) has nothing');
    await pick('k-isa');
  });

  await step('switching automatic updates off stops the questions', async () => {
    await key('reader-summary').click().catch(() => {});
    if (!(await fr.locator('#auto-enable').isVisible())) await key('reader-summary').click();
    await fr.locator('#auto-enable').uncheck();
    await until(async () => savedSettings().autoUpdate === false, 'saved as off');
    const before = asked.length;
    assert.equal((await beat(500)).message, 'Automatic updates are off.');
    assert.equal(asked.length, before);
  });

  const openSettings = async () => { if (!(await fr.locator('#auto-enable').isVisible())) await key('reader-summary').click(); };

  await step('the model is down: Update status says so plainly, retries once, keeps the last reading, and recovers', async () => {
    await pick('k-isa');
    const prev = { where: await where(), doing: await doing(), outfit: await outfit() };
    const before = asked.length;
    kinAnswer = async () => { throw new Error('503 Service Unavailable: the model is overloaded'); };
    await key('update').click(); await idle();
    const b = fr.locator('[data-testid="banner"]');
    assert.equal(await b.getAttribute('role'), 'alert');
    assert.match(await b.innerText(), /The Kin or its model is unavailable right now\./);
    assert.match(await b.innerText(), /503/);
    assert.equal(asked.length, before + 2, 'one quick retry, then it gives up');
    assert.deepEqual({ where: await where(), doing: await doing(), outfit: await outfit() }, prev, 'the last reading is still shown');
    kinAnswer = async () => JSON.stringify({ location: 'in the lab', topwear: ['a lab coat'] });
    await key('retry').click(); await idle();
    assert.equal(await where(), 'In the lab.');
    assert.equal(await fr.locator('[data-testid="banner"]').count(), 0);
  });

  await step('a slow Kin is not a failed Kin: the card says it is still waiting, and the answer still arrives', async () => {
    await frameEval(() => { window.__clotheskin.S.slowAfterMs = 300; });
    delay = 1500;
    kinAnswer = async () => JSON.stringify({ location: 'in the lab', pose: 'sitting', action: 'writing notes', topwear: ['a lab coat'] });
    await key('update').click();
    await until(async () => /Still waiting for the Kin/.test(await key('update').innerText()), 'the slow message');
    assert.match(await fr.locator('[data-testid="slow-note"]').innerText(), /taking longer than usual/);
    assert.equal(await key('update').getAttribute('aria-busy'), 'true');
    await idle();
    assert.equal(await fr.locator('[data-testid="slow-note"]').count(), 0);
    assert.equal(await doing(), 'Sitting, writing notes.');
    assert.match(await key('update').innerText(), /Update status/);
    delay = 350;
    await frameEval(() => { window.__clotheskin.S.slowAfterMs = 15000; });
  });

  await step('Kindroid itself does not answer (the connection): a clear message, the last reading kept, late answers ignored', async () => {
    const prev = await where();
    await frameEval(() => { window.__clotheskin.host.channel.timeouts.action = 400; });
    delay = 2500;
    kinAnswer = async () => JSON.stringify({ location: 'on the moon' });
    await key('update').click(); await idle();
    const b = fr.locator('[data-testid="banner"]');
    assert.match(await b.innerText(), /Kindroid did not answer in time\. Check your connection and try again\. Your last reading is still shown\./);
    assert.equal(await where(), prev, 'nothing changed');
    await frameEval(() => { window.__clotheskin.host.channel.timeouts.action = 150000; });
    delay = 350;
    await page.waitForTimeout(2400); // the slow run finishes in the background and its late reply must be ignored
    assert.equal(await where(), prev, 'a late answer to a request already given up on does not appear');
    kinAnswer = async () => JSON.stringify({ location: 'in the lab', pose: 'sitting', action: 'writing notes', topwear: ['a lab coat'] });
    await key('retry').click(); await idle();
    assert.equal(await fr.locator('[data-testid="banner"]').count(), 0);
  });

  await step('automatic failures: the card says why and when it will try again; a permission problem says it will not retry sooner', async () => {
    await openSettings();
    await fr.locator('#auto-interval').fill('60'); await fr.locator('#auto-interval').blur();
    await until(async () => savedSettings().autoIntervalMinutes === 60, 'interval 60 saved');
    await fr.locator('#auto-enable').check();
    await until(async () => savedSettings().autoUpdate === true, 'on');
    kinAnswer = async () => { throw new Error('503 Service Unavailable'); };
    const before = asked.length;
    let r = await beat(61);
    assert.equal(r.ok, false);
    await poll();
    const b = fr.locator('[data-testid="banner"]');
    await b.waitFor();
    let text = await b.innerText();
    assert.match(text, /The last automatic check failed: The Kin or its model is unavailable right now\./);
    assert.match(text, /Trying again about 5 minutes after the last attempt\./);
    assert.ok(!/in a row/.test(text), 'one failure is not "in a row"');
    const asks = asked.slice(before);
    assert.equal(new Set(asks).size, asks.length, 'scheduled beats do not retry inside the run: each ticked Kin is asked once');
    assert.match((await beat(61 + 2)).message, /No Kin is due yet/, 'not on every beat');
    r = await beat(61 + 6);
    assert.equal(r.ok, false);
    await poll();
    await until(async () => /2 checks in a row have failed\.\s+Trying again about 10 minutes/.test(await b.innerText()), 'second failure explained');
    kinAnswer = async () => { throw new Error('403 Forbidden: grant chat:read is missing'); };
    await beat(61 + 6 + 11);
    await poll();
    await until(async () => /3 checks in a row[\s\S]*Retrying sooner will not help: fix the cause, then press Try again\./.test(await b.innerText()), 'permission explained');
    assert.match(await b.innerText(), /refused the question/);
    await b.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, '13-workshop-failure-explained.png') });
    const asked2 = asked.length;
    assert.match((await beat(61 + 6 + 11 + 30)).message, /No Kin is due yet/, 'a permission problem is not retried at the backoff');
    assert.equal(asked.length, asked2);
    assert.equal(await where(), 'In the lab.', 'the last good place is still shown through all of it');
    kinAnswer = async () => JSON.stringify({ location: 'at home', topwear: ['a hoodie'] });
    await key('retry').click(); await idle();
    assert.equal(await fr.locator('[data-testid="banner"]').count(), 0, 'a success clears the failure');
    assert.equal(readingFile('k-isa').failures, 0);
    await openSettings();
    await fr.locator('#auto-enable').uncheck();
    await until(async () => savedSettings().autoUpdate === false, 'off again');
  });

  await step('a setting the Workshop cannot save is taken back and reported; it works again once the connection does', async () => {
    await openSettings();
    failWrites = true;
    await fr.locator('#auto-enable').check();
    const note = fr.locator('[data-testid="auto-note"]');
    await note.waitFor();
    assert.equal(await note.getAttribute('role'), 'alert');
    assert.match(await note.innerText(), /Could not save this setting: the Workshop did not respond\. Nothing was changed; try again\./);
    assert.equal(await fr.locator('#auto-enable').isChecked(), false, 'the switch shows the truth: it is still off');
    assert.equal(savedSettings().autoUpdate, false);
    failWrites = false;
    await fr.locator('#auto-enable').check();
    await until(async () => savedSettings().autoUpdate === true, 'saved once the connection works');
    assert.equal(await fr.locator('[data-testid="auto-note"]').count(), 0, 'the note goes away');
    await fr.locator('#auto-enable').uncheck();
    await until(async () => savedSettings().autoUpdate === false, 'off again');
    await page.screenshot({ path: path.join(SHOTS, '14-workshop-save-failed.png') });
  });

  await step('an older run that ended with plain text is still shown (as the outfit, without place, pose or action)', async () => {
    plainSummary = true;
    kinAnswer = async () => '{"location":"at home","topwear":["a hoodie"]}';
    await key('update').click(); await idle();
    assert.equal(await outfit(), 'Wearing a hoodie.');
    assert.equal(await where(), 'No location described in the recent chat.');
    assert.equal(await doing(), NOD);
    plainSummary = false;
  });

  await step('the host attaches or detaches Kins while the screen is open', async () => {
    kins = [{ id: 'k-isa', name: 'Isa' }];
    await page.evaluate(() => window.pushKins());
    await until(async () => (await key('switch').count()) === 0, 'single Kin: no switch button');
    assert.match(await fr.locator('.card-top .name').innerText(), /Isa/);
    kins = [];
    await page.evaluate(() => window.pushKins());
    await fr.getByText('No Kin is attached to this app yet').waitFor();
    await page.screenshot({ path: path.join(SHOTS, '09-workshop-no-kins.png') });
    kins = [{ id: 'k-isa', name: 'Isa' }, { id: 'k-alex-1', name: 'Alex' }];
    await page.evaluate(() => window.pushKins());
    await until(async () => /Isa/.test(await fr.locator('.card-top .name').innerText()), 'Isa still selected after the list changed');
  });

  await step('hair and makeup are shown, a long reading arrives whole, and History and Diagnostics show it', async () => {
    delay = 50;
    await pick('k-isa');
    const tops = Array.from({ length: 8 }, (_, i) => `a very long descriptive layered jacket number ${i}`);
    kinAnswer = async () => JSON.stringify({ location: 'in the studio', pose: 'standing', action: 'painting', topwear: tops, hair: 'long auburn hair in a loose braid', makeup: 'winged eyeliner and red lipstick' });
    await key('update').click(); await idle();
    const full = readingFile('k-isa').outfit;
    assert.ok(full.length > 400 && !full.endsWith('…'), 'the stored copy is whole');
    await until(async () => (await outfit()) === full, 'the whole outfit replaces the shortened line');
    assert.equal(await fr.locator('[data-testid="hair"]').innerText(), 'Long auburn hair in a loose braid.');
    assert.equal(await fr.locator('[data-testid="makeup"]').innerText(), 'Winged eyeliner and red lipstick.');
    await key('history-summary').click();
    await until(async () => (await fr.locator('[data-testid="history-item"]').count()) >= 2, 'history entries');
    const first = await fr.locator('[data-testid="history-item"]').first().innerText();
    assert.match(first, /In the studio\./); assert.match(first, /Hair/);
    await page.screenshot({ path: path.join(SHOTS, '13-workshop-history.png') });
    await key('history-clear').click();
    assert.match(await key('history-clear').innerText(), /Press again/);
    await key('history-clear').click();
    await until(async () => (await fr.locator('[data-testid="history-empty"]').count()) === 1, 'history cleared');
    assert.equal(await outfit(), full, 'clearing the history keeps the current status');
    await key('history-summary').click();
    await openSettings();
    await key('diag-summary').click();
    await until(async () => (await fr.locator('[data-testid="diag-item"]').count()) >= 2, 'diagnostics entries');
    assert.match(await fr.locator('[data-testid="diag-summary-line"]').innerText(), /succeeded/);
    assert.match(await fr.locator('[data-testid="diag-item"]').first().innerText(), /manual · ok[\s\S]*shortened on the way back/);
    assert.ok(await fr.locator('.diag-item.failed').count() >= 1, 'earlier failures are listed');
    await fr.locator('[data-key="diag-summary"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, '14-workshop-diagnostics.png') });
    const m = await frameEval(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(m <= 0, 'no horizontal scroll');
    await key('diag-summary').click();
  });

  await step('the Workshop files hold only preferences, each Kin\'s latest reading and its journal (sentences and times); the theme works in the frame', async () => {
    if (!(await fr.locator('#theme-pick').isVisible())) await key('reader-summary').click();
    await fr.locator('#theme-pick').selectOption('sage');
    await until(async () => (await frameEval(() => document.documentElement.dataset.theme)) === 'sage', 'sage applied');
    await until(async () => savedSettings().theme === 'sage', 'theme saved');
    const names = [...files.keys()].sort();
    assert.ok(names.every((n) => /^cs\/clotheskin~3av2~3a(settings|(reading|journal)~3ak-[a-z0-9-]+)\.json$/.test(n)), names.join(', '));
    assert.ok(names.includes(SETTINGS));
    for (const n of names.filter((x) => /reading/.test(x))) {
      const o = JSON.parse(files.get(n));
      assert.deepEqual(Object.keys(o).sort(), ['at', 'attemptedAt', 'doing', 'error', 'errorKind', 'failures', 'hair', 'location', 'makeup', 'outfit', 'source', 'stableCount'], n);
    }
    for (const n of names.filter((x) => /journal/.test(x))) {
      const o = JSON.parse(files.get(n));
      assert.deepEqual(Object.keys(o).sort(), ['history', 'log'], n);
      assert.ok(!/"pose"|RECENT CHAT/.test(files.get(n)), 'no answer or chat text is kept');
    }
    assert.deepEqual(Object.keys(savedSettings()).sort(), ['autoAdaptive', 'autoIntervalMinutes', 'autoKins', 'autoUpdate', 'localName', 'selectedKinId', 'theme']);
    await page.screenshot({ path: path.join(SHOTS, '10-workshop-settings-sage.png') });
  });

  await step('no page errors or console errors', async () => { assert.deepEqual(problems, []); });

  await browser.close(); server.close();
  const failed = results.filter((r) => r !== 'ok').length;
  console.log(`\n${results.length - failed}/${results.length} Workshop-mode checks passed`);
  process.exit(failed ? 1 : 0);
})();
