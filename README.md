# Clotheskin

A small tracker for Kindroid companions. It asks a Kin where it is, how it is positioned, what it is doing and what it is wearing, reads the answer, puts the pieces in order, adds the commas and shows **three natural sentences**:

> **Location** In the living room.
> **Pose and action** Sitting on the sofa, drinking coffee.
> **Outfit** Wearing a leather jacket, a perfumed white shirt and blue jeans, with glasses.

Both come from one question, so one `kin ask` per reading. Nothing about the outfit, the place, the pose or the action is saved. Each reading stands on its own. (An earlier version kept a full wardrobe with item identity, layers, editors and six saved fields. It is in the git history at commit `17473e5`.)

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

1. **Ask.** The Kin gets one short question (`screen/src/core/prompt.js`): say where you are, how you are positioned, what you are doing and what you are wearing, as of your last message, in English only, concisely, as one-line JSON. `location` is a short phrase starting with in, at or on (`in the kitchen`, `at the hospital`, `on the bus to college`): the place only, not posture; travelling is a place (`on the way to the hospital`), a plan to go somewhere is not. `pose` is the body position (`sitting on the sofa`, `standing by the window`; it may name the furniture, while `location` is the room or place) and `action` is what it is doing right now as a short -ing phrase (`drinking coffee`): not plans, not things already finished, not feelings. The other keys are slots (`headwear`, `topwear`, `bottomwear`, `footwear`, `footunderwear`, `topunderwear`, `bottomunderwear`, the twelve `*-accessory` slots and `bags`); values are lists of pieces, innermost layer first. The prompt is about 1,900 characters; `kin ask` allows 8,000.
2. **Read.** `parseReading` (`screen/src/core/outfit.js`) parses the answer. Common slips are handled: JSON inside a code fence or narration, trailing commas, curly quotes, a single string instead of a list, slot words like `top` or `shoes`, `clothing`/`accessories` instead of slots, placeholders such as `unknown` or `n/a`. A wrong value type or text that is not JSON is an error, and nothing is guessed.
3. **Show.** `describeOutfit`, `describeLocation` and `describeDoing` are the whole logic. The pose and action are one sentence, pose first, then the action after a comma (`Sitting on the sofa, drinking coffee.`); an action already written inside the pose is not repeated. For the action the Kin's slips are repaired (`I am reading a book` → `Reading a book.`) and plans, the past, future time words (`later`, `tomorrow`), feelings and `nothing` mean no action (`going to the store` is movement and stays). A pose that is really a place (`in the kitchen`) becomes the location when there is none, `position`/`posture`/`stance` and `activity`/`doing` are accepted as key names, and an object or number is an error. The location: The location is capitalised and given a full stop (the Kin is asked for the place only, so common slips are repaired: markdown or quotes around it, a posture or activity in front (`sitting on the sofa in the living room` → `On the sofa in the living room.`), a clause after it (`, cooking dinner`, `while reading`, `wearing a robe`), a list instead of a text, the keys `place`/`where`/`current_location`; a posture with no place, `somewhere`, `nowhere`, `unknown` and similar mean nothing was said; an object or number is an error. A bare noun phrase gets "in" only after an article or for a proper name (`Alfenas` → `In Alfenas.`), `home` gets "at", any other bare word and anything in Portuguese is shown as written). The outfit: branches in order (head, top, bottom, feet, then accessories and bags), the outermost piece first inside a branch, commas and "and". Underwear is only mentioned when there is nothing else to say about clothing. A missing key shows "No location described in the recent chat." or "No outfit described in the recent chat."

The text the Kin reads is the `OUTFIT_PROMPT` constant; change it there. Its example is deliberately not the brief's scenario and the prompt says to never copy it, so a Kin that does copy values is easy to spot. `tests/location-ambiguity.test.js` and `tests/pose-action-ambiguity.test.js` feed plausible wrong answers through the pipeline.

## Two modes

- **Local** (`npm start`): paste a conversation, press **Update status** (or **Prepare prompt**), copy the prompt into any model, paste its JSON, press **Show status**. Demo scenes (including the Portuguese chat from the brief) run in one click. The pasted chat is kept in memory only.
- **Kindroid Workshop**: the app is a Workshop program (`kin.json`, `screen/`, `main.js`). The screen is shown in a ~390 pt locked frame. Kins are the ones attached to the app (id and name come from the host). **Update status** runs the action `read_outfit`: the run asks the Kin with `kin ask --kin <id>` and ends with `kin end '{"location":"…","doing":"…","outfit":"…"}'` (the three sentences, kept within the 500 characters `kin end` allows by shortening only the outfit), which the screen shows. Because the key cannot read chat, the grant `chat:read:1` lets the Kin itself see its recent chat, so the prompt carries no messages.

Only small preferences are stored (theme, selected Kin, local character name): in `localStorage` locally, in the program's own folder through `files.read`/`files.write` in the Workshop. No outfit, no place and no chat is ever stored.

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
5. `files.write` accepts a string body and `files.read` returns a string (only the settings use them).
6. The `kin ask` exchange does not leak into the Kin's normal chat or memory.

First real test:

```bash
curl -fsSO https://downloads.kinusercontent.com/workshop/kin.mjs
export KIN_TOKEN=kk_...  KIN_PROGRAM=clotheskin
git add -A && git commit -m "Clotheskin"
node kin.mjs send .
```

A step-by-step script for that first run, with the sentences the card should show for each line you say to the Kin, is in `docs/real-kin-test-script.md` (generated by `node scripts/build-test-script.mjs`; a test fails if it is stale).

Then, in Kindroid: Apps → **Waiting for you** → Allow (it reads the chat, so it always waits), open the app's settings → **Kins** and tick a Kin, open the screen, select the Kin and press **Update status**. Regenerate `kin.json` with `npm run build:manifest` after changing it (a test fails if it is stale).

## Limits

- Only location, pose and action, clothing and accessories. Hair and makeup were part of the earlier version and are not read now.
- The reference image **Painel de estado da Isa.png** was never attached; the look follows the Kindroid UI screenshots.
- English only, by design. The chat may be in any language the Kin understands; the answer and the sentence are English.
