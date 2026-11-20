# Clotheskin

A Kindroid app that follows your Kin in the current roleplay. It asks the Kin where it is, how it is positioned, what it is doing and what it is wearing, and shows **three sentences**:

> **Location** In the living room.
> **Pose and action** Standing, adjusting her collar.
> **Outfit** Wearing a leather jacket, a perfumed white shirt and blue jeans.

It can do this by itself every 15 minutes to 4 hours, and it follows the Kin's nights. When the Kin falls asleep it asks when it will wake up and leaves it alone until then. In the morning it asks what it dreamt and how much it still remembers. With your permission, it also tells the Kin its dream, so the Kin can remember it during the day.

Built from Kindroid's guide for coding tools ("Making things for a Kin with your own coding tool") and from published programs (Dice Roller, Bunny & Fox BBS, Aurora Alert).

## How it works in Kindroid

```
 Kindroid, every 15 min ──> node main.js ──> run/program.js ──> kin ask / kin tell / kin files
 (schedule trigger)               ^                 │
                                  │                 └──> status.json  (the run writes)
 screen ── update_status ─────────┘                          │
   │                                                         v
   └── settings.json (the screen writes) <───────── screen reads both
```

- **The run is the engine** (`main.js`, `run/program.js`). A schedule trigger (`*/15 * * * *`, on the person's clock) starts it every 15 minutes. Each start reads `settings.json` and checks whether a reading is due; most starts end there, without asking anything. When one is due, it asks the Kin (`kin ask`; the Kin sees 2 days of its chat through `chat:read:2`) and writes the result to `status.json`.
- **The screen is a view and a remote control** (`screen/`). It shows `status.json`, which it re-reads every minute and after each action. It writes only `settings.json`: which Kin, Start/Pause/Stop, the interval, the person's time zone, the theme and the dream options. **Update status** and **Wake now** use the program's one action, `update_status`, which runs the same engine at once. Each file has one writer, so the screen and a run never overwrite each other.
- **The sleep cycle.**
  - **Falling asleep.** When the pose and action say the Kin is asleep ("Lying in bed, sleeping."), the run asks whether it is and when it plans to wake up. The question gives the person's clock ("It is now 23:10 on Friday"), and the answer is JSON: `{"sleeping":true,"wake_at":"07:30"}`.
  - **The night.** Nothing is asked until about 10 minutes before the wake-up time.
  - **The dream.** Then the run asks `{"dream":"…","remembered":"all|most|some|little|nothing"}`. The screen shows the answer as **Last dream**. Unless the person turned it off, the run also tells the Kin with `kin tell --key dream --ttl 24`; with "Let my Kin bring the dream up by itself" turned on, it adds `--reach-out soon`.
  - **The next morning.** The chat usually stays still overnight, so the same "asleep" sentence does not start a new night. A wake-up time less than 15 minutes or more than 14 hours away is not believed, and the readings go on.
  - **Waking up early.** Reading the Kin by hand during its night and finding it awake ends the night.
- **Errors.**
  - **Retries:** a fast Kindroid failure (a 502, a 503, a dropped connection) is tried once more within the run. Errors in a row slow the next try down: 2× from the second, up to 1 hour.
  - **Server warning:** three Kindroid errors in a row show a warning with the time of the next try. A failure that says "maintenance", "scheduled downtime" or "outage" shows a maintenance warning and waits at least 30 minutes. A failing `kin kins` counts like any Kindroid error.
  - **Kin answers:** a wrong answer from the Kin (in character, not JSON) is the Kin's error, not Kindroid's: it slows the readings down without the server warning. The error never quotes the answer.
  - **Nothing lost:** a file that exists but cannot be read is never written over (only kin's own "404" means "no file yet"). A save that fails ends the run with `--failed`.
- **Time.** A run has 2 minutes (`kin.json`). The program keeps to 100 s: each question gets only the time left, and a retry or sleep question that would not fit waits for the next start. The reading is saved before the sleep question, so it is never lost. If anything still hangs, `main.js` ends the run itself at 110 s with `kin end --failed`.
- **Two runs at once** (a scheduled start and Update status): each save re-reads `status.json`. The night goes to the run that changed it (one that asked the dream question beats one that only read "still asleep"). The newest reading and dream are kept.
- **Start / Pause / Stop.**
  - **Pause:** nothing is asked; the night and its times are kept.
  - **Stop:** nothing is asked, and the night, the dream and any slowing down are forgotten at once (Stop saves `stoppedAt`; the run and the screen both set aside what is older). The last reading stays.
  - **The ruler:** moving it applies at once. The planned time is the last run plus the current interval, except when errors are slowing things down; then the later try is kept.

### What is stored, and what it costs

- **Stored**, in the program's folder in Kindroid: `settings.json` (your choices) and `status.json`.
  - `status.json` holds, per Kin: the last reading (the three sentences), when it last ran, errors, the night's times, and the last dream summary.
  - Never the chat. For the night, only a fingerprint (hash) of the "asleep" sentence, never the sentence.
  - The screen keeps nothing in the browser.
- **Credits.** Kindroid starts the program every 15 minutes, **even while it is stopped**, and running time uses the person's credits. Each start that has nothing due is a short run: it reads two files and ends. The Kin is asked only when an update is due: once per interval, plus the sleep and dream questions. The screen says this under the ruler.

## Develop

Requires Node 22+. No dependencies at run time.

```bash
npm start            # the dev harness: http://localhost:5173
npm test             # unit tests (node --test), ~110 checks, a few seconds
npm run test:e2e     # browser tests on the dev harness (Playwright + Chromium)
npm run build        # rebuilds screen/app.js and kin.json (tests fail if either is stale)
```

**The dev harness** (`dev/`) is a stand-in for Kindroid.
- **The real pieces.** It shows the real screen in a 390-point frame and answers its messages (`kins`, `files.read`, `files.write`, `action`) as the guide describes. Actions and the "15-minute start" run the **real** `run/program.js`.
- **The stand-in Kin.** Its answers come from a scene (`dev/scenes.js`), and you can edit them. One scene goes to sleep and dreams.
- **Other controls.** You can attach and detach Kins, make Kindroid "fail" or be "under maintenance", and see every `kin` call.
- **The browser tests** drive the same harness (`window.dev`) with Playwright's clock, so a whole night takes a second.

**Trying the run with Kindroid's own `kin` command.** The guide's mock mode records every call without touching anything real:

```bash
curl -fsSO https://downloads.kinusercontent.com/workshop/kin.mjs
npm run try              # a scheduled start, with KIN_MOCK and KIN_MOCK_ASK
npm run try -- action    # the screen's Update status
```

### Layout

| Path | What |
| --- | --- |
| `kin.json` | the manifest (generated by `scripts/build-manifest.mjs`): schedule trigger, run, screen, one action, `kin:read` + `chat:read:2` |
| `main.js` | the run's entry: stdin → program → always exactly one `kin end` |
| `run/kin.js` | the `kin` command as functions: UTF-8 output read whole, stdin closed, timeouts, a missing file (404) told apart from a failure |
| `run/program.js` | the engine: schedule and action, reading, sleep, dream, errors (no Node imports: it also runs in the harness) |
| `src/core/` | shared logic: reading the Kin's answers (`outfit.js`), prompts, sleep, schedule, time zones, the two files (`state.js`) |
| `src/screen/` | the screen's sources: channel to the page, app, DOM helpers, icons |
| `screen/` | what Kindroid serves: `index.html`, `app.js` (**generated**: one classic script from `src/`, no modules, checked for features newer than Safari 14.1), `styles.css`, `theme.css` |
| `sample/` | sample `settings.json` and `status.json` for the App Library card's picture |
| `dev/` | the dev harness |
| `tests/` | unit tests, `run-main.test.js` (the real `node main.js` with a stand-in `kin`), `e2e/screen.cjs` |

## Send it to Kindroid

```bash
export KIN_TOKEN=kk_...  KIN_PROGRAM=clotheskin
git add -A && git commit -m "Clotheskin"
node kin.mjs send .
```

Then, in Kindroid: Apps → **Waiting for you** → Allow. It reads your Kin's chat, so it always waits for you. To have it follow a Kin, open the app's settings → **Kins** and tick the Kin. Open the screen, pick the Kin of your roleplay, and press **Start**.

## Still to confirm on the first real run

Everything above is tested against the guide and the dev harness, not yet inside Kindroid.

1. **`kin ask` output.** It prints the Kin's answer on stdout, as plain text: Aurora Alert reads it that way. The Kin answers with JSON rather than in character.
2. **`kin files get` for a missing file.** It fails with a "404" or "not found" message (Bunny & Fox BBS checks for `404`). Any other failure is treated as "could not read", and nothing is written over.
3. **`kin kins` format.** It prints `id<TAB>name`, one per line.
4. **The screen's single `app.js`.** It loads in the frame (also on phones and older Safari, 14.1+), and the screen re-sends its handshake until the page answers.
5. **The App Library picture.** The picture is taken with the `sample/` files answered and no Kin list. The screen shows the sample after 1.5 s and saves nothing.
6. **Questions stay out of the chat.** The `kin ask` questions do not show up in the Kin's chat or memory.
7. **The run's container clock.** The run does not rely on its clock zone: wake-up times use the time zone the screen saved.

## Limits

- **What it reads.** Only location, pose and action, clothing and accessories. Hair and makeup are not read.
- **English answers.** The chat may be in any language the Kin understands (the demo scene is Portuguese); the answers and sentences are English.
- **One Kin at a time.** Only the selected Kin is read; the others cost nothing.
