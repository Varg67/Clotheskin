// Builds kindroid-agent-pack/: the app as text messages for Kindroid's in-app agent, for when the code is pasted
// instead of sent with `kin send` (which uploads the exact files and is the safer path).
//   node scripts/build-agent-pack.mjs
// Only the files the app needs inside Kindroid are included (what main.js imports, the screen, the manifest, sample/).
// Each file has its line count, character count and SHA-256, so a copy changed by the agent can be found.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'kindroid-agent-pack');
const PART_LIMIT = 40000; // characters per message (a file larger than this gets a message of its own)
const FENCE = '~~~~~~';

/** main.js and everything it imports (relative imports only). */
function runFiles() {
  const seen = new Set();
  const walk = (rel) => {
    const f = normalize(rel);
    if (seen.has(f)) return;
    seen.add(f);
    const text = readFileSync(join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/from '(\.[^']+)'/g)) walk(join(dirname(f), m[1]));
  };
  walk('main.js');
  return [...seen];
}

const FILES = ['kin.json', 'package.json', 'package-lock.json', ...runFiles(),
  'screen/index.html', 'screen/styles.css', 'screen/theme.css', 'screen/assets/icon.svg', 'screen/app.js',
  'sample/settings.json', 'sample/status.json'];

const info = FILES.map((path) => {
  const text = readFileSync(join(ROOT, path), 'utf8');
  if (text.includes(FENCE)) throw new Error(`${path} contains the fence ${FENCE}`);
  return { path, text, lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), chars: [...text].length, sha: createHash('sha256').update(text).digest('hex') };
});

// Parts: whole files, in order, up to PART_LIMIT characters each.
const parts = [];
for (const f of info) {
  const last = parts[parts.length - 1];
  if (last && last.size + f.chars <= PART_LIMIT) { last.files.push(f); last.size += f.chars; } else parts.push({ files: [f], size: f.chars });
}
const total = parts.length + 1;

const table = info.map((f) => `| \`${f.path}\` | ${f.lines} | ${f.chars} | \`${f.sha.slice(0, 16)}\` |`).join('\n');

const instructions = `Please create a Kindroid program named "clotheskin" from the files I will send you in the next ${parts.length} messages.

Rules (important):
1. Create every file at exactly the path given, with exactly the content given: no changes, no reformatting, no "improvements", no shortening, no comments added or removed. The code depends on exact characters: keep curly quotes (“ ” ‘ ’), "…", accented letters and every backslash as they are.
2. Each file is between a line "${FENCE} path/to/file" and a line "${FENCE}". Those two lines are not part of the file.
3. kin.json is the manifest: use it as it is (a schedule trigger every 15 minutes, one action "update_status", grants kin:read and chat:read:2). The run entry is "node main.js"; the screen is screen/index.html.
4. There are no packages to install (package.json has no dependencies; package-lock.json is included so nothing fails).
5. Wait until you have all ${parts.length} messages before building. After the last one, list every file with its line count and character count${''} (and its SHA-256 if you can compute it), so I can compare them with this table:

| File | Lines | Characters | SHA-256 (start) |
|---|---|---|---|
${table}
`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `mensagem-01-de-${String(total).padStart(2, '0')}-instrucoes.txt`), instructions);
parts.forEach((p, i) => {
  const n = i + 2;
  const body = [`Part ${i + 1} of ${parts.length} of the Clotheskin files. Do not build yet${i + 1 === parts.length ? ': this is the last part, you can build now and then list the files as asked' : ''}.`, '']
    .concat(p.files.map((f) => `${FENCE} ${f.path}\n${f.text}${f.text.endsWith('\n') ? '' : '\n'}${FENCE}\n`)).join('\n');
  writeFileSync(join(OUT, `mensagem-${String(n).padStart(2, '0')}-de-${String(total).padStart(2, '0')}.txt`), body);
});

writeFileSync(join(OUT, 'LEIA-ME.md'), `# Clotheskin para o agente do Kindroid Workshop

Gerado por \`node scripts/build-agent-pack.mjs\` a partir do código atual. Gere de novo sempre que o código mudar.

**Caminho mais seguro:** \`node kin.mjs send .\` (README, "Send it to Kindroid"): ele envia os arquivos exatos, sem ninguém copiar texto. Use este pacote só se for colar o código no agente.

## Como usar

1. Mande ao agente, **na ordem**, o conteúdo de cada arquivo \`mensagem-NN-de-${String(total).padStart(2, '0')}…\` (${total} mensagens). Copie o arquivo inteiro, do começo ao fim.
2. A mensagem 1 explica as regras. As outras levam os ${info.length} arquivos do app (${info.reduce((a, f) => a + f.chars, 0).toLocaleString('pt-BR')} caracteres). O \`screen/app.js\` é grande (${info.find((f) => f.path === 'screen/app.js').chars.toLocaleString('pt-BR')} caracteres) e vai sozinho numa mensagem; se o agente recusar uma mensagem desse tamanho, avise.
3. No fim, o agente deve listar cada arquivo com o número de linhas e de caracteres. **Compare com a tabela abaixo.** Um número diferente quer dizer que o agente mudou o arquivo: peça para refazer aquele arquivo exatamente como foi enviado.
4. Depois: em Apps, **Allow**; nas configurações do app, **Kins** → marque o Kin; abra o app e siga \`docs/real-kin-test-script.md\`.

| Arquivo | Linhas | Caracteres | SHA-256 (início) |
|---|---|---|---|
${table}
`);
console.log(`kindroid-agent-pack/: ${total} messages, ${info.length} files`);
