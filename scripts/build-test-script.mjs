// Generates docs/real-kin-test-script.md, the plan for the first test with a real Kin (in Portuguese, for the person
// running it). `node scripts/build-test-script.mjs` writes it; `--check` compares (a test runs it).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, expected, STEPS, SHORTEST_INTERVAL } from './real-kin-scenarios.mjs';
import { CHAT_DAYS } from './build-manifest.mjs';

export function renderScript() {
  const out = [];
  out.push(`# Roteiro do primeiro teste com um Kin de verdade

Este arquivo é gerado por \`node scripts/build-test-script.mjs\`. As frases "O cartão deve mostrar" são calculadas pelo código do app a partir da resposta que um Kin bem-comportado daria, então acompanham o app.

## Antes de começar

1. **Ensaio sem tocar em nada real** (opcional, 1 minuto): \`curl -fsSO https://downloads.kinusercontent.com/workshop/kin.mjs\` e \`npm run try\`. Isso roda a execução de verdade com o \`kin\` oficial em modo simulação (\`KIN_MOCK\`) e lista cada chamada.
2. Envie o app: \`node kin.mjs send .\` (passos no README). No Kindroid, em **Apps → Waiting for you**, clique em **Allow**.
3. Nas configurações do app, em **Kins**, marque o Kin do teste (de preferência um que você conheça bem).
4. Abra o app e escolha o Kin. Em cada passo: escreva a fala no chat, deixe o Kin responder, aperte **Update status** e compare.
5. Anote tudo na tabela do final: cole a resposta do Kin (se aparecer) e as frases do cartão.

## Três coisas que valem para todos os passos

- **O Kin vê o chat dos últimos ${CHAT_DAYS} dias** (\`chat:read:${CHAT_DAYS}\`). O cartão descreve o estado *no fim do chat recente*, então **não zera** entre um passo e outro: cada passo parte do que os anteriores deixaram. Só um chat novo começa em branco (passo S13).
- **Erro em vermelho** no cartão: aperte **Try again** uma vez e anote o texto. Se houver algo entre parênteses, é o texto do próprio Kindroid: **copie exatamente**.
- **A automação roda na nuvem do Kindroid**, não no seu PC: o Kindroid inicia o app a cada 15 minutos. Fechar o painel ou desligar o PC não para as leituras; só impede você de vê-las até reabrir.

## Passos de leitura`);
  for (const s of SCENARIOS) {
    const e = expected(s);
    const rows = [['Location', e.location], ['Pose and action', e.doing], ['Outfit', e.outfit], ...(e.hair ? [['Hair', e.hair]] : []), ...(e.makeup ? [['Makeup', e.makeup]] : [])];
    out.push(`
### ${s.id}. ${s.title}

**Você escreve:** ${s.say}

**O Kin deve:** ${s.kinSays}

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
${rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

**Confira:**
${s.checks.map((c) => `- ${c}`).join('\n')}

**Se falhar:** ${s.ifWrong}`);
  }
  out.push(`
## A noite, a automação e as falhas

Estes passos verificam o que roda sozinho e o que acontece **quando algo dá errado**. Também servem para **coletar o texto real dos erros** do \`kin\`: o app só reconhece "arquivo ainda não existe" por um "404" e "manutenção" pelas palavras maintenance/downtime/outage, e esses textos foram supostos. Vale em todas as falhas: **as últimas frases boas continuam no cartão** e nenhum botão fica travado.

Para a automação, use a régua em **${SHORTEST_INTERVAL}** durante o teste e volte para um intervalo maior depois: cada leitura é uma pergunta ao Kin.`);
  for (const f of STEPS) {
    out.push(`
### ${f.id}. ${f.title}

**Como provocar:** ${f.provoke}

**O que esperar:** ${f.expectText}

**Confira:**
${f.checks.map((c) => `- ${c}`).join('\n')}

**Anote:** ${f.record}`);
  }
  out.push(`
## Medidas a anotar (uma vez)

- **Tempo** entre apertar **Update status** e as frases aparecerem. Anote 3 leituras.
- **Custo** em créditos de uma leitura e de um início "sem nada a fazer", se o Kindroid mostrar.
- **Cliques repetidos:** aperte **Update status** duas vezes seguidas. Deve haver **uma** leitura só.
- **Vazamento:** depois de 5 ou 6 leituras, olhe o chat e a memória do Kin. Não deve haver JSON nem as perguntas do app. Pergunte ao Kin: "Você lembra de ter me descrito em formato de dados?". A resposta deve ser que não.
- **Celular:** abra o app também no celular, se o Kindroid mostrar o painel lá.

## Como classificar uma falha

| Tipo | Sinal | Onde corrigir |
|---|---|---|
| **A. Formato** | erro vermelho ("not valid JSON", "must be a text") | a pergunta (\`src/core/prompt.js\`) |
| **B. Interpretação** | o Kin respondeu certo no formato, mas com o fato errado (plano virou fato, lugar antigo ficou, roupa de outra pessoa) | a pergunta (\`src/core/prompt.js\`) |
| **C. App** | o Kin respondeu certo e o cartão mostrou outra coisa | a leitura da resposta (\`src/core/outfit.js\`) |
| **D. Plataforma** | nada acontece, erro de permissão, \`kin\` falha, a tela não carrega | \`run/kin.js\`, \`kin.json\`, \`src/screen/\` |

## Tabela de resultados

| Passo | Resultado (OK / parcial / falhou) | Tipo | Resposta do Kin ou **texto real do erro** (cole) | Cartão (cole as frases ou o aviso) |
|---|---|---|---|---|
${[...SCENARIOS, ...STEPS].map((s) => `| ${s.id} |  |  |  |  |`).join('\n')}
`);
  return `${out.join('\n')}\n`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const target = new URL('../docs/real-kin-test-script.md', import.meta.url);
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
    if (current !== renderScript()) { console.error('docs/real-kin-test-script.md is out of date: run npm run build'); process.exit(1); }
  } else {
    writeFileSync(target, renderScript());
    console.log('docs/real-kin-test-script.md written');
  }
}
