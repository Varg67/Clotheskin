// Browser tests of the real screen (screen/app.js) inside the dev harness (dev/): a stand-in for Kindroid that speaks
// the guide's postMessage protocol and runs the real program (run/program.js) with a scripted Kin.
// Run: npm run test:e2e   (Playwright and Chromium are needed; screenshots go to tests/e2e/shots/).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push('ok'); console.log(`  ok   ${name}`); } catch (e) { results.push('FAIL'); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 8).join('\n       ')}`); }
};

(async () => {
  const { createAppServer } = await import('../../server.mjs');
  const server = createAppServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const problems = [];

  /** A fresh harness: its own browser context (no files), a clock set to `time`, the Kins and scene given. */
  async function open({ time = '2026-11-20T22:00:00-03:00', kins, scene = 'pt-jeans-jacket', files, width = 1100, silent = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });
    ctx.setDefaultTimeout(6000);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await page.clock.install({ time: new Date(time) });
    if (silent || kins || files) {
      // configure the harness before the screen connects: the page answers nothing until then
      await page.addInitScript(({ kins: k, files: f, silent: s }) => {
        const S = 'clotheskin-dev';
        const saved = { files: f || {}, kins: (k || [{ id: 'kin-isa', name: 'Isa' }, { id: 'kin-bea', name: 'Bea' }]).map((x) => ({ attached: true, ...x })) };
        if (window === window.top) localStorage.setItem(S, JSON.stringify(saved));
        if (s && window === window.top) window.__silent = true;
      }, { kins, files, silent });
    }
    await page.goto(`${base}/`);
    if (silent) await page.evaluate(() => window.dev.silent(true));
    await page.evaluate((id) => window.dev.scene(id), scene);
    const fr = page.frameLocator('#frame');
    const key = (k) => fr.locator(`[data-key="${k}"]`);
    const text = (id) => fr.locator(`[data-testid="${id}"]`).innerText();
    const until = async (fn, what, ms = 6000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await page.waitForTimeout(40); } throw new Error(`timed out waiting for: ${what} (${last})`); };
    const idle = () => fr.locator('[data-key="update"][aria-busy="false"]').waitFor();
    const settings = async () => JSON.parse((await page.evaluate(() => window.dev.files()))['settings.json'] || '{}');
    const status = async () => JSON.parse((await page.evaluate(() => window.dev.files()))['status.json'] || '{"kins":{}}');
    const frameEval = (fn, arg) => page.frames().find((f) => f.url().includes('/screen/')).evaluate(fn, arg);
    return { ctx, page, fr, key, text, until, idle, settings, status, frameEval, dev: (fn, arg) => page.evaluate(fn, arg) };
  }

  await step('several Kins: the screen opens on the list; one tap picks the Kin of the roleplay and saves it for the run', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }, { id: 'kin-bea', name: 'Bea' }, { id: 'kin-alex', name: 'Alex' }] });
    await t.fr.getByText('Which Kin is in your roleplay now?').waitFor();
    assert.equal((await t.fr.locator('.picker-card').innerText()).match(/Not read yet/g).length, 3);
    await t.page.screenshot({ path: path.join(SHOTS, '01-pick.png') });
    await t.key('pick-kin-bea').click();
    assert.equal(await t.frameEval(() => document.activeElement.dataset.key), 'update', 'focus moves to Update status');
    assert.match(await t.text('only-this'), /Only this Kin is read · 2 others attached/);
    await t.until(async () => (await t.settings()).kinId === 'kin-bea', 'kinId saved');
    const s = await t.settings();
    assert.equal(s.tz, 'America/Sao_Paulo', 'the person\'s time zone is saved for the run');
    assert.equal(s.autoState, 'stopped', 'nothing runs until Start');
    // the frame shares this test page's origin, so it sees the harness's own key: anything else would be the screen's
    assert.deepEqual(await t.frameEval(() => Object.keys(localStorage).filter((k) => k !== 'clotheskin-dev').concat(document.cookie ? ['cookie'] : [])), [], 'no browser storage used by the screen');
    await t.ctx.close();
  });

  await step('one Kin: chosen by itself (and saved, so the run knows it); no list, no switch button', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }] });
    await t.key('update').waitFor();
    assert.equal(await t.key('switch').count(), 0);
    await t.until(async () => (await t.settings()).kinId === 'kin-isa', 'kinId saved');
    await t.ctx.close();
  });

  await step('Update status: the run reads the Kin; activity on the button; two clicks ask once; the sentences appear', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }] });
    await t.key('update').click();
    await t.key('update').click();
    assert.equal(await t.key('update').getAttribute('aria-busy'), 'true');
    assert.match(await t.key('update').innerText(), /Reading…/);
    await t.idle();
    await t.until(async () => (await t.text('location')) === 'In the living room.', 'location');
    assert.equal(await t.text('doing'), 'Standing, adjusting her collar.');
    assert.equal(await t.text('outfit'), 'Wearing a leather jacket, a perfumed white shirt and blue jeans.');
    assert.match(await t.text('last-checked'), /Last read: 10:00 PM · just now/);
    assert.deepEqual(await t.dev(() => window.dev.asks()), ['reading'], 'one question to the Kin despite two clicks');
    await t.page.screenshot({ path: path.join(SHOTS, '02-read.png') });
    await t.ctx.close();
  });

  await step('the Kin answers in character: an error with Try again, said once by the alert region; the last reading stays', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }] });
    await t.key('update').click(); await t.idle();
    await t.dev(() => window.dev.answers({ reading: '*giggles* A form? Not today!' }));
    await t.key('update').click(); await t.idle();
    const b = t.fr.locator('[data-testid="banner"]');
    await b.waitFor();
    assert.match(await b.innerText(), /not valid JSON/);
    assert.match(await b.innerText(), /Try again/);
    await t.until(async () => /not valid JSON/.test(await t.fr.locator('[role=alert]').innerText()), 'alert region');
    assert.equal(await t.text('location'), 'In the living room.', 'the last reading stays');
    await t.ctx.close();
  });

  await step('Start / Pause / Stop and the ruler: settings saved in seconds; the panel says when the next update is', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }] });
    await t.key('update').waitFor();
    assert.equal(await t.text('auto-state'), 'Stopped');
    assert.equal(await t.key('auto-pause').isDisabled(), true);
    assert.equal(await t.text('auto-value'), 'Every 30 min', 'the default');
    await t.key('auto-ruler').fill('0');
    assert.equal(await t.text('auto-value'), 'Every 15 min');
    await t.until(async () => (await t.settings()).intervalS === 900, 'interval saved in seconds');
    await t.key('auto-start').click();
    assert.equal(await t.text('auto-state'), 'Running');
    assert.equal(await t.frameEval(() => document.activeElement.dataset.key), 'auto-pause');
    await t.until(async () => (await t.settings()).autoState === 'running', 'running saved');
    assert.match(await t.text('auto-status'), /Next update around 10:15 PM\./, 'never read: the next start of the program');
    await t.dev(() => window.dev.tick()); // Kindroid's 15-minute start
    await t.until(async () => (await t.status()).kins['kin-isa']?.reading, 'read by the scheduled start');
    await t.key('auto-pause').click();
    assert.equal(await t.key('auto-start').innerText(), 'Resume');
    await t.key('auto-stop').click();
    assert.equal(await t.text('auto-state'), 'Stopped');
    assert.match(await t.text('auto-status'), /Stopped\. Press Start/);
    await t.page.screenshot({ path: path.join(SHOTS, '03-automation.png') });
    await t.ctx.close();
  });

  await step('the night: asleep -> wake-up time -> nothing asked overnight -> the dream at 07:15 -> Last dream, told to the Kin', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], scene: 'night', time: '2026-11-20T23:10:00-03:00' });
    assert.equal(await t.key('tell-dream').isChecked(), false, 'off until the person turns it on');
    assert.equal(await t.key('tell-dream').isVisible(), true, 'in plain sight, not inside Settings');
    await t.key('tell-dream').check();
    await t.until(async () => (await t.settings()).tellDream === true, 'tellDream saved');
    await t.key('auto-start').click();
    await t.until(async () => (await t.settings()).autoState === 'running', 'running');
    await t.dev(() => window.dev.tick());
    await t.until(async () => (await t.status()).kins['kin-isa']?.sleep, 'night saved');
    await t.page.clock.fastForward('01:00'); // the screen reads status.json again every minute
    await t.until(async () => /Asleep until 7:30 AM tomorrow\. The dream question comes around 7:15 AM tomorrow\./.test(await t.text('auto-status')), 'asleep shown');
    assert.deepEqual(await t.dev(() => window.dev.asks()), ['reading', 'sleep']);
    await t.page.screenshot({ path: path.join(SHOTS, '04-asleep.png') });
    for (const at of ['2026-11-21T02:00:00-03:00', '2026-11-21T07:00:00-03:00']) {
      await t.page.clock.setSystemTime(new Date(at));
      await t.dev(() => window.dev.tick());
    }
    assert.deepEqual(await t.dev(() => window.dev.asks()), ['reading', 'sleep'], 'nothing asked overnight');
    await t.page.clock.setSystemTime(new Date('2026-11-21T07:15:00-03:00'));
    await t.dev(() => window.dev.tick());
    await t.until(async () => (await t.status()).kins['kin-isa']?.dream, 'dream saved');
    await t.page.clock.fastForward('01:00');
    await t.until(async () => /flying over the sea/.test(await t.text('dream')), 'dream shown');
    assert.equal(await t.text('dream'), 'I was flying over the sea at night with my sister, and the lighthouse kept calling my name. Remembers most of it.');
    const [tell] = await t.dev(() => window.dev.tells());
    assert.match(tell[1], /^While you slept, you dreamt: "I was flying over the sea/);
    assert.deepEqual(tell[2], { kin: 'kin-isa', key: 'dream', ttl: 24, reachOut: false });
    await t.page.screenshot({ path: path.join(SHOTS, '05-dream.png') });
    await t.ctx.close();
  });

  await step('Wake now asks about the dream at once; the button shows it', async () => {
    const night = { 'settings.json': JSON.stringify({ kinId: 'kin-isa', autoState: 'running', tz: 'America/Sao_Paulo' }), 'status.json': JSON.stringify({ kins: { 'kin-isa': { name: 'Isa', sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' } } } }) };
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], scene: 'night', files: night, time: '2026-11-21T01:00:00-03:00' });
    await t.key('wake-now').click();
    assert.match(await t.key('update').innerText(), /Asking about the dream…/);
    await t.idle();
    await t.until(async () => /flying over the sea/.test(await t.text('dream')), 'dream');
    assert.deepEqual(await t.dev(() => window.dev.asks()), ['dream']);
    await t.ctx.close();
  });

  await step('Kindroid down: readings slow down, then a warning with the next try; Try now; one success clears it', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], files: { 'settings.json': JSON.stringify({ kinId: 'kin-isa', autoState: 'running', intervalS: 900, tz: 'America/Sao_Paulo' }) } });
    await t.key('update').waitFor();
    await t.dev(() => window.dev.kindroid('down'));
    for (let i = 0; i < 3; i += 1) {
      const st = await t.status();
      const retry = st.kins['kin-isa']?.retryAt;
      if (retry) await t.page.clock.setSystemTime(new Date(retry));
      await t.dev(() => window.dev.tick());
    }
    await t.page.clock.fastForward('01:00');
    await t.until(async () => (await t.fr.locator('[data-testid="server-warning"]').count()) === 1, 'warning');
    assert.match(await t.fr.locator('[data-testid="server-warning"]').innerText(), /Kindroid has not answered 3 times in a row\. It may be down\. The next try is around/);
    await t.page.screenshot({ path: path.join(SHOTS, '06-server-warning.png') });
    await t.dev(() => window.dev.kindroid('up'));
    await t.key('retry').click(); await t.idle();
    await t.until(async () => (await t.fr.locator('[data-testid="server-warning"]').count()) === 0, 'cleared');
    assert.equal(await t.text('location'), 'In the living room.');
    await t.ctx.close();
  });

  await step('switching the Kin on the card (no dialog); a detached Kin goes back to the list', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }, { id: 'kin-bea', name: 'Bea' }] });
    await t.key('pick-kin-isa').click();
    await t.key('update').click(); await t.idle();
    await t.key('switch').click();
    assert.equal(await t.fr.locator('dialog').count(), 0);
    const list = await t.fr.locator('.picker').innerText();
    assert.match(list, /Isa\s+In the living room · just now\s+Selected/);
    assert.match(list, /Bea\s+Not read yet/);
    await t.key('pick-kin-bea').click();
    assert.equal(await t.fr.locator('.name').innerText(), 'Bea');
    await t.dev(() => window.dev.setKins([{ id: 'kin-isa', name: 'Isa' }, { id: 'kin-alex', name: 'Alex' }]));
    await t.fr.getByText('Which Kin is in your roleplay now?').waitFor();
    await t.ctx.close();
  });

  await step('the screen reads its files even when the page answers late (it resends), and works at 320 px', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], width: 700 });
    await t.page.evaluate(() => { document.getElementById('frame').style.width = '320px'; });
    await t.key('update').click(); await t.idle();
    const over = await t.frameEval(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `no horizontal scroll (${over})`);
    const row = await t.frameEval(() => { const r = document.querySelector('.auto-controls').getBoundingClientRect(); return [...document.querySelectorAll('.auto-controls .btn')].every((b) => b.getBoundingClientRect().right <= r.right + 0.5); });
    assert.ok(row, 'Start, Pause and Stop fit');
    await t.page.screenshot({ path: path.join(SHOTS, '07-320px.png') });
    await t.ctx.close();
  });

  await step('no answer from the page: "Could not reach Kindroid" with Try again; it connects when the page answers', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], silent: true });
    await t.page.clock.fastForward('00:05');
    await t.fr.locator('[data-testid="not-connected"]').waitFor();
    await t.page.screenshot({ path: path.join(SHOTS, '08-not-connected.png') });
    const section = await t.fr.locator('[data-testid="not-connected"]').elementHandle();
    await t.page.clock.fastForward('00:25'); // two automatic attempts
    assert.ok(await section.evaluate((el) => el.isConnected), 'the alert is not rebuilt (it would be read again)');
    await t.dev(() => window.dev.silent(false));
    await t.key('connect-retry').click();
    await t.key('update').waitFor({ timeout: 8000 });
    assert.equal(await t.frameEval(() => document.activeElement.dataset.key), 'update', 'focus stays in the app');
    await t.ctx.close();
  });

  await step('the App Library picture: only the sample/ files, no Kin list: the card shows the sample, saves nothing', async () => {
    const sample = { 'settings.json': fs.readFileSync(path.join(__dirname, '../../sample/settings.json'), 'utf8').trim(), 'status.json': fs.readFileSync(path.join(__dirname, '../../sample/status.json'), 'utf8').trim() };
    const t = await open({ files: sample, time: '2026-11-20T15:20:00Z' });
    await t.dev(() => window.dev.noKins(true));
    await t.dev(() => window.dev.reloadScreen());
    await t.page.clock.fastForward('00:05');
    await t.until(async () => (await t.fr.locator('.name').innerText()) === 'Juniper', 'sample card', 10000);
    assert.equal(await t.text('location'), 'At a café by the river.');
    assert.equal(await t.fr.locator('[data-testid="banner"], [data-testid="not-connected"]').count(), 0);
    const writes = await t.dev(() => window.dev.state.calls.filter((c) => c[0] === 'screen files.write').length);
    assert.equal(writes, 0, 'nothing saved');
    await t.page.screenshot({ path: path.join(SHOTS, '09-card-picture.png') });
    await t.ctx.close();
  });

  await step('the run always knows the Kin: one Kin left after a detach, or a Kin list that comes late, is saved for it', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }, { id: 'kin-bea', name: 'Bea' }] });
    await t.key('pick-kin-bea').click();
    await t.until(async () => (await t.settings()).kinId === 'kin-bea', 'Bea saved');
    await t.dev(() => window.dev.setKins([{ id: 'kin-isa', name: 'Isa' }])); // Bea detached: only Isa is left
    await t.until(async () => (await t.settings()).kinId === 'kin-isa', 'Isa saved for the run');
    await t.key('auto-start').click();
    await t.until(async () => (await t.settings()).autoState === 'running', 'running');
    const r = await t.dev(() => window.dev.tick());
    assert.match(r.message, /^Isa: In the living room\./, 'the scheduled start reads Isa');
    await t.ctx.close();
  });

  await step('an old error is cleared by a later successful run; Update status on one Kin does not show "Reading…" on another', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }, { id: 'kin-bea', name: 'Bea' }], files: { 'settings.json': JSON.stringify({ kinId: 'kin-isa', autoState: 'running', tz: 'America/Sao_Paulo' }) } });
    await t.dev(() => window.dev.answers({ reading: '*giggles* No.' }));
    await t.key('update').click(); await t.idle();
    await t.fr.locator('[data-testid="banner"]').waitFor();
    await t.dev(() => window.dev.scene('pt-jeans-jacket'));
    await t.page.clock.setSystemTime(new Date('2026-11-20T22:30:00-03:00'));
    await t.dev(() => window.dev.tick()); // the scheduled start succeeds
    await t.page.clock.fastForward('01:00');
    await t.until(async () => (await t.fr.locator('[data-testid="banner"]').count()) === 0, 'banner cleared');
    await t.dev(() => { window.dev.state.actionDelayMs = 3000; });
    await t.key('update').click();
    await t.key('switch').click();
    await t.key('pick-kin-bea').click();
    assert.equal(await t.key('update').getAttribute('aria-busy'), 'false', 'Bea is not being read');
    await t.ctx.close();
  });

  await step('focus never falls out of the app: after Wake now, and after Try again', async () => {
    const night = { 'settings.json': JSON.stringify({ kinId: 'kin-isa', autoState: 'running', tz: 'America/Sao_Paulo' }), 'status.json': JSON.stringify({ kins: { 'kin-isa': { name: 'Isa', lastRunAt: '2026-11-21T03:00:00Z', sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' } } } }) };
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], scene: 'night', files: night, time: '2026-11-21T01:00:00-03:00' });
    await t.key('wake-now').focus();
    await t.page.keyboard.press('Enter');
    await t.idle();
    assert.notEqual(await t.frameEval(() => document.activeElement.tagName), 'BODY');
    await t.ctx.close();
  });

  await step('the reading is told after Update status even when nothing changed; Stop forgets the night at once', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }] });
    await t.key('update').click(); await t.idle();
    await t.page.clock.fastForward('00:02');
    await t.key('update').click(); await t.idle();
    await t.until(async () => /In the living room\./.test(await t.frameEval(() => document.querySelector('[role=status][aria-live]').textContent)), 'told again');
    const night = { 'settings.json': JSON.stringify({ kinId: 'kin-isa', autoState: 'running', tz: 'America/Sao_Paulo' }), 'status.json': JSON.stringify({ kins: { 'kin-isa': { name: 'Isa', lastRunAt: '2026-11-21T03:00:00Z', sleep: { wakeAt: '2026-11-21T10:30:00Z', until: '2026-11-21T10:20:00Z' }, dream: { dream: 'An old dream', remembered: 'all', at: '2026-11-21T00:00:00Z' } } } }) };
    const u = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], files: night, time: '2026-11-21T01:00:00-03:00' });
    await u.until(async () => /Asleep until/.test(await u.text('auto-status')), 'asleep');
    await u.key('auto-stop').click();
    await u.key('auto-start').click(); // before any start of the program
    assert.match(await u.text('auto-status'), /^Next update around/, 'the night is gone at once');
    assert.equal(await u.fr.locator('[data-testid="dream"]').count(), 0, 'and the dream');
    await t.ctx.close(); await u.ctx.close();
  });

  await step('what the Kin says nothing about keeps the last known sentence, marked with when it was seen', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }] });
    await t.key('update').click();
    await t.until(async () => /leather jacket/.test(await t.text('outfit')), 'first reading');
    assert.equal(await t.fr.locator('[data-testid="outfit-seen"]').count(), 0, 'fresh: no "seen" mark');
    await t.page.clock.fastForward('20:00');
    await t.dev(() => window.dev.answers({ reading: '{"location":"in the kitchen","action":"ordering pizza"}' }));
    await t.key('update').click();
    await t.until(async () => /kitchen/.test(await t.text('location')), 'second reading');
    assert.match(await t.text('outfit'), /leather jacket/, 'the outfit is kept');
    assert.equal(await t.text('outfit-seen'), ' · seen 10:00 PM');
    assert.equal(await t.fr.locator('[data-testid="location-seen"]').count(), 0, 'the location is new');
    await t.page.screenshot({ path: path.join(SHOTS, '10-kept-outfit.png') });
    await t.ctx.close();
  });

  await step('Settings shows the version; a run from another update shows a warning to update all the files', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], files: { 'status.json': JSON.stringify({ runVersion: '0.3.0', kins: {} }) } });
    await t.key('update').waitFor();
    await t.key('settings-summary').click();
    assert.equal(await t.text('version'), `Clotheskin ${pkg.version}`);
    assert.match(await t.text('version-mismatch'), new RegExp(`the screen is ${pkg.version.replace(/\./g, '\\.')}, the automatic part is 0\\.3\\.0\\. Update all the files together\\.`));
    await t.key('update').click();
    await t.fr.locator('[data-testid="version-mismatch"]').waitFor({ state: 'detached' }); // the run saved: same version now
    await t.ctx.close();
  });

  await step('no makeup: the makeup row is hidden; a lipstick shows it again', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }] });
    await t.dev(() => window.dev.answers({ reading: '{"location":"in the bathroom","topwear":["a dress"],"makeup":"no makeup"}' }));
    await t.key('update').click();
    await t.until(async () => /bathroom/.test(await t.text('location')), 'read');
    assert.equal(await t.fr.locator('[data-testid="makeup"]').count(), 0, 'no makeup row');
    await t.page.clock.fastForward('20:00');
    await t.dev(() => window.dev.answers({ reading: '{"makeup":"red lipstick"}' }));
    await t.key('update').click();
    await t.until(async () => /lipstick/i.test(await t.text('makeup')), 'the row is back');
    await t.ctx.close();
  });

  await step('Current look: off and in plain sight; ticking it saves the choice; a refused note is said, with when it is tried again', async () => {
    const t = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }] });
    await t.key('update').waitFor();
    assert.equal(await t.key('tell-look').isVisible(), true, 'not inside Settings');
    assert.equal(await t.key('tell-look').isChecked(), false, 'off until the person turns it on');
    await t.key('tell-look').check();
    await t.until(async () => (await t.settings()).tellLook === true, 'tellLook saved');
    await t.ctx.close();
    const failedAt = '2026-11-20T21:50:00-03:00';
    const u = await open({ kins: [{ id: 'kin-isa', name: 'Isa' }], files: {
      'settings.json': JSON.stringify({ kinId: 'kin-isa', tellLook: true, tz: 'America/Sao_Paulo' }),
      'status.json': JSON.stringify({ kins: { 'kin-isa': { name: 'Isa', lastRunAt: failedAt, lookFailedAt: failedAt, lookError: 'kin tell failed: not allowed' } } }),
    } });
    await u.until(async () => /did not take the last note/.test(await u.text('look-problem')), 'the problem is shown');
    assert.equal(await u.text('look-problem'), 'Kindroid did not take the last note (kin tell failed: not allowed). Clotheskin tries again after 10:50 PM.');
    await u.ctx.close();
  });

  await step('no page errors or console errors', async () => { assert.deepEqual(problems, []); });

  await browser.close(); server.close();
  const failed = results.filter((r) => r !== 'ok').length;
  console.log(`\n${results.length - failed}/${results.length} screen checks passed`);
  process.exit(failed ? 1 : 0);
})();
