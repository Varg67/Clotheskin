# Clotheskin

A Kindroid app that follows your Kin in the current roleplay. It asks the Kin where it is, how it is positioned, what it is doing, what it is wearing, and its hair and makeup, and shows **short sentences**:

> **Location** In the living room.
> **Pose and action** Standing, adjusting her collar.
> **Outfit** Wearing a leather jacket, a perfumed white shirt and blue jeans.
> **Hair** Up in a messy bun. *(and **Makeup**, when the Kin says)*

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
  - **The dream.** Then the run asks `{"dream":"…","remembered":"all|most|some|little|nothing"}`. The screen shows the answer as **Last dream**. Only if the person ticked "Tell my Kin its dream" (off by default, on the screen's **Dreams** card, not inside Settings) does the run also tell the Kin with `kin tell --key dream --ttl 24`; with "Let my Kin bring the dream up by itself" turned on, it adds `--reach-out soon`.
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
  - `status.json` holds, per Kin: the last reading (the three sentences), when it last ran, errors, the night's times, and the last dream summary. The dream is erased from the file after 24 hours (as long as the screen shows it), and Stop erases the night and the dream: every start does this, even while stopped, so within 15 minutes.
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

**The plan for the first test with a real Kin** is `docs/real-kin-test-script.md` (in Portuguese): reading scenes, the night, the automation with the panel closed, and provoked failures. It is generated from the code (`npm run build`), so the sentences it expects are the ones the app shows.

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

What worked: the Workshop agent fetches each file from GitHub's raw URLs (`raw.githubusercontent.com/<owner>/Clotheskin/<branch>/<path>`), so nothing is retyped or "improved" on the way. The files Kindroid runs are the ones `npm run pack` puts in `dist/clotheskin.tar.gz`: `kin.json`, `package.json`, `main.js`, `run/`, `src/core/`, `screen/` and `sample/`. `COMO-INSTALAR.md` (in Portuguese) has the message for the agent.

Then, in Kindroid: Apps → **Waiting for you** → Allow. It reads your Kin's chat, so it always waits for you. To have it follow a Kin, open the app's settings → **Kins** and tick the Kin. Open the screen, pick the Kin of your roleplay, and press **Start**.

## Confirmed in Kindroid (November 2026)

1. **Saving.** `kin files put <path>` takes the body on stdin (as Kin Bank and Planner do); a missing file is `kin: 404 …` on stderr.
2. **`kin ask`** prints the Kin's answer on stdout, and the questions do not show up in the Kin's chat.
3. **The grants** `kin:read` and `chat:read:2`, the **schedule trigger** every 15 minutes, and the one **action** are accepted. A start with nothing due ends with "Nothing to do yet: next update around 3:27 AM." in the Workshop log.
4. **The screen** loads in the panel and reads and writes its files.
5. **The Kin's answers.** A roleplay model sometimes answers the first readings in character, in the chat's language. So every question is framed as an out-of-character directive (`[DIRECTIVE — OUT OF CHARACTER …]` … `[END DIRECTIVE]`), and an answer that cannot be read is asked once more in the same run with a short correction.
6. **What the chat leaves out.** When the recent chat says nothing about the outfit (or the place, the hair…), the card keeps the last known sentence, marked "seen 2:40 AM", instead of "No outfit described".
7. **The App Library review** asked for two things, both done: the Kin is told its dream only if the person turns it on (off by default, on the screen's **Dreams** card), and the dream is erased from `status.json` after a day or after Stop, as the screen says.

8. **Telling the Kin its look** (off by default, on the screen's **Current look** card): after a reading, the run tells the Kin its outfit, hair and makeup with `kin tell --key look-outfit|look-hair|look-makeup --ttl 12`, so it stays consistent in the roleplay. Only what the Kin said just now (never a sentence kept from an earlier reading), only when it changed, and again before the 12 hours run out. A refused or failed note waits an hour and is shown on the card. `status.json` keeps only a fingerprint and the time of what was told. Scenarios: `tests/look.test.js`.

Still to watch: whether `kin tell` needs a grant of its own, and whether a note under the same `--key` replaces the last one; the night and the dream with a real Kin over a whole night, and several Kins in one account.

## Limits

- **What it reads.** Location, pose and action, clothing and accessories, hair and makeup (the last two shown only when the Kin describes them).
- **English answers.** The chat may be in any language the Kin understands (the demo scene is Portuguese); the question asks for English, and keys or values that come back in Portuguese are still read.
- **Reading a roleplay model's answer.** A long-memory model (Kindroid's Polaris) often wraps the JSON in narration, echoes the example first, writes "almost JSON" (Python quotes, bare keys, comments), groups slots under "outfit", translates keys, or writes values in the first person ("I'm in the kitchen"). All of that is read (`src/core/json.js`, `outfit.js`; tests in `polaris-what-if.test.js` and `what-if.test.js`, with fuzzing). An answer that copies the format example is rejected.
- **One Kin at a time.** Only the selected Kin is read; the others cost nothing.
