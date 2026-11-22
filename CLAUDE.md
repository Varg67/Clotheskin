# Clotheskin: rules for any Claude session

Clotheskin is one app, a Kindroid Workshop program. There is one line of work and one way to install it. Read this
before changing anything.

## Where the truth is

- **The branch `main` is the app.** Start new work from the latest `main`, never from another `claude/...` branch:
  older branches hold earlier versions that were merged or abandoned.
- The version is `APP_VERSION` in `src/core/constants.js`, equal to `version` in `package.json` (now 0.6.0). On a
  release, bump both together; the screen warns when files from two versions are mixed.
- **The "Mini" version was abandoned** (an early idea for loading the app). Nothing in this repository belongs to it;
  do not bring it back.

## Installing in Kindroid: only one way

The Workshop agent opens each file from GitHub's raw address **pinned to a commit**, step by step in the same chat.
`COMO-INSTALAR.md` has the messages; `npm run install-prompt` prints them with the pushed commit filled in, plus each
file's size and SHA-256. The file list (24 files today) is computed from the imports. Always send all of them
together. No tarballs, no packs, no other install script.

## Before delivering

```bash
npm run tools        # once per machine: ESLint and TypeScript, in tools/ (never in the root)
npm run build        # regenerates the generated files
npm run check        # lint, unused exports, types, tests with coverage, performance, generated files up to date
npm run test:e2e     # the screen in Chromium
```

## Invariants

- **Generated files are never edited by hand:** `screen/app.js`, `kin.json`, `COMO-INSTALAR.md`,
  `docs/real-kin-test-script.md`. Change their source in `src/`, `scripts/` and run `npm run build`.
- No runtime dependencies in the root `package.json`. Dev tools live in `tools/`.
- `run/program.js` and `src/core/` never import from Node; `src/screen/` only through the bundler's rules
  (named imports and exports, Safari 14.1).
- One writer per file: the screen writes `settings.json`, the run writes `status.json`.
- Language: code, comments and `README.md` in English; documents for the user (`COMO-INSTALAR.md`, `docs/`) in
  Portuguese; prompts to the Kin and to the Workshop agent in English.
- `docs/plano-de-refatoracao.md` is the history of the refactoring and its decisions; add to it, do not start another.
