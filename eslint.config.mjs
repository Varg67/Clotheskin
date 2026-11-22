// Lint for development only (npm run lint). ESLint lives in tools/, never in the root package.json: Kindroid installs
// the root lockfile at every start of a run. This file imports nothing, so it needs no package to be read.
//
// Besides the usual checks it guards two rules of the project:
//  - the run's program (run/program.js) and the shared logic (src/) import nothing from Node: they also run in the
//    dev harness, in the browser;
//  - the screen (src/screen/) and the shared logic use no Node globals, and the screen no browser storage.

const TIMERS = { setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly' };
const NODE = { ...TIMERS, process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', performance: 'readonly' };
const BROWSER = { ...TIMERS, window: 'readonly', document: 'readonly', Node: 'readonly', CSS: 'readonly', URL: 'readonly', performance: 'readonly', console: 'readonly' };
const COMMONJS = { require: 'readonly', module: 'writable', __dirname: 'readonly', __filename: 'readonly' };

// Node-only globals switched off where the code also runs in the browser (globals of config blocks are merged).
const NO_NODE_GLOBALS = { process: 'off', Buffer: 'off' };
const NO_NODE_IMPORTS = ['error', { patterns: [{ group: ['node:*'], message: 'The program and the shared logic also run in the browser: no Node imports.' }] }];

const RULES = {
  // correctness
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-dupe-else-if': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-fallthrough': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-redeclare': 'error',
  'no-sparse-arrays': 'error',
  'no-unused-private-class-members': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-debugger': 'error',
  'eqeqeq': ['error', 'smart'],
  // dead code and leftovers (unused exports are checked by scripts/unused-exports.mjs)
  'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
  'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
  'no-useless-catch': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-console': 'off', // the run logs on stderr through the log it is given; scripts print on purpose
  'prefer-const': 'error',
  'no-shadow': 'error',
  // size and shape: a function that grows past these is split (refactoring plan, phase 4)
  'complexity': ['error', 12],
  'max-params': ['error', 4],
  'max-depth': ['error', 4],
  'max-lines-per-function': ['error', { max: 60, skipComments: true, skipBlankLines: true }],
  // 140 columns of code; a long sentence, template or regular expression is not split (it would read worse)
  'max-len': ['error', { code: 140, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true, ignoreUrls: true }],
};

export default [
  { ignores: ['screen/app.js', 'tools/**', 'node_modules/**', 'tests/e2e/shots/**'] },
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: NODE }, rules: RULES },
  { files: ['**/*.cjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...NODE, ...COMMONJS } }, rules: RULES },
  // shared by the run and the browser: no Node at all
  { files: ['src/core/**/*.js', 'run/program.js'], languageOptions: { globals: { ...TIMERS, ...NO_NODE_GLOBALS, console: 'off', performance: 'off' } }, rules: { 'no-restricted-imports': NO_NODE_IMPORTS } },
  // the screen, inside Kindroid's locked frame (no storage there; the build refuses it too)
  { files: ['src/screen/**/*.js'], languageOptions: { globals: { ...BROWSER, ...NO_NODE_GLOBALS } }, rules: { 'no-restricted-imports': NO_NODE_IMPORTS } },
  // the dev harness is a page of its own, outside the frame: it may keep its state in the browser
  { files: ['dev/**/*.js'], languageOptions: { globals: { ...BROWSER, localStorage: 'readonly' } } },
  // browser tests: the callbacks of page.evaluate() run in the page
  { files: ['tests/e2e/**/*.cjs'], languageOptions: { globals: { ...NODE, ...COMMONJS, window: 'readonly', document: 'readonly', localStorage: 'readonly' } } },
];
