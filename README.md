# Clotheskin

Visual continuity panel for Kindroid companions. It tracks **location, posture, clothing, accessories, hair and makeup** for the selected companion, shows them in a collapsible card, and lets you correct any detail without rewriting a character sheet.

Isa is a selectable **demo** example. Any other companion you create starts with everything *Unknown*.

## Open it

Requires Node 20+. No dependencies.

```bash
npm start
```

Open <http://localhost:5173> in a desktop browser window (designed for about 1280×800 and wider).

## Test it

```bash
npm test            # unit + scene tests (Node's built-in runner)
npm run test:e2e    # browser test in a pt-BR browser at 1280×800
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
| Canonical slots and ids | `src/core/constants.js` |
| Operation contract (single source for prompt, validator, tests) | `src/core/contract.js` |
| Editable extraction prompt | `src/core/prompt.js` (also editable in the UI) |
| Validator (structural; any error rejects the whole answer) | `src/core/validate.js` |
| Transactional apply, item identity, manual-edit merge | `src/core/apply.js` |
| Read coordinator (races, dedupe, per-profile binding) | `src/core/reader.js` |
| Storage (localStorage adapter, per profile and conversation) | `src/core/store.js` |
| UI | `src/ui/` |
| Theme tokens (the only place colours, radii and shadows live) | `theme.css` |
| Demo profile and scenes | `src/demo/demo.js` |

Design decisions worth knowing:

- Collections use `null` = unknown, `[]` = confirmed empty, `[ids]` = worn, innermost first. Items have stable ids and keep condition and place (worn, held, pocket, bag, left in the scene) after being taken off. Contents point at their container, so a phone follows its bag.
- A one-piece garment (dress) is one item listed in several slots through `covers`. No extra slot identifier was invented.
- Structural errors reject the answer and keep saved data. A single operation that cannot apply (unknown item, pocketless garment) is skipped and reported; ambiguous references go to **Needs review** while independent changes still apply.
- Every reading is bound to the profile and conversation it started from. Manual edits made after a reading started are never overwritten by its answer. Only the newest reading of a scope may commit.
- Missing keys in the answer count as empty (lenient); wrong types are errors.
- Demo answers carry `meta.demo: true` and are refused for non-demo profiles. `meta.target_id`, if present, must match the selected companion.
- All Clotheskin text, dates and relative times are English regardless of browser language. Pasted conversation text is never altered.

## Look and feel

The Workshop is desktop-only for now, so the layout targets desktop proportions: the status card keeps its own 440 px width on the left (so it can later be embedded elsewhere, such as a status bar) and the workspace (scene reader, demo scenes, prompt, history) fills the right. Below 900 px it simply stacks; phone layouts are not a supported target yet.

The theme follows the Kindroid UI v2 login screen: warm off-white (`#f5f0eb`), translucent glass surfaces with white borders and coral-tinted shadows, pill-shaped controls, coral accent (`#c7503c`). Values were sampled from a screenshot, not from an official palette. `tests/theme.test.js` checks WCAG AA contrast for the token pairs. To retheme (for example a dark variant), override the variables in `theme.css`; `styles.css` uses no raw colours.

## Pending verification in the Kindroid Workshop

The Workshop guide (`https://downloads.kinusercontent.com/workshop/GUIDE.md`) could **not** be reached from the build environment (network policy returned 403), and no validated app package was available. Nothing about the host was guessed. Still to confirm, with the guide in hand:

1. How the host selects a Kin and exposes its **stable id** and avatar.
2. How to read **conversation messages** (with ids and speaker names) and a conversation id.
3. How to request a **structured response** from the Kin or a model, and any permissions it needs.
4. An event for **“Kin reply complete”**, to enable automatic updates.
5. Persistent **storage** and the app package entry/format.

Where to plug in: implement the host adapter described in `src/host/local.js` (`capabilities`, `storage`), feed messages to `ReadCoordinator.onKinResponseComplete(...)`, and replace `ManualProvider` with a provider whose `extract({ prompt })` returns the JSON text. The auto-update toggle is disabled until `capabilities.autoUpdate` is true.

First real test in the Workshop: load the app, select a real Kin, confirm its id and name appear, run one reading on a short exchange, confirm the JSON validates, then restart and confirm the saved state loads.

## Limits of this first version

- The reference image **Painel de estado da Isa.png** was not attached, so the layout follows the written description. Demo pictures are my own simple SVGs.
- Only a light theme exists, because only a light Kindroid v2 reference was available.
- No inventory screen: pockets and contents are read-only details inside an item.
- Not exercised in a real Kindroid session.
