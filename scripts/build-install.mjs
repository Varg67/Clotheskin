// The one way to install Clotheskin in Kindroid: the Workshop agent opens each file from GitHub's raw address, pinned
// to a commit, step by step in the same Workshop chat (the way that worked, Nov 2026). This script knows which files
// the app needs (it follows the imports, so a new module is never forgotten) and writes:
//   node scripts/build-install.mjs           COMO-INSTALAR.md, with <commit> to fill in (also: npm run build)
//   node scripts/build-install.mjs --check   fails if COMO-INSTALAR.md is not what this gives (npm run build:check)
//   node scripts/build-install.mjs --prompt [<commit>]   the messages ready to paste, for a pushed commit (default:
//                                            HEAD), with the expected answers and each file's size and SHA-256
//                                            (npm run install-prompt)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, writeOrCheck } from './lib/generated.mjs';
import { SCREEN_END } from './build-screen.mjs';
import { APP_VERSION } from '../src/core/constants.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'Varg67/Clotheskin';
const posix = (p) => p.split(sep).join('/');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** main.js and every file it imports, relative imports followed (what the run needs). */
function runFiles() {
  const seen = new Set();
  const walk = (rel) => {
    const f = posix(normalize(rel));
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of read(f).matchAll(/^import [^;]*? from '(\.[^']+)';$/gm)) walk(join(dirname(f), m[1]));
  };
  walk('main.js');
  return [...seen];
}

/** screen/index.html and the files it loads (the screen is one generated script, screen/app.js). */
function screenFiles() {
  const refs = [...read('screen/index.html').matchAll(/(?:href|src)="([^":]+)"/g)].map((m) => posix(join('screen', m[1])));
  return ['screen/index.html', ...refs];
}

/** Every file Kindroid gets, in a fixed order: the manifest, the run, the screen, the App Library card's sample. */
export function installFiles() {
  const sample = execFileSync('git', ['ls-files', 'sample'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  return ['kin.json', 'package.json', ...runFiles().sort((a, b) => a.localeCompare(b)), ...screenFiles().sort((a, b) => a.localeCompare(b)), ...sample];
}

const raw = (commit, path) => `https://raw.githubusercontent.com/${REPO}/${commit}/${path}`;

/** The messages for the agent, in order, and what each should answer. */
function steps(commit, files) {
  const run = files.filter((f) => f === 'main.js' || f.startsWith('run/') || f.startsWith('src/'));
  return [
    { title: 'Conferir que ele lê o manifesto (sem dar a resposta no prompt)',
      message: `Open this raw GitHub file: ${raw(commit, 'kin.json')}. What are the exact values of run.timeout and triggers[0].cron? Only inspect the file for now.`,
      answer: '`2m` e `*/15 * * * *` (e o run entry `node main.js`). Outra resposta: ele está lendo outra coisa, talvez uma cópia antiga que já está no Workshop.' },
    { title: 'Seguir o motor pelos imports',
      message: 'Starting from the same raw GitHub revision, open main.js and follow its local imports. Which file and function handle a manual status update? List the files you successfully opened.',
      answer: `a função \`onAction\` em \`run/program.js\`, e os ${run.length} arquivos: ${run.map((f) => `\`${f}\``).join(', ')}.` },
    { title: 'Seguir a tela',
      message: 'Open screen/index.html from the same revision and follow its local scripts, stylesheets, and assets. Trace the Update status button. Which file handles the click, and what action and payload does it send to Kindroid?',
      answer: '`screen/app.js`; a ação `update_status` com `{ kin: <id do Kin>, op: "read" }`.' },
    { title: 'Copiar para o projeto do Workshop',
      message: `Copy the existing Clotheskin app from the verified raw GitHub revision into the current Workshop project. Copy exactly these ${files.length} files, each from ${raw(commit, '<path>')}, saved at the same path, exactly as downloaded: do not rewrite, shorten or "improve" anything. Keep kin.json at the project root.\n\n${files.join('\n')}\n\nApply the files now. If a file fails to copy, report its path and the exact error.`,
      answer: 'que copiou os arquivos, ou o caminho e o erro exato de cada um que falhou.' },
    { title: 'Conferir a cópia, relendo do projeto do Workshop (não do GitHub)',
      message: 'Now reopen these files from the Workshop project, not from GitHub, and report: the run entry, screen entry and schedule in kin.json; the value of APP_VERSION in src/core/constants.js; and the exact last line of screen/app.js. Then open the screen in Workshop preview.',
      answer: `\`node main.js\`, \`screen/index.html\`, \`*/15 * * * *\`; \`APP_VERSION\` = \`${APP_VERSION}\`; última linha \`${SCREEN_END}\`. Outra última linha: o \`screen/app.js\` foi cortado na cópia (repita o passo 4 só com ele).` },
  ];
}

function renderGuide() {
  const files = installFiles();
  const s = steps('<commit>', files);
  return `# Clotheskin: como instalar e atualizar no Kindroid

Este arquivo é gerado por \`npm run build\` (\`scripts/build-install.mjs\`): não edite à mão. Versão do app: **${APP_VERSION}**.

## O jeito que funciona

O agente do Workshop abre cada arquivo pelo endereço *raw* do GitHub, **um por vez**, no mesmo chat do Workshop, em etapas. A pasta local não fica acessível ao agente, e baixar o repositório inteiro dá 403.

O endereço aponta para um **commit**, não para um branch: assim o agente pega o motor, a tela e o manifesto da mesma versão, sem cache velho do GitHub.

- **Mensagens prontas, com o commit preenchido:** depois do push, rode \`npm run install-prompt\` (ou peça ao Claude para rodar). Ele imprime as mensagens abaixo com o commit, as respostas esperadas e o tamanho e o SHA-256 de cada arquivo.
- **À mão:** troque \`<commit>\` pelo hash completo do commit em cada mensagem.

## Os ${files.length} arquivos que o Kindroid usa

\`\`\`
${files.join('\n')}
\`\`\`

O resto do repositório (\`tests/\`, \`dev/\`, \`scripts/\`, \`docs/\`, \`tools/\`, \`prints/\`) é só para desenvolver e testar: o Kindroid não precisa. **Para atualizar, mande sempre os ${files.length} juntos**: eles dependem uns dos outros, e uma mistura de arquivos novos e velhos pode quebrar o app.

## As mensagens para o agente, em ordem

${s.map((step, i) => `### ${i + 1}. ${step.title}

\`\`\`
${step.message}
\`\`\`

**Resposta certa:** ${step.answer}`).join('\n\n')}

### 6. Testar dentro do Kindroid

1. Apps → **Waiting for you** → **Allow** (o app lê o chat, por isso espera a sua permissão).
2. Configurações do app → **Kins** → marque os Kins.
3. Abra a tela, escolha o Kin do roleplay e aperte **Update status**. Em **Settings**, no fim, aparece "Clotheskin ${APP_VERSION}". Se só uma parte foi atualizada, a tela mostra um aviso amarelo no topo: *"Some of Clotheskin's files are from another update… Update all the files together."*
4. A automação merece um teste próprio: aperte **Start** e deixe chegar uma leitura programada, sem apertar o botão.

## O log do Workshop

O log mostra cada pergunta ao Kin e a resposta dele. O que é normal:

| No log | Significa |
| --- | --- |
| \`Asked your Kin: [DIRECTIVE — OUT OF CHARACTER …\` | a pergunta da leitura |
| \`Your Kin said: {"location":…}\` | uma resposta certa |
| \`[DIRECTIVE — OUT OF CHARACTER] Your previous reply … could not be used\` | a primeira resposta veio em roleplay, e o app perguntou de novo |
| \`Nothing to do yet: next update around 3:27 AM.\` | o início a cada 15 minutos, sem nada para fazer (não pergunta nada ao Kin) |
| \`Automatic update is stopped.\` | o Stop está ligado |

Se a pergunta no log começar com \`You are …\` em vez de \`[DIRECTIVE …\`, o Kindroid ainda está com uma versão antiga.
`;
}

/** The messages with the commit filled in, the expected answers, and each file's size and SHA-256. */
function renderPrompt(commit) {
  const files = installFiles();
  const sizes = files.map((f) => {
    const text = read(f);
    return `| \`${f}\` | ${text.split('\n').length - (text.endsWith('\n') ? 1 : 0)} | ${[...text].length} | \`${createHash('sha256').update(text).digest('hex').slice(0, 16)}\` |`;
  });
  return `Clotheskin ${APP_VERSION}, commit ${commit}: send each message in the same Workshop chat, in order, and compare the answer.

${steps(commit, files).map((s, i) => `===== ${i + 1}. ${s.title}\n\n${s.message}\n\n--> Resposta certa: ${s.answer}`).join('\n\n')}

===== Se o agente puder contar ou calcular: cada arquivo

| Arquivo | Linhas | Caracteres | SHA-256 (início) |
| --- | --- | --- | --- |
${sizes.join('\n')}
`;
}

/** The full hash of `ref`, refused unless GitHub has it (the agent reads GitHub, not this machine). */
function pushedCommit(ref) {
  const commit = execFileSync('git', ['rev-parse', ref], { cwd: ROOT, encoding: 'utf8' }).trim();
  const remote = execFileSync('git', ['branch', '-r', '--contains', commit], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!remote) throw new Error(`${commit} is not on GitHub yet: push it first (the agent reads the files from GitHub)`);
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...installFiles()], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty && ref === 'HEAD') throw new Error(`some of the app's files have changes not committed:\n${dirty}`);
  return commit;
}

if (isMainModule(import.meta.url)) {
  const at = process.argv.indexOf('--prompt');
  if (at === -1) writeOrCheck('COMO-INSTALAR.md', renderGuide());
  else process.stdout.write(renderPrompt(pushedCommit(process.argv[at + 1] || 'HEAD')));
}
