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
  if (m.kin === 'files.write') { await window.hostWrite(m.path, m.body); return reply({ kin: 'files.write', path: m.path, ok: true }); }
  if (m.kin === 'action') { const r = await window.hostAction(m.name, m.input); return reply({ kin: 'action', name: m.name, ok: r.ok, summary: r.message }); }
});
</script></body></html>`;

(async () => {
  const { createAppServer } = await import('../../server.mjs');
  const { handleRun } = await import('../../run/actions.js');
  const files = new Map();
  let kins = [{ id: 'k-isa', name: 'Isa' }, { id: 'k-alex-1', name: 'Alex' }, { id: 'k-alex-2', name: 'Alex' }];
  let kinAnswer = async () => '{}';
  const asked = [];
  const provider = { extract: async ({ prompt, kinId }) => { asked.push({ prompt, kinId }); return kinAnswer({ prompt, kinId }); } };
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
  await page.exposeFunction('hostWrite', (p, body) => { files.set(p, body); });
  await page.exposeFunction('hostAction', async (name, input) => { await new Promise((r) => setTimeout(r, delay)); const r = await handleRun({ event: { trigger: 'action', action: name, input }, provider }); return plainSummary && r.ok ? { ...r, message: JSON.parse(r.message).outfit } : r; });

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
  const pick = async (id) => { if (await key('switch').count()) await key('switch').click(); await key(`pick-${id}`).click(); await fr.locator('dialog').waitFor({ state: 'detached' }); };

  await step('Workshop is detected; with several Kins the person chooses; no browser storage is used', async () => {
    await fr.getByRole('heading', { name: 'Select a Kin' }).waitFor();
    assert.equal(await frameEval(() => document.body.classList.contains('mode-workshop')), true);
    assert.equal(await frameEval(() => localStorage.length), 0);
    // The list is on the screen itself: one tap picks the Kin of the current roleplay, no dialog.
    assert.equal(await fr.locator('dialog').count(), 0);
    const list = await fr.locator('.card.picker').innerText();
    assert.equal((list.match(/Alex/g) || []).length, 2, 'both same-name Kins are listed');
    assert.equal((list.match(/Not read yet/g) || []).length, 3, 'nobody is read before Update status');
    assert.ok(!/New|Delete|demo/i.test(list));
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

  await step('the only thing in the Workshop files is the settings; the theme works in the frame', async () => {
    await key('reader-summary').click();
    await fr.locator('#theme-pick').selectOption('sage');
    await until(async () => (await frameEval(() => document.documentElement.dataset.theme)) === 'sage', 'sage applied');
    await until(async () => /"theme":"sage"/.test(files.get('cs/clotheskin~3av2~3asettings.json') || ''), 'theme saved');
    assert.deepEqual([...files.keys()], ['cs/clotheskin~3av2~3asettings.json']);
    assert.ok(!/jeans|cardigan|boots|jacket|hoodie|hospital|living room|college|sofa|coffee|washing|window/.test([...files.values()].join('')), 'no garment, place, pose or action was stored');
    await page.screenshot({ path: path.join(SHOTS, '10-workshop-settings-sage.png') });
  });

  await step('several Kins: only the selected one is read; the switch list shows who was read and where', async () => {
    kins = [{ id: 'k-isa', name: 'Isa' }, { id: 'k-alex-1', name: 'Alex' }, { id: 'k-bea', name: 'Bea' }];
    await frameEval(() => window.parent.pushKins());
    await pick('k-isa');
    assert.match(await fr.locator('[data-testid="only-this"]').innerText(), /Only this Kin is read · 2 others attached/);
    kinAnswer = async () => '{"location":"at the beach","topwear":["a red scarf"]}';
    const before = asked.length;
    await key('update').click(); await idle();
    assert.deepEqual(asked.slice(before).map((a) => a.kinId), ['k-isa'], 'one question, to the selected Kin only');
    await key('switch').click();
    const sheet = await fr.locator('dialog').innerText();
    assert.match(sheet, /Isa\s+At the beach · just now/);
    assert.match(sheet, /Bea\s+Not read yet/);
    assert.match(sheet, /Only the selected Kin is read/);
    await page.screenshot({ path: path.join(SHOTS, '10-workshop-switch-list.png') });
  });

  await step('automatic update: the ruler; asleep -> wake-up time -> hibernation overnight -> dream -> readings again', async () => {
    // A fresh screen with a controllable clock: 22:00 in São Paulo, one Kin.
    files.clear(); kins = [{ id: 'k-isa', name: 'Isa' }]; delay = 50;
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    p2.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await p2.clock.install({ time: new Date('2026-11-20T22:00:00-03:00') });
    await p2.route('**/__parent.html', (route) => route.fulfill({ contentType: 'text/html', body: PARENT }));
    await p2.exposeFunction('hostKins', () => kins);
    await p2.exposeFunction('hostRead', (p) => (files.has(p) && files.get(p) !== '' ? files.get(p) : null));
    await p2.exposeFunction('hostWrite', (p, body) => { files.set(p, body); });
    await p2.exposeFunction('hostAction', async (name, input) => { await new Promise((r) => setTimeout(r, delay)); const r = await handleRun({ event: { trigger: 'action', action: name, input }, provider }); return r; });
    let night = true;
    const questions = [];
    kinAnswer = async ({ prompt }) => {
      if (/are you asleep right now/.test(prompt)) { questions.push(['sleep', prompt.match(/It is now ([^.]+) for/)[1]]); return '{"sleeping":true,"wake_at":"07:30"}'; }
      if (/what did you dream/.test(prompt)) { questions.push(['dream']); night = false; return '{"dream":"I was flying over the sea with my sister","remembered":"most"}'; }
      questions.push(['reading']);
      return night ? '{"location":"in the bedroom","pose":"lying in bed","action":"sleeping","topwear":["pyjamas"]}'
        : '{"location":"in the kitchen","pose":"standing at the counter","action":"making coffee","topwear":["a robe"]}';
    };
    await p2.goto(`${base}/__parent.html`);
    const f2 = p2.frameLocator('#f');
    const k2 = (k) => f2.locator(`[data-key="${k}"]`);
    const status = () => f2.locator('[data-testid="auto-status"]').innerText();
    const wait = async (fn, what) => { const end = Date.now() + 6000; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await p2.waitForTimeout(50); } throw new Error(`timed out waiting for: ${what} (${last})`); };

    await f2.locator('[data-testid="auto-value"]').waitFor();
    assert.equal(await f2.locator('[data-testid="auto-state"]').innerText(), 'Stopped');
    assert.equal(await f2.locator('[data-testid="auto-value"]').innerText(), 'Every 10 min', 'the default');
    assert.equal(await k2('auto-pause').isDisabled(), true);
    assert.equal(await k2('auto-stop').isDisabled(), true);
    await k2('auto-ruler').fill('0'); // 1 min
    assert.equal(await f2.locator('[data-testid="auto-value"]').innerText(), 'Every 1 min');
    await k2('auto-ruler').fill('3'); // back to 10 min
    await wait(() => JSON.parse([...files.values()][0]).autoIntervalS === 600, 'stored in seconds');
    assert.equal(questions.length, 0, 'moving the ruler asks nothing: Start does');
    await k2('auto-start').click();
    assert.equal(await f2.locator('[data-testid="auto-state"]').innerText(), 'Running');
    assert.equal(await p2.evaluate(() => document.querySelector('#f').contentDocument.activeElement.dataset.key), 'auto-pause', 'focus moves to Pause');

    await wait(async () => /Asleep until 7:30 AM tomorrow\./.test(await status()), 'hibernation');
    assert.deepEqual(questions, [['reading'], ['sleep', '22:00 on Friday']], 'a reading at once, then the sleep question with the person\'s time');
    assert.match(await status(), /The dream question comes at 7:20 AM tomorrow\./);
    assert.equal(JSON.parse([...files.values()][0]).sleep['k-isa'].wakeAt, new Date('2026-11-21T07:30:00-03:00').toISOString(), 'the wake-up time survives a reload');
    await p2.screenshot({ path: path.join(SHOTS, '11-workshop-asleep.png') });

    await k2('auto-pause').click(); // Pause through the dream time: nothing is asked, the night is kept
    assert.match(await status(), /Asleep until 7:30 AM tomorrow\..*Paused: nothing is asked until you press Resume\./);
    assert.equal(await k2('auto-start').innerText(), 'Resume');
    await p2.screenshot({ path: path.join(SHOTS, '14-workshop-paused.png') });
    await p2.clock.fastForward('08:00:00'); // 06:00
    await p2.waitForTimeout(300);
    assert.equal(questions.length, 2);
    await k2('auto-start').click(); // Resume: still asleep, waits for 07:20
    await p2.waitForTimeout(300);
    assert.equal(questions.length, 2);
    await p2.clock.fastForward('01:21:00'); // 07:21: the dream question
    await wait(async () => /flying over the sea/.test(await f2.locator('[data-testid="dream"]').innerText()), 'dream shown');
    assert.equal(await f2.locator('[data-testid="dream"]').innerText(), 'I was flying over the sea with my sister. Remembers most of it.');
    await wait(async () => /Next update at 7:31/.test(await status()), 'readings again');
    await p2.clock.fastForward('00:10:30');
    await wait(async () => (await f2.locator('[data-testid="location"]').innerText()) === 'In the kitchen.', 'the morning reading');
    assert.deepEqual(questions.map(([q]) => q), ['reading', 'sleep', 'dream', 'reading']);
    assert.equal(JSON.parse([...files.values()][0]).sleep['k-isa'], undefined, 'awake and the chat moved on: no sleep kept');
    await p2.screenshot({ path: path.join(SHOTS, '12-workshop-dream.png') });
    await k2('auto-stop').click();
    assert.equal(await f2.locator('[data-testid="auto-state"]').innerText(), 'Stopped');
    assert.equal(await f2.locator('[data-testid="dream"]').count(), 0, 'Stop forgets the dream');
    assert.equal(await f2.locator('[data-testid="location"]').innerText(), 'In the kitchen.', 'the last reading stays');
    await p2.clock.fastForward('02:00:00');
    await p2.waitForTimeout(300);
    assert.equal(questions.length, 4, 'nothing asked after Stop');
    assert.equal(JSON.parse([...files.values()][0]).autoState, 'stopped', 'saved: stays stopped after a reload');
    await p2.close();
  });

  await step('automatic update: when Kindroid does not answer, readings slow down and a server warning appears', async () => {
    files.clear(); kins = [{ id: 'k-isa', name: 'Isa' }]; delay = 20;
    files.set('cs/clotheskin~3av2~3asettings.json', JSON.stringify({ autoIntervalS: 60, autoState: 'running' })); // as left by an earlier visit
    const p3 = await ctx.newPage();
    p3.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await p3.clock.install({ time: new Date('2026-11-20T15:00:00-03:00') });
    await p3.route('**/__parent.html', (route) => route.fulfill({ contentType: 'text/html', body: PARENT }));
    await p3.exposeFunction('hostKins', () => kins);
    await p3.exposeFunction('hostRead', (p) => (files.has(p) ? files.get(p) : null));
    await p3.exposeFunction('hostWrite', (p, body) => { files.set(p, body); });
    let down = true;
    await p3.exposeFunction('hostAction', async (name, input) => { await new Promise((r) => setTimeout(r, delay)); const prov = { extract: async () => { if (down) throw new Error('The Kin could not be asked: connection refused'); return '{"location":"at the park"}'; } }; return handleRun({ event: { trigger: 'action', action: name, input }, provider: prov }); });
    await p3.goto(`${base}/__parent.html`);
    const f3 = p3.frameLocator('#f');
    const wait = async (fn, what) => { const end = Date.now() + 6000; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await p3.waitForTimeout(50); } throw new Error(`timed out waiting for: ${what} (${last})`); };
    await wait(async () => /connection refused/.test(await f3.locator('[data-testid="banner"]').innerText()), 'first error');
    await p3.clock.fastForward('01:01'); // 2nd error
    await p3.waitForTimeout(200);
    await p3.clock.fastForward('02:01'); // 3rd error: warning
    await wait(async () => (await f3.locator('[data-testid="server-warning"]').count()) === 1, 'server warning');
    assert.match(await f3.locator('[data-testid="server-warning"]').innerText(), /Kindroid has not answered 3 times in a row\. It may be down\. Automatic updates are slowed down and will try again at 3:07/);
    await p3.screenshot({ path: path.join(SHOTS, '13-workshop-server-warning.png') });
    down = false;
    await f3.locator('[data-key="auto-retry"]').click();
    await wait(async () => (await f3.locator('[data-testid="location"]').innerText()) === 'At the park.', 'back');
    assert.equal(await f3.locator('[data-testid="server-warning"]').count(), 0);
    await p3.close();
  });

  await step('inside a frame with no Workshop answering: a clear message and Try again, not a silent local mode', async () => {
    files.clear(); kins = [{ id: 'k-isa', name: 'Isa' }];
    const p4 = await ctx.newPage();
    p4.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    let answering = false;
    await p4.route('**/__parent.html', (route) => route.fulfill({ contentType: 'text/html', body: PARENT.replace("if (m.kin === 'kins') return window.pushKins();", "if (m.kin === 'kins') { if (!(await window.hostAnswering())) return; return window.pushKins(); }") }));
    await p4.exposeFunction('hostAnswering', () => answering);
    await p4.exposeFunction('hostKins', () => kins);
    await p4.exposeFunction('hostRead', () => null);
    await p4.exposeFunction('hostWrite', () => {});
    await p4.exposeFunction('hostAction', async () => ({ ok: false, message: '{}' }));
    await p4.goto(`${base}/__parent.html`);
    const f4 = p4.frameLocator('#f');
    await f4.locator('[data-testid="not-connected"]').waitFor({ timeout: 8000 });
    const t = await f4.locator('body').innerText();
    assert.match(t, /Could not reach the Kindroid Workshop/);
    assert.ok(!/Scene reader|Paste a conversation/.test(t), 'local mode is not shown by itself');
    await p4.screenshot({ path: path.join(SHOTS, '15-workshop-not-connected.png') });
    answering = true;
    await f4.locator('[data-key="connect-retry"]').click();
    await f4.locator('[data-testid="auto-state"]').waitFor({ timeout: 8000 }); // the Workshop card with its automation panel
    assert.match(await f4.locator('.card').first().innerText(), /Isa/);
    await p4.close();
  });

  await step('no page errors or console errors', async () => { assert.deepEqual(problems, []); });

  await browser.close(); server.close();
  const failed = results.filter((r) => r !== 'ok').length;
  console.log(`\n${results.length - failed}/${results.length} Workshop-mode checks passed`);
  process.exit(failed ? 1 : 0);
})();
