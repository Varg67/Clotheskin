# Clotheskin

A small tracker for Kindroid companions. It asks a Kin where it is, how it is positioned, what it is doing, what it is wearing and how its hair and makeup look, reads the answer, puts the pieces in order, adds the commas and shows **five natural sentences**:

> **Location** In the living room.
> **Pose and action** Sitting on the sofa, drinking coffee.
> **Outfit** Wearing a leather jacket, a perfumed white shirt and blue jeans, with glasses.
> **Hair** Long black hair in a ponytail.
> **Makeup** Red lipstick and eyeliner.

Everything comes from one question, so one `kin ask` per reading. In local mode nothing is saved. In the Workshop each Kin's **latest reading** is kept, so a reading made in the background can be shown later, plus a short **history** (the last 20 readings) and a **diagnostics log** (the last 15 attempts); it can run **automatically** at an interval you choose, and **waits longer while nothing changes**. Each reading stands on its own. (An earlier version kept a full wardrobe with item identity, layers, editors and six saved fields. It is in the git history at commit `17473e5`.)

## Open it

Requires Node 20+. No dependencies.

```bash
npm start
```

Open <http://localhost:5173> in a desktop browser. This is local mode: it serves the `screen/` folder and needs no Kindroid.

## Test it

```bash
npm test            # unit tests (Node's built-in runner)
npm run test:e2e    # browser tests: local mode at 960×690, and Workshop mode in a 390 px frame against a fake Workshop
```

The browser tests need Playwright and Chromium. If they are not installed: `npm i --no-save playwright && npx playwright install chromium`. Screenshots go to `tests/e2e/shots/`.

## How it works

1. **Ask.** The Kin gets one short question (`screen/src/core/prompt.js`): say where you are, how you are positioned, what you are doing and what you are wearing, as of your last message, in English only, concisely, as one-line JSON. `location` is a short phrase starting with in, at or on (`in the kitchen`, `at the hospital`, `on the bus to college`): the place only, not posture; travelling is a place (`on the way to the hospital`), a plan to go somewhere is not. `pose` is the body position (`sitting on the sofa`, `standing by the window`; it may name the furniture, while `location` is the room or place) and `action` is what it is doing right now as a short -ing phrase (`drinking coffee`): not plans, not things already finished, not feelings. `hair` and `makeup` are one short phrase each (`a messy bun`, `red lipstick and eyeliner`); `no makeup` is written only when the chat says so (a bare `none` means nothing was said). The other keys are slots (`headwear`, `topwear`, `bottomwear`, `footwear`, `footunderwear`, `topunderwear`, `bottomunderwear`, the twelve `*-accessory` slots and `bags`); values are lists of pieces, innermost layer first. The prompt is about 2,800 characters; `kin ask` allows 8,000.
2. **Read.** `parseReading` (`screen/src/core/outfit.js`) parses the answer. Common slips are handled: JSON inside a code fence or narration, trailing commas, curly quotes, a single string instead of a list, slot words like `top` or `shoes`, `clothing`/`accessories` instead of slots, placeholders such as `unknown` or `n/a`. A wrong value type or text that is not JSON is an error, and nothing is guessed.
3. **Show.** `describeOutfit`, `describeLocation` and `describeDoing` are the whole logic. The pose and action are one sentence, pose first, then the action after a comma (`Sitting on the sofa, drinking coffee.`); an action already written inside the pose is not repeated. For the action the Kin's slips are repaired (`I am reading a book` → `Reading a book.`) and plans, the past, future time words (`later`, `tomorrow`), feelings and `nothing` mean no action (`going to the store` is movement and stays). A pose that is really a place (`in the kitchen`) becomes the location when there is none, `position`/`posture`/`stance` and `activity`/`doing` are accepted as key names, and an object or number is an error. The location: The location is capitalised and given a full stop (the Kin is asked for the place only, so common slips are repaired: markdown or quotes around it, a posture or activity in front (`sitting on the sofa in the living room` → `On the sofa in the living room.`), a clause after it (`, cooking dinner`, `while reading`, `wearing a robe`), a list instead of a text, the keys `place`/`where`/`current_location`; a posture with no place, `somewhere`, `nowhere`, `unknown` and similar mean nothing was said; an object or number is an error. A bare noun phrase gets "in" only after an article or for a proper name (`Alfenas` → `In Alfenas.`), `home` gets "at", any other bare word and anything in Portuguese is shown as written). The outfit: branches in order (head, top, bottom, feet, then accessories and bags), the outermost piece first inside a branch, commas and "and". Underwear is only mentioned when there is nothing else to say about clothing. Hair and makeup (`describeHair`, `describeMakeup`) are the Kin's phrase with a capital and a full stop; a list is joined with commas and "and", `my hair is` is dropped, and `hairstyle`/`cosmetics` are accepted as key names. A missing key shows "No location described in the recent chat.", "No hair described in the recent chat." and so on.

The text the Kin reads is the `OUTFIT_PROMPT` constant; change it there. Its example is deliberately not the brief's scenario and the prompt says to never copy it, so a Kin that does copy values is easy to spot. `tests/location-ambiguity.test.js` and `tests/pose-action-ambiguity.test.js` feed plausible wrong answers through the pipeline.

## Two modes

- **Local** (`npm start`): paste a conversation, press **Update status** (or **Prepare prompt**), copy the prompt into any model, paste its JSON, press **Show status**. Demo scenes (including the Portuguese chat from the brief) run in one click. The pasted chat is kept in memory only.
- **Kindroid Workshop**: the app is a Workshop program (`kin.json`, `screen/`, `main.js`). The screen is shown in a ~390 pt locked frame. Kins are the ones attached to the app (id and name come from the host). **Update status** runs the action `read_outfit`: the run asks the Kin with `kin ask --kin <id>`, stores the reading, and ends with `kin end '{"at":"…","location":"…","doing":"…","outfit":"…","hair":"…","makeup":"…"}'`, which the screen shows. `kin end` allows 500 characters, so a long outfit, hair or makeup is shortened in that line (`"cut":true`; hair and makeup are left out when nothing was said); the screen then reads the stored copy, which has the same `at` and is never shortened, and shows it whole. Because the key cannot read chat, the grant `chat:read:1` lets the Kin itself see its recent chat, so the prompt carries no messages.

Stored: small preferences (theme, selected Kin, local character name, the automatic-update settings) and, in the Workshop only, two files per Kin: the latest reading, and a journal with the last 20 readings (history) and the last 15 attempts (diagnostics). Locally that is `localStorage` (preferences only); in the Workshop it is the program's own folder through `files.read`/`files.write` (the screen) and `kin files` (the run). No chat text and no answer of the Kin is ever stored: only the sentences, times, and for diagnostics the duration, the size of the answer and the reason of a failure.

## History and diagnostics (Workshop)

- **History**, under the card: the last 20 readings of the selected Kin, newest first, each with its time and whether it was automatic. Each entry repeats only what changed since the one before it. Automatic checks that found nothing new are not added (they are in the diagnostics). **Clear history** (press twice: a locked frame may not allow dialogs) empties it and keeps the current status.
- **Diagnostics**, in Settings: the last 15 attempts of the selected Kin, manual or automatic: when, ok or the kind of failure (`timeout`, `network`, `unavailable`, `rate-limit`, `permission`, `bad-answer`…), how long the question took, how many tries, how many characters the answer had, whether the line back was shortened, and the error text. **Copy diagnostics** copies it as JSON. It is meant for the first real runs (see *Pending verification*): it shows how the real `kin ask` behaves and what its errors say.
- Both are read only while open, so they cost nothing in the background. The run writes the journal after the reading (`JournalStore.record` in `screen/src/core/readings.js`): it reads it first and writes nothing if it cannot be read, so a passing storage problem never wipes the history; its `kin files` calls have a 15-second timeout, and a manual run that is already 110 s in skips it, so the screen (which waits 150 s) still gets the reading in time. A journal problem never fails a reading.

## Automatic updates (Workshop)

In **Settings → Automatic updates**: switch it on, set **Ask every (minutes)** (5 to 1,440; default 15) and tick the Kins to follow. Switching it on ticks the selected Kin.

- The Workshop cannot change a schedule at run time (`kin.json` is fixed), so the program is woken on one fixed beat (every 5 minutes, `*/5 * * * *`, set in `scripts/build-manifest.mjs`). Each run reads your settings and asks only the Kins that are due, so any interval is possible, rounded up to a multiple of 5 (the screen says so: "7 minutes behaves like 10").
- A Kin is due when the interval has passed since its last **attempt**. A failed attempt keeps the last good sentences and is retried after a short backoff (5, 10, 20… minutes, never more than the interval), not on every beat; a permission problem waits the whole interval. A manual **Update status** restarts the clock, so a Kin is not asked twice in a row.
- **Wait longer when nothing changes** (on by default): each automatic check that finds the same sentences as the one before (compared ignoring case, punctuation and accents) doubles the wait, up to 4× the interval and never past 24 hours. With 15 minutes that is 15, 30, 60, 60… The first change, a failure (which uses the short retry below) or **Update status** goes back to your interval. The settings say when it is stretching ("Nothing changed in the last 2 checks, so the next one waits about 60 minutes instead of 15."). A different wording of the same scene counts as a change, so when unsure the app asks sooner, not later. Logic: `adaptiveWaitMinutes` in `screen/src/core/auto.js`; the count is `stableCount` in the stored reading.
- At most 3 Kins are asked per beat (each is one question and a run has a time limit); the rest follow on the next beats, longest-waiting first. The attempt is marked **before** the question is sent, so a beat that starts while a previous one is still waiting for the Kin skips it. Two runs that start at the very same instant could still both ask; the platform may or may not serialise runs, which the guide does not say.
- The screen shows the stored reading when you open it ("Last checked … · automatic") and notices a new one every 20 seconds and when it regains focus. A failed automatic check shows "The last automatic check failed: …" under the card without erasing the last good sentences.
- Logic: `screen/src/core/auto.js` (interval, who is due), `screen/src/core/readings.js` (the stored reading), `run/actions.js` (the beat). Corrupt or missing settings mean **off**, never a burst of questions.
- **Cost:** every check is a `kin ask` plus running time, which the guide says uses your credits; it does not say how much. The beat itself also wakes the app every 5 minutes even when automatic updates are off (a run that does nothing and ends at once). Nothing is asked unless the setting is on.
- Local mode shows the section disabled with the reason: there is no Kin to ask on a schedule.

## When something goes wrong

The Kin or the connection can fail at any time: the model down or overloaded, a lag, a dropped connection, a rate limit, a missing permission. The app never loses the **last good reading** because of a failure, never hammers a failing Kin, and says what happened in plain English.

| What happened | What the app does |
|---|---|
| The `kin ask` takes too long (70 s) | the process is stopped (SIGTERM, then SIGKILL two seconds later if it ignores it), reported as "The Kin did not answer in time"; not retried at once, because it already cost a minute |
| Connection error, model unavailable or overloaded, rate limit | classified (`screen/src/core/errors.js`) and reported ("The Kin or its model is unavailable right now"); **Update status** retries once after 2 seconds, scheduled beats do not retry inside the run |
| Missing permission (`403`, `grant`) | reported with what to do ("check Apps, Waiting for you"); **not** retried sooner than the interval, since asking again cannot help |
| The `kin` command cannot start | reported as such; same as a permission problem |
| The Kin answers in character or the answer is cut | "not valid JSON … Nothing was changed"; counts as a failure |
| The Workshop itself does not answer the screen | "Kindroid did not answer in time. Check your connection and try again. Your last reading is still shown."; a reply that arrives late, after the screen gave up, is ignored |
| The Kin is just slow | after 15 s the button says "Still waiting for the Kin…" and a note says it can take up to a minute |
| A stored file cannot be **read** (not "missing") | that Kin is skipped, never overwritten: asking and saving could replace sentences that are fine. Unreadable **settings** end the beat as failed ("Could not read the settings"), they are not guessed as on or off |
| A setting cannot be **saved** | it is taken back and the screen says "Could not save this setting…", so you never believe automatic updates are on when the scheduled run cannot see it |

**Automatic checks after a failure** do not wait a whole interval, because a two-minute outage should not mean an hour without updates. The wait starts at one beat and doubles (5, 10, 20, 40 minutes…) up to your interval, then resets on the first success. A failure also shows under the card: the reason, how many checks in a row failed, and when it will try again. A beat stops starting new questions when there is not room left in the run's time limit; whoever is left goes first next time.

`tests/failures.test.js` covers all of this, including a fake `kin` process that hangs and one that ignores the stop signal.

## Look and feel

All colours, radii and shadows live in `screen/theme.css`; `screen/styles.css` uses no raw colours. Two themes, chosen under **Settings**:

- **Kindroid warm (default):** sampled from the Kindroid UI v2 login screen (warm off-white `#f5f0eb`, glass surfaces, coral `#c7503c`, pill controls).
- **Sage green:** sampled from a customised Kindroid desktop window (`#f4f6f5`, text `#283e36`). Its accent is inferred from the same hue, not sampled.
- "Match my Kindroid theme" is listed but disabled: it needs the Workshop to expose the host's colours, which is unverified.

`tests/theme.test.js` checks WCAG AA contrast for both themes.

## Pending verification in the Kindroid Workshop

Built from the Workshop guide and tested against a fake Workshop page that speaks its `postMessage` protocol, with the real run code behind it. **Not run against the real Workshop** (`kin.mjs` and the host could not be reached from the build environment). To confirm on the first real run (each is isolated so a fix is local):

1. `kin ask` prints the Kin's answer on stdout, and the Kin answers with JSON rather than in character. `run/kin-cli.js`
2. The grant is spelled `chat:read:1` (the guide names it next to `kin ask`, not in the grants list). `scripts/build-manifest.mjs`
3. The `kin end` line of an action started from the screen comes back to the screen as the action's `summary`, unchanged. `screen/src/host/channel.js`, `screen/src/ui/app.js` (plain text is still shown as the outfit)
4. The locked frame loads ES modules from the screen folder and allows `<dialog>.showModal()`. If not, the screen needs a one-file bundle.
5. `files.write` accepts a string body and `files.read` returns a string, and the screen's files and the run's `kin files` are the **same folder** (the schedule reads the settings the screen wrote, and the screen reads the readings the run wrote).
   Also: `kin files get/put/ls` behave as `run/kin-cli.js` assumes, a `schedule` trigger with `"tz": "user"` is accepted (it may need an extra **Allow**), and a 4-minute run timeout is accepted.
6. The `kin ask` exchange does not leak into the Kin's normal chat or memory.

First real test:

```bash
curl -fsSO https://downloads.kinusercontent.com/workshop/kin.mjs
export KIN_TOKEN=kk_...  KIN_PROGRAM=clotheskin
git add -A && git commit -m "Clotheskin"
node kin.mjs send .
```

A step-by-step script for that first run, with the sentences the card should show for each line you say to the Kin and eight **provoked failures** (permission not yet allowed, closing the panel mid-reading, no network, a detached Kin, a chatty Kin, a slow answer…) whose purpose includes collecting the **real error text** of `kin ask`, is in `docs/real-kin-test-script.md` (generated by `node scripts/build-test-script.mjs`; a test fails if it is stale).

Then, in Kindroid: Apps → **Waiting for you** → Allow (it reads the chat, so it always waits), open the app's settings → **Kins** and tick a Kin, open the screen, select the Kin and press **Update status**. Regenerate `kin.json` with `npm run build:manifest` after changing it (a test fails if it is stale).

## Limits

- Location, pose and action, clothing and accessories, hair and makeup. No objects in hand, no other people in the scene.
- History keeps the sentences, not the pieces, so it cannot say which garment changed; it shows which sentence changed.
- The reference image **Painel de estado da Isa.png** was never attached; the look follows the Kindroid UI screenshots.
- Automatic updates need the Workshop; there is no scheduler in local mode.
- English only, by design. The chat may be in any language the Kin understands; the answer and the sentence are English.
