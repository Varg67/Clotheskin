// Generates docs/real-kin-test-script.md. `node scripts/build-test-script.mjs` writes it; `--check` compares.
import { readFileSync, writeFileSync } from 'node:fs';
import { SCENARIOS, expected, FAILURES, expectedFailure } from './real-kin-scenarios.mjs';

export function renderScript() {
  const out = [];
  out.push(`# Roteiro do primeiro teste com um Kin de verdade

Este arquivo é gerado por \`node scripts/build-test-script.mjs\`. As frases "O cartão deve mostrar" são calculadas pelo código do app a partir da resposta que um Kin bem-comportado daria, então elas acompanham o app.

## Antes de começar

1. Envie o app: \`node kin.mjs send .\` (passos completos no README). No Kindroid, em **Apps → Waiting for you**, clique em **Allow**.
2. Nas configurações do app, em **Kins**, marque o Kin do teste (de preferência um que você já conheça bem).
3. Abra o app e selecione o Kin. Em cada passo abaixo: escreva a fala no chat, deixe o Kin responder, aperte **Update status** e compare.
4. Anote tudo na tabela de resultados no final. Cole a resposta do Kin e as três frases do cartão.

## Duas coisas que valem para todos os passos

- **O Kin vê o chat do último dia** (\`chat:read:1\`). O cartão descreve o estado *no fim do chat recente*, então ele **não zera** entre um passo e outro: cada passo parte do que os anteriores deixaram. Só um chat novo começa em branco (passo S13).
- Se o cartão mostrar um **erro em vermelho**, o Kin não respondeu no formato esperado. Aperte **Try again** uma vez. Anote o texto do erro: ele diz se o problema foi JSON inválido, tipo errado ou falha ao chamar o Kin.

## Passos`);
  for (const s of SCENARIOS) {
    const e = expected(s);
    out.push(`
### ${s.id}. ${s.title}

**Você escreve:** ${s.say}

**O Kin deve:** ${s.kinSays}

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | ${e.location} |
| Pose and action | ${e.doing} |
| Outfit | ${e.outfit} |

**Confira:**
${s.checks.map((c) => `- ${c}`).join('\n')}

**Se falhar:** ${s.ifWrong}`);
  }
  out.push(`
## Falhas provocadas (a parte que mais ensina)

Os passos acima verificam se o cartão entende o chat. Estes verificam o que acontece **quando algo dá errado**, e servem a um segundo objetivo: **coletar o texto real dos erros** do \`kin ask\`. O app reconhece o tipo de erro por esse texto (\`screen/src/core/errors.js\`), mas eu só consegui *supor* como ele aparece. Em cada erro o cartão mostra o texto real entre parênteses: **copie-o exatamente** na tabela. Com ele eu ajusto o reconhecimento.

Vale em todas as falhas: as **últimas frases boas continuam no cartão**, e o botão **Try again** não pode ficar travado.

Regra de ouro para a automação: ela roda **na nuvem do Kindroid**, não no seu PC. Desligar a internet do PC não pára as verificações; só impede você de ver o resultado até voltar.`);
  for (const f of FAILURES) {
    const lines = [`
### ${f.id}. ${f.title}

**Como provocar:** ${f.provoke}`];
    for (const e of expectedFailure(f)) {
      lines.push(`
**${e.label}:**`);
      if (!f.autoOnly) lines.push(`
**Update status** mostraria${f.badAnswer ? '' : ' (o texto real do erro viria entre parênteses no fim)'}:

> ${e.manual}`);
      if (e.auto.length) {
        lines.push('\nE a verificação automática explicaria, sob o cartão (intervalo de 15 min como exemplo):');
        for (const a of e.auto) lines.push(`\nDepois de ${a.failures} falha${a.failures > 1 ? 's' : ''}:\n${a.lines.map((l) => `> ${l}`).join('\n')}`);
      }
    }
    if (f.expectText) lines.push(`
**O que esperar:** ${f.expectText}${f.expectNote ? ` ${f.expectNote}` : ''}`);
    lines.push(`
**Confira:**
${f.checks.map((c) => `- ${c}`).join('\n')}

**Anote:** ${f.record}`);
    out.push(lines.join('\n'));
  }
  out.push(`
## Medidas a anotar (uma vez)

- **Tempo** entre apertar **Update status** e a frase aparecer. Anote 3 leituras.
- **Custo** em créditos de uma leitura, se o Kindroid mostrar. O guia não diz quanto custa um \`kin ask\`.
- **Cliques repetidos:** aperte **Update status** duas vezes seguidas. Deve haver **uma** leitura só (o botão fica em "Reading…").
- **Vazamento:** depois de 5 ou 6 leituras, olhe o chat e a memória do Kin. Não deve haver JSON, pergunta do rastreador nem respostas em inglês que você não pediu. Pergunte ao Kin: "Você lembra de ter me descrito em formato de dados?". A resposta deve ser que não.
- **Dois Kins com o mesmo nome** (se tiver): selecione um, aperte **Update status**, troque para o outro no meio da leitura. O resultado deve aparecer só no primeiro.

## Como classificar uma falha

| Tipo | Sinal | Onde corrigir |
|---|---|---|
| **A. Formato** | erro vermelho no cartão ("not valid JSON", "must be a text") | prompt (exemplo, instruções de formato) |
| **B. Interpretação** | o Kin respondeu JSON válido mas com o fato errado (plano virou fato, lugar antigo ficou, roupa de outra pessoa) | prompt (\`screen/src/core/prompt.js\`) |
| **C. App** | o JSON do Kin estava certo e o cartão mostrou outra coisa | código (\`screen/src/core/outfit.js\`) |
| **D. Plataforma** | nada acontece, erro de permissão, \`kin ask\` falha, o cartão não recebe a frase | suposições do README (\`run/kin-cli.js\`, grants) |

## Tabela de resultados

| Passo | Resultado (OK / parcial / falhou) | Tipo | Resposta do Kin ou **texto real do erro** (cole) | Cartão (cole as 3 frases ou o aviso) |
|---|---|---|---|---|
${[...SCENARIOS, ...FAILURES].map((s) => `| ${s.id} |  |  |  |  |`).join('\n')}
`);
  return `${out.join('\n')}\n`;
}

const target = new URL('../docs/real-kin-test-script.md', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== renderScript()) { console.error('docs/real-kin-test-script.md is out of date: run node scripts/build-test-script.mjs'); process.exit(1); }
} else if (process.argv[1] && process.argv[1].endsWith('build-test-script.mjs')) {
  writeFileSync(target, renderScript());
  console.log('docs/real-kin-test-script.md written');
}
