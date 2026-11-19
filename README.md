# Clotheskin

Visual continuity panel for Kindroid companions. It tracks **location, posture, clothing, accessories, hair and makeup** for the selected companion, shows them in a collapsible card, and lets you correct any detail without rewriting a character sheet.

Isa is a selectable **demo** example. Any other companion you create starts with everything *Unknown*.

## Open it

Requires Node 20+. No dependencies.

```bash
npm start
```

Open <http://localhost:5173> in a desktop browser window (this is the local mode; it serves the `screen/` folder). The Workshop gives the app roughly 950×690 px when the Kindroid sidebar is open, so that is the design target; wider windows just get more room.

## Test it

```bash
npm test            # unit + scene tests (Node's built-in runner)
npm run test:e2e    # browser tests: local mode at 960×690, and Workshop mode in a 390 px frame against a fake Workshop
```

The browser test needs Playwright and Chromium. If they are not already installed: `npm i --no-save playwright && npx playwright install chromium`. Screenshots go to `tests/e2e/shots/`.

## Try the flow

1. Open the page: Isa (demo) is selected, with the card expanded.
2. Open **Scene reader (local mode)** → choose a demo scene → **Run demo scene**. Try them in order: wet lab coat → cardigan → glasses pocket → phone in bag → makeup → leaving → arrived. Run the cardigan scene twice (also the Portuguese one): there is still one cardigan.
3. Your own scene: paste `Name: message` lines into **Conversation** → **Update status** (or **Prepare prompt**) → **Copy prompt** → paste it into any model → paste the JSON answer → **Apply response**.
4. Tap any row (or the location picture) to edit it. **Save** commits, **Cancel** discards.
5. **Switch companion** (top right) to create profiles with their own ID. Two companions with the same name stay independent, also after renaming.

## How it works

| Piece | File |
|---|---|
| Canonical slots and ids | `screen/src/core/constants.js` |
| Operation contract (single source for prompt, validator, tests) | `screen/src/core/contract.js` |
| Editable extraction prompt | `screen/src/core/prompt.js` (also editable in the UI) |
| Validator (structural; any error rejects the whole answer) | `screen/src/core/validate.js` |
| Transactional apply, item identity, manual-edit merge | `screen/src/core/apply.js` |
| Read coordinator (races, dedupe, per-profile binding) | `screen/src/core/reader.js` |
| Storage (localStorage adapter, per profile and conversation) | `screen/src/core/store.js` |
| UI | `screen/src/ui/` |
| Workshop screen host (postMessage protocol, files) | `screen/src/host/` |
| Workshop run: actions, `kin` CLI adapters | `main.js`, `run/` |
| Workshop manifest (generated from the contract) | `kin.json`, `scripts/build-manifest.mjs` |
| Theme tokens (the only place colours, radii and shadows live) | `screen/theme.css` |
| Demo profile and scenes | `screen/src/demo/demo.js` |

Design decisions worth knowing:

- Collections use `null` = unknown, `[]` = confirmed empty, `[ids]` = worn, innermost first. Items have stable ids and keep condition and place (worn, held, pocket, bag, left in the scene) after being taken off. Contents point at their container, so a phone follows its bag.
- A one-piece garment (dress) is one item listed in several slots through `covers`. No extra slot identifier was invented.
- Structural errors reject the answer and keep saved data. A single operation that cannot apply (unknown item, pocketless garment) is skipped and reported; ambiguous references go to **Needs review** while independent changes still apply.
- Every reading is bound to the profile and conversation it started from. Manual edits made after a reading started are never overwritten by its answer. Only the newest reading of a scope may commit.
- Missing keys in the answer count as empty (lenient); wrong types are errors.
- Demo answers carry `meta.demo: true` and are refused for non-demo profiles. `meta.target_id`, if present, must match the selected companion.
- All Clotheskin text, dates and relative times are English regardless of browser language. Pasted conversation text is never altered.

## Look and feel

The Workshop is desktop-only for now, so the layout targets desktop proportions: the status card keeps its own 440 px width on the left (so it can later be embedded elsewhere, such as the Status Bar) and the workspace (scene reader, demo scenes, prompt, history) fills the right. Below 860 px it simply stacks; phone layouts are not a supported target yet. The visible app title is hidden (the Workshop sidebar already names the app) but kept for screen readers.

Kindroid lets users customise their theme, so the palette is selectable under **Appearance** in the workspace:

- **Kindroid warm (default):** sampled from the Kindroid UI v2 login screen: warm off-white `#f5f0eb`, translucent glass surfaces, coral accent `#c7503c`, pill-shaped controls.
- **Sage green:** sampled from a customised Kindroid desktop window: page `#f4f6f5`, glow `#cfeae0`, text `#283e36`, glass `#f9faf9`. The accent (`#2c7a60`) is **inferred** from the same hue because the screenshot had no primary button. Send a screenshot with one if you want it exact.
- **Match my Kindroid theme:** listed but disabled. It needs the Workshop to expose the host's theme colours, which is unverified.

All colours, radii and shadows live in `screen/theme.css`; `styles.css` uses no raw colours. A new theme is one `:root[data-theme="…"]` block. `tests/theme.test.js` checks WCAG AA contrast for every theme.

## Kindroid Workshop integration

Built from the Workshop guide (`GUIDE.md`). The app is a Workshop *program*: `kin.json` + a screen + a run.

**How it fits together**

- **Screen** (`screen/`, shown in a ~390 pt locked frame): only the status card plus a settings section. It cannot use storage or the network, so state is kept in the program's own folder through the `files.read`/`files.write` messages. Companions are the Kins attached to the app (`{ kin: "kins" }`), with the host's id and name. If the page is not inside a Workshop frame, local mode starts instead.
- **Run** (`node main.js`): handles three actions and always ends with `kin end`.
  - `read_scene` (the **Update status** button): asks the Kin with `kin ask --kin <id>`. The app cannot read the chat; with the `chat:read:1` grant the Kin itself sees its recent chat, so the prompt has no pasted messages. The answer goes through the same validator and transactional apply as everything else.
  - `update_scene` (called by the **Kin**): the action input *is* the extraction contract (JSON Schema generated from `contract.js`). This is the automatic path: there is no "reply complete" trigger in the Workshop, so the Kin reports changes when they happen. The screen notices the new state every 10 s and when it regains focus.
  - `scene_status` (called by the Kin): its `kin end` line (at most 500 characters) is given back to the Kin, so it can check what it is wearing before describing it. This is the safest form of the "reinject the summary" idea; nothing is pushed into the chat on its own, and `kin tell` is deliberately not used.
- **Prompt size:** `kin ask` takes at most 8,000 characters. The Workshop prompt (`buildHostChatPrompt`) uses a compact contract, omits unknown slots and trims the not-worn list until it fits; a typical prompt is about 3,000 characters.
- **Persistence and races:** the screen and the run share one record file per Kin (`cs/…json`). A reading remembers the revision it started from; manual edits saved while the Kin is thinking are never overwritten, because the run re-reads the file before applying.
- Identity: two Kins with the same name are different ids. Conversation ids are not available in the Workshop, so state is per Kin.

**Verified here:** the screen against a fake Workshop page that speaks the guide's `postMessage` protocol, with the real run code behind it (`tests/e2e/workshop.cjs`), plus unit tests for the run, the channel and the manifest. **Not verified:** anything against the real Workshop, because `kin.mjs` and the Workshop could not be reached from the build environment.

**Assumptions to confirm on the first real run** (each is isolated so a fix is local):

1. `kin ask` prints the Kin's answer on stdout, and the Kin answers with JSON instead of in character (the prompt asks for it; the parser also accepts fenced or surrounded JSON). `run/kin-cli.js`
2. `kin files get <path>` prints the file, `put <path>` reads stdin, `ls` lists paths, and `get` fails for a missing file. `run/kin-cli.js`
3. The grant is spelled `chat:read:1` (the guide names it next to `kin ask` but not in the grants list). `scripts/build-manifest.mjs`
4. The locked frame loads ES modules from the screen folder (`<script type="module">` with relative imports) and allows `<dialog>.showModal()`. If not, the screen needs a one-file bundle.
5. Action input accepts the generated JSON Schema (nested objects, enums, `["string","null"]`). If not, loosen `contractJsonSchema()`; the real validation is ours.
6. `files.write` accepts a string body and `files.read` returns a string.
7. The `kin end` line of `update_scene` shows in the chat each time it is used; if that is noisy, make the line shorter or the description rarer.

**First real test**

```bash
curl -fsSO https://downloads.kinusercontent.com/workshop/kin.mjs
export KIN_TOKEN=kk_...  KIN_PROGRAM=clotheskin
git add -A && git commit -m "Clotheskin"
node kin.mjs send .
```

Then, in Kindroid: Apps → **Waiting for you** → Allow (it reads the chat, so it always waits). Open the app's settings → **Kins** and tick a Kin. Open the screen, select the Kin, press **Update status**, and check the banner and the card. Regenerate `kin.json` after changing the contract with `npm run build:manifest` (a test fails if it is stale).

## Limits of this first version

- The reference image **Painel de estado da Isa.png** was not attached, so the layout follows the written description. Demo pictures are my own simple SVGs.
- Only light themes exist; no dark Kindroid reference was available.
- No inventory screen: pockets and contents are read-only details inside an item.
- Not exercised in a real Kindroid session.
- In the Workshop there is no demo profile, no manual paste flow and no prompt editor; those are local-mode tools.
