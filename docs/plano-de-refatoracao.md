# Plano de refatoração do Clotheskin

Data do levantamento: 22/11/2026 · branch `claude/amazing-clarke-taz1xd` · commit base `4b10472`

> **Linguagem/framework:** JavaScript (ES2022, módulos ES) em **Node 22** para o motor (`main.js`, `run/`), e **DOM puro, sem framework** para a tela (`src/screen/`, empacotada em um script clássico `screen/app.js` compatível com Safari 14.1). Sem dependências em tempo de execução. Os princípios abaixo (SOLID, DRY, Clean Code) estão aplicados a *esse* contexto: funções puras e injeção de dependências, não classes e frameworks.

---

## 1. Diagnóstico (medido, não estimado)

### 1.1 Estado atual

| Item | Valor |
| --- | --- |
| Código de produção | ~2.000 linhas (`run/`, `src/`, `main.js`) |
| Testes unitários | 154 testes, todos passando, 3,4 s |
| Testes de navegador (e2e) | 17/17 passando, 56 s |
| Cobertura (linhas) | `src/core/*` 100 %; `run/program.js` 100 % (90 % de ramos); `src/screen/app.js`, `dom.js`, `main.js` **sem cobertura unitária** (só e2e) |
| Arquivos gerados | `screen/app.js` (66 KB, 1.211 linhas), `kin.json`, `docs/real-kin-test-script.md` — todos em dia (`npm run build` não muda nada) |
| Lint / tipagem | **nenhum** configurado; não há CI (`.github/` não existe) |
| Logs de debug esquecidos | **nenhum**. Os `console.*` existentes são intencionais: o logger de stderr do `main.js` (injetado no programa) e a saída dos scripts de CLI |

### 1.2 Bugs encontrados (reproduzidos)

| # | Onde | O que acontece | Severidade |
| --- | --- | --- | --- |
| **B1** | `run/program.js:88` (`attachedKin`) | `fail()` tem 7 parâmetros posicionais e a chamada passa `entry` no lugar de `note`. Quando `kin kins` falha, o run termina com a mensagem **`"[object Object]"`** e perde a proteção contra runs concorrentes (`base` fica `undefined`). Reproduzido com um `kin.kins()` que lança erro. O teste `program.test.js:317` só confere o `status.json`, não a mensagem. | Alta |
| **B2** | `run/program.js:146` e `:104` (`wake`/`read`) | Uma falta de tempo no orçamento do run (`kind: 'time'`) vai para `fail()`: conta como **falha do servidor** (`serverFailures + 1`, desacelera as leituras) e o tipo `'time'` é apagado por `normalizeEntry` (`state.js:73` não o conhece). Uma limitação do próprio run vira "Kindroid falhou". A pergunta do sono já trata isso certo (`program.js:126`). | Média |
| **B3** | `src/core/outfit.js:322-348` | `describeReading`/`describeOutfit` quebram (`TypeError: Cannot read properties of undefined`) se receberem um resultado sem `outfit` (p.ex. um `parseReading` que falhou). Hoje o chamador protege, mas é uma API pública sem guarda. | Baixa |
| **B4** | `src/core/json.js:65` (`normalizeLoose`) | Crescimento superlinear com palavras soltas repetidas: 32 KB → 27 ms, 128 KB → 243 ms. A saída do `kin ask` aceita até 32 MB (`run/kin.js:43`). Sem limite de tamanho na entrada do parser. | Baixa (endurecimento) |
| **B5** | `src/core/sleep.js:10` | Comentário corrompido: o comentário de `MAX_SLEEP_S` foi colado no fim da linha de `DREAM_TTL_HOURS`. | Cosmético |

### 1.3 Código morto, imports órfãos e variáveis não usadas

Varredura feita com ESLint (`no-unused-vars`) e um levantamento de cada `export` contra todos os importadores.

**Variáveis/imports não usados (remover):**
- `tests/outfit.test.js:3` — imports `describeLocation`, `cleanLocation` não usados.
- `tests/theme.test.js:11` — `let tokens` atribuído e nunca lido.
- `tests/what-if.test.js:11` — `const plus` nunca usado.

**Código inalcançável em produção (só os testes chamam):**
- `parseOutfit` (`outfit.js:116`) — a produção usa só `parseReading`. Migrar os testes para `parseReading` e remover.

**Wrappers sem função:**
- `cleanHair = (v) => lookPhrase(v)` (`outfit.js:260`) — renomear `lookPhrase` ou exportar direto.
- `export { ACTION, OPS }` em `run/program.js:19` existe só para `scripts/build-manifest.mjs:6`; importar de `src/core/state.js`.

**Exports que não precisam ser públicos** (ninguém de fora do arquivo usa, nem os testes) — tornar internos para reduzir a superfície da API:
`balancedObjects`, `normalizeLoose` (json.js); `CLOTHING_ORDER`, `UNDERWEAR_ORDER`, `ACCESSORY_ORDER`, `NO_HAIR`, `NO_MAKEUP`, `cleanHair`, `cleanMakeup`, `describeHair`, `describeMakeup` (outfit.js); `DUE_SLACK_S`, `ERRORS_BEFORE_SLOWING` (schedule.js); `MIN_SLEEP_S`, `MAX_SLEEP_S` (sleep.js); `RUN_STATES` (state.js); `dropHalfChar` (text.js); `END_LIMIT` (kin.js).

**Classe sem uso real:** `KinError` (`run/kin.js:19`) é lançada, mas ninguém testa `instanceof KinError`; o chamador lê `e.code`/`e.stderr` por duck typing. Ou passa a ser usada (ver Fase 4), ou vira um `Error` com propriedades.

### 1.4 Tipagem (TypeScript `--checkJs`, sem alterar o código)

Fora o ruído de falta de `@types/node`, 14 erros reais, todos de anotação/inferência — nenhum de sintaxe:
- Parâmetros com padrão `= {}` sem JSDoc → tipo `{}`: `run/kin.js:57,61`, `outfit.js:228`, `sleep.js:102,112`.
- Aritmética com `Date` em vez de `getTime()`: `sleep.js:55`, `src/screen/app.js:212`.
- `wait()` exige `resend`, mas `write`/`action` não passam: `src/screen/channel.js:86,94`.
- `Element.focus` sem cast: `src/screen/main.js:37`.
- União de retornos (`{ok:true,…} | {ok:false,error}`) sem tipo discriminado: `run/program.js:107`.

### 1.5 Repetição (DRY)

| # | Repetição | Onde |
| --- | --- | --- |
| D1 | Vocabulário em português repetido em 4 listas (aliases de slot, chaves soltas, chaves de leitura e `PT_KEYS`, que reescreve todas as outras) | `outfit.js:25-27, 35-36, 62-67, 275-277` |
| D2 | "Frase com ponto final, maiúscula, sem duplicar `…`" escrita 5 vezes | `outfit.js:191, 234, 267`; `sleep.js:104-105` |
| D3 | Cortar em limite de palavra com `…` (`clipWords`) reescrito à mão | `outfit.js:140` e `:257` |
| D4 | `.replace(/[.;,!?\s]+$/, '')` e o par "tirar aspas/markdown das pontas" | `outfit.js:136, 168, 211, 222, 250, 253` |
| D5 | Texto da leitura: `[location, doing, outfit, hair, makeup].filter(Boolean).join(' ')` | `run/program.js:113`, `src/screen/app.js:102` |
| D6 | Normalizar nome/linha para o prompt reimplementa `oneLine` | `prompt.js:37, 67` |
| D7 | `String(n).padStart(2, '0')` para HH:MM | `time.js:60`, `sleep.js:79` |
| D8 | Duas formas de obter partes da data num fuso (`calendarDay` com cache próprio e `zonedParts` com outro) | `format.js:19`, `time.js:20` |
| D9 | Lista de tipos de erro como literais soltos (`'server'`, `'maintenance'`, `'answer'`, `'input'`, `'time'`) | `state.js:73`, `program.js`, `schedule.js:45`, `app.js` |
| D10 | Padrão "gerar arquivo / `--check`" copiado em 3 scripts | `build-screen.mjs:76-88`, `build-manifest.mjs:37-49`, `build-test-script.mjs:~98-107` |
| D11 | `kindOf(prompt)` (reconhecer qual pergunta é por regex no texto do prompt) duplicado | `dev/harness.js:34`, `tests/support/fake-kindroid.js:9` |

### 1.6 Responsabilidades e complexidade (SOLID / Clean Code)

ESLint com `complexity ≤ 12`, `max-params ≤ 5`, `max-lines-per-function ≤ 60`:

| Função | Problema |
| --- | --- |
| `startApp` (`src/screen/app.js:18`) | **282 linhas** num único fechamento: estado, I/O do canal, anúncios de acessibilidade, textos, renderização e ciclo de vida. |
| `renderCard` (`app.js:193`) | complexidade **35** |
| `normalizeLoose` (`json.js:65`) | complexidade 28 |
| `outfitFromObject`, `normalizeEntry`, `announceChanges` | complexidade 21 |
| `read` (`program.js:98`) | complexidade 16: lê, decide sono, salva duas vezes, pergunta o sono e decide o resultado |
| `fail` (`program.js:193`) | **7 parâmetros posicionais** (causa direta do B1) |
| `save` (`program.js:216`) | mistura I/O com a regra pura de mesclagem entre runs concorrentes |
| `outfit.js` | 349 linhas, 6 responsabilidades: vocabulário, slots, local, pose/ação, cabelo/maquiagem, detecção de idioma e frases |

**O que já está bom e deve ser mantido:** inversão de dependência no motor (`kin`, `clock`, `log` são injetados em `runProgram`), um escritor por arquivo, normalização defensiva de `settings.json`/`status.json`, privacidade (o erro nunca cita a resposta do Kin), arquivos gerados verificados por teste.

### 1.7 Desempenho (linha de base)

| Medida | Valor | Leitura |
| --- | --- | --- |
| `parseReading` (resposta limpa) | 28 µs/op | ótimo |
| `parseReading` (resposta "quase JSON" com narração) | 65 µs/op | ótimo |
| `parseJsonObject` com 22 KB de ruído | 6,7 ms | aceitável |
| `nextWallTime` (fuso de São Paulo) | 0,5 ms | aceitável |
| Run agendado com nada a fazer | **2 chamadas `kin files get` em série** | é aqui que está o custo real |

O gargalo não é CPU: é **tempo de execução cobrado em créditos**. O Kindroid inicia o programa a cada 15 min, *mesmo parado*. Hoje cada início lê `settings.json` **e** `status.json` em sequência (`program.js:39-40`) antes de saber se está parado/pausado — a segunda leitura é desperdício em todo início parado, pausado ou sem Kin.

---

## 2. Invariantes que a refatoração NÃO pode quebrar

1. **Zero dependências em tempo de execução.** O que for adicionado é só `devDependencies`.
2. `run/program.js` e tudo que ele importa **não importam nada de Node** (rodam também no harness do navegador).
3. A tela continua sendo **um script clássico** gerado por `scripts/build-screen.mjs`: só `import { a, b as c } from './x.js'` e `export function|const|class|let`. Nada de `export default`, `import * as`, `#privados`, `.at()`, `Object.hasOwn`, `structuredClone`, `import()`, armazenamento do navegador (Safari 14.1).
4. **Um escritor por arquivo**: a tela só grava `settings.json`; o run só grava `status.json`; o run relê `status.json` antes de gravar e nunca grava por cima de um arquivo que não conseguiu ler.
5. **Privacidade**: nenhuma mensagem de erro, log ou `status.json` contém texto da resposta do Kin; a noite guarda só a impressão digital (`sentenceMark`).
6. Todo caminho do `main.js` termina com exatamente um `kin end`.
7. Orçamentos de tempo: 100 s no programa, vigia de 110 s, `kin.json` com 2 min.
8. Formato de `settings.json`/`status.json` compatível com os arquivos já salvos (`v: 1`).
9. Os textos que a tela mostra não mudam sem intenção (o roteiro `docs/real-kin-test-script.md` é gerado a partir deles).

**Portão de cada commit:** `npm test` verde · `npm run build` sem diferença no git · `npm run test:e2e` 17/17 · lint e typecheck sem erros (a partir da Fase 0).

---

## 3. Plano em fases

Cada fase é um conjunto pequeno de commits revisáveis; nenhuma mistura "mudar comportamento" com "mover código".

### Fase 0 — Rede de segurança (antes de mexer em qualquer coisa)

| Passo | Entrega |
| --- | --- |
| 0.1 | `devDependencies`: `eslint`, `typescript`, `@types/node`, `playwright` (versão fixada; hoje é instalado à mão). |
| 0.2 | `eslint.config.js` (flat config): `no-unused-vars`, `no-undef` com globais por pasta (node / browser / harness), `no-unreachable`, `eqeqeq: smart`, `prefer-const`, `no-shadow`, `complexity: 12`, `max-params: 4`, `max-depth: 4`. Regras de complexidade começam como `warn` e viram `error` no fim da Fase 4. Ignorar `screen/app.js` (gerado). |
| 0.3 | `jsconfig.json` com `checkJs`, `noEmit`, `strict: false` no início (endurecer na Fase 5). Script `npm run typecheck`. |
| 0.4 | Regra própria no lint ou no `build-screen.mjs` que já recusa sintaxe nova também nos módulos importados por `run/program.js` (garantir o invariante 2: nenhum `node:` no grafo do programa). |
| 0.5 | `npm run check` = lint + typecheck + test + `build --check` (os três geradores). |
| 0.6 | Cobertura com `node --test --experimental-test-coverage` e limites mínimos (`--test-coverage-lines=95 --test-coverage-branches=85` para `src/core` e `run/`). |
| 0.7 | **Testes de regressão para B1–B4 escritos primeiro** (falham hoje; marcados `todo` até a Fase 1): mensagem do run quando `kin kins` falha; falta de tempo não conta como falha do servidor; `describeReading({})` não quebra; entrada de 200 KB processada em < 100 ms. |
| 0.8 | Teste de desempenho `tests/perf.test.js` (ver §4.2) e teste de **custo por run** (contar chamadas `kin` por cenário). |
| 0.9 | CI no GitHub Actions: Node 22, `npm ci`, `npm run check`, e2e com Chromium; artefato com capturas em caso de falha. |

### Fase 1 — Correções e tratamento de erros

| Passo | Entrega |
| --- | --- |
| 1.1 (**B1**) | `fail(ctx, { who, entry, outcome, now, note, base })` com **objeto nomeado**; corrigir `attachedKin`; teste confere a mensagem final do run. |
| 1.2 (**B2**) | `kind: 'time'` tratado num só lugar: não incrementa `failures`/`serverFailures`, agenda para o próximo início (`TICK_S`) com nota, como já faz a pergunta do sono. Incluir `'time'` em `ERROR_KINDS` ou documentar que nunca é gravado. |
| 1.3 (**B3**) | Guardas em APIs públicas: `describeReading({ outfit = {} } = {})`, `describeOutfit(outfit = {})`, `describeDream`/`dreamFact` já aceitam `{}` — manter o padrão em todas as funções `describe*`. |
| 1.4 (**B4**) | Limite de tamanho antes de analisar a resposta (`MAX_ANSWER_CHARS ≈ 20.000`; o prompt pede uma linha de JSON). Acima disso: erro "resposta longa demais", sem citar o texto. Também baixar `maxBuffer` do `kin ask` para algo coerente (1 MB). |
| 1.5 | `main.js`: limitar o tamanho lido do stdin; tratar `event` que não é objeto (`JSON.parse('3')`) antes de chamar o programa. |
| 1.6 | `run/kin.js`: `put()` com `fs/promises` (hoje usa `writeFileSync` dentro de função assíncrona) e `rm` garantido no `finally`. |
| 1.7 | Tela: `startApp` devolve `dispose()` que limpa os 2 `setInterval` e os 3 listeners globais (hoje nunca são removidos); `channel.wait` com `resend` opcional explícito. |
| 1.8 | Datas: trocar aritmética de `Date` por `getTime()` (`sleep.js:55`, `app.js:212`) e validar `Date` inválida nos pontos de entrada (`isDue`, `plannedAt`, `startDueFor` com `retryAt` corrompido já normalizado, mas sem garantia de tipo). |
| 1.9 (**B5**) | Corrigir o comentário de `sleep.js:10`. |

### Fase 2 — Limpeza (código morto, imports órfãos, superfície da API)

1. Remover imports/variáveis não usados dos testes (§1.3).
2. Remover `parseOutfit` depois de migrar seus testes para `parseReading`.
3. Remover o wrapper `cleanHair` e o reexport `ACTION, OPS` de `program.js`.
4. Desexportar os símbolos listados em §1.3 (se um teste precisar, testar pela função pública que os usa).
5. Decidir `KinError`: passar a usá-la (`instanceof` em `kin.get` para o 404) ou removê-la.
6. Regra de lint `no-unused-vars` como `error` a partir daqui; um script `npm run unused-exports` (o mesmo levantamento deste plano, ~20 linhas) roda no `check`.

### Fase 3 — DRY

| Ação | Resolve |
| --- | --- |
| `src/core/vocabulary.js`: **uma tabela** `{ chave canônica → { en: [...], pt: [...] } }`; `SLOT_ALIASES`, `LOOSE_*`, `isLocationKey`…`isMakeupKey` e `PT_KEYS` são derivados dela. | D1 |
| Em `text.js`: `toSentence(s)` (maiúscula + ponto, respeitando `…`), `clipWords(s, max)`, `trimEndPunctuation(s)`, `stripWrapping(s)` (aspas/markdown nas pontas), `pad2(n)`. | D2, D3, D4, D7 |
| `readingText(reading)` em `src/core/reading.js`, usado pelo run e pela tela. | D5 |
| `prompt.js` usa `oneLine` para o nome e a hora. | D6 |
| `format.js` usa `zonedParts` de `time.js` (um cache de formatadores só). | D8 |
| `ERROR_KINDS`, `RUN_STATES`, `OPS` como constantes congeladas num lugar só; nenhum literal solto nos módulos. | D9 |
| `scripts/lib/generated.mjs`: `writeOrCheck(target, text, label)` usado pelos 3 geradores. | D10 |
| Cada prompt exporta seu `kind` (`READING`, `SLEEP`, `DREAM`) e uma função `promptKind(text)` vive em `prompt.js`; harness e fake usam essa função. | D11 |

### Fase 4 — Estrutura (SOLID aplicado ao tamanho do projeto)

O projeto é pequeno; a meta é **responsabilidade única e testabilidade**, não camadas novas.

**4.1 Motor (`run/program.js`) — separar decisão de I/O (SRP + DIP já existente):**
- `src/core/entry.js` (puro, testável sem fakes): `succeeded(entry)`, `failedEntry(entry, { kind, error, note, now, intervalS })`, `mergeConcurrent({ current, base, next })` (a regra de quem fica com a noite, hoje dentro de `save`), `nextAfterReading(entry, reading, now)`.
- `run/program.js` fica só com o roteiro: `scheduled` → `attachedKin` → `readStep` | `sleepStep` | `dreamStep`, cada uma com ≤ 30 linhas.
- `read()` dividida em `readStep` (pergunta + parse + salvar) e `askSleep` (pergunta de sono).
- `ask()` e a política de nova tentativa isoladas (`withRetry`), com o orçamento de tempo num objeto `budget` (`left()`, `fits(ms)`).

**4.2 Leitura da resposta (`src/core/outfit.js`, 349 linhas) — um módulo por responsabilidade:**
```
src/core/reading/
  vocabulary.js   (Fase 3)
  slots.js        roupa e acessórios → { slot: [peças] }
  place.js        cleanLocation, describeLocation
  doing.js        cleanPose, cleanAction, describeDoing
  look.js         cabelo e maquiagem
  language.js     notEnglishKeys
  index.js        parseReading, describeReading (a única API usada pelo run)
```
Os nomes de arquivo respeitam o bundler (imports nomeados relativos). Os testes existentes (`what-if`, `polaris-what-if`, ambiguidades) continuam importando só `parseReading`/`describeReading` — servem de rede de segurança da divisão.

**4.3 Tela (`src/screen/app.js`, `startApp` de 282 linhas):**
- `store.js`: estado `S`, `saveSettings`, `loadStatus`, `update`, `pick`, `setRun` (sem DOM).
- `texts.js` (puro): `warningText`, `problemText`, `automationStatus`, `kinStateLine`, `changesToAnnounce(before, after)` — **passa a ter teste unitário em Node** (hoje só é coberto pelo e2e).
- `views/card.js`, `views/kinList.js`, `views/automation.js`, `views/settings.js`: funções `(state, actions) → Element`; `renderCard` quebrado em `renderEmpty`, `renderHeader`, `renderFacts`, `renderBanner`.
- `announcer.js`: as duas regiões `aria-live`.
- `app.js` só monta, assina o canal e agenda o polling; devolve `{ render, update, dispose }`.

**4.4 Critérios de saída da Fase 4:** nenhuma função com complexidade > 12 ou > 4 parâmetros (regras viram `error`); nenhuma função com mais de 60 linhas; `src/screen` com cobertura unitária ≥ 80 % nos módulos puros.

### Fase 5 — Clean Code e tipagem

1. JSDoc `@typedef` para `Settings`, `Status`, `Entry`, `Reading`, `Sleep`, `Dream`, `AskResult` (união discriminada por `ok`), `KinApi` (o contrato injetado em `runProgram`); `@param` em todas as funções exportadas.
2. `jsconfig` com `strict: true` (ou ao menos `strictNullChecks`) e **0 erros** no `npm run typecheck`.
3. Nomes: `e`, `p`, `s`, `d`, `r` em funções longas viram `entry`, `parsed`, `sleepAnswer`, `dreamAnswer`, `reading`.
4. Linhas: limite de 140 colunas no lint; as ~100 linhas acima de 160 colunas (principalmente regex e expressões ternárias encadeadas) são quebradas em constantes nomeadas.
5. Regex grandes (`GOING_TO_VERB`, `PT_WORDS`, `NO_PLACE`) montadas a partir de listas com nome, como `EN_PREP` já faz.
6. Comentários: manter os que explicam *por quê* (são bons); remover os que repetem o código.

### Fase 6 — Desempenho

| # | Otimização | Ganho esperado | Como verificar |
| --- | --- | --- | --- |
| O1 | No início agendado, ler `settings.json` primeiro e **só ler `status.json` se estiver rodando e com Kin** | Inícios parados/pausados: 2 → **1** chamada `kin` (o caso mais comum, 96 vezes por dia) | teste de custo por run |
| O2 | Quando os dois arquivos forem necessários, lê-los em paralelo (`Promise.all`) | −1 latência de chamada por início com leitura devida | teste com `kin` fake com atraso fixo |
| O3 | Limite de tamanho da resposta (1.4) e regex com âncora/limite em `normalizeLoose` | elimina o pior caso quadrático (243 ms → < 10 ms em 128 KB) | `tests/perf.test.js` |
| O4 | Tela: manter o "não renderiza se `status.json` não mudou"; medir o `render()` completo no e2e (`performance.now`) e falhar acima de 16 ms | renderização sem travar a rolagem | e2e |
| O5 | (Opcional) minificar `screen/app.js` no build | 66 KB → ~25 KB; só vale se o carregamento no app for lento | medir no Kindroid real primeiro |

Não otimizar o que já é rápido (`parseReading`, fusos): o custo está nas chamadas ao Kindroid.

### Fase 7 — Fechamento

1. Atualizar a tabela de layout do `README.md` com os novos módulos e os comandos `check`, `lint`, `typecheck`, `test:perf`.
2. Regras de complexidade e de cobertura viram bloqueantes no CI.
3. Rodar o roteiro com o Kin real (`docs/real-kin-test-script.md`) como teste de aceitação final.

---

## 4. Estratégia de testes de qualidade e desempenho

### 4.1 Qualidade

| Camada | Ferramenta | O que garante |
| --- | --- | --- |
| Estática | ESLint + `tsc --checkJs` | sem variáveis/imports órfãos, sem globais indefinidas, sem erros de tipo, complexidade limitada |
| Unitária | `node:test` (já existente, 154 testes) | regras puras: leitura, sono, agenda, estado, mesclagem |
| Contrato | testes de `run/kin.js` com o `kin` fake (`tests/support/fake-kin-cli.mjs`) | 404 ≠ falha, saída UTF‑8 inteira, `kin end` sempre uma vez |
| Propriedade / fuzz | `what-if.test.js` (já existe) + novo fuzz em `normalizeSettings`/`normalizeStatus` com JSON aleatório | nenhum arquivo corrompido quebra o run ou a tela |
| Regressão | um teste por bug (B1–B4) | os bugs não voltam |
| Integração | `run-main.test.js` (o `node main.js` real) | o processo inteiro, incluindo o vigia |
| Navegador | `tests/e2e/screen.cjs` (Playwright, 17 checagens) | foco, acessibilidade, noite inteira com relógio falso, nenhum erro de console |
| Gerados | `build --check` ×3 | `screen/app.js`, `kin.json` e o roteiro nunca ficam desatualizados |
| Cobertura | `--experimental-test-coverage` com limites | ≥ 95 % linhas / ≥ 85 % ramos em `src/core` e `run/` |

### 4.2 Desempenho (`tests/perf.test.js`, orçamentos folgados para não ser instável no CI)

- `parseReading` de 1.000 respostas variadas: média < 0,5 ms.
- Entradas adversárias (200 KB de palavras soltas, chaves desbalanceadas, aspas abertas): < 100 ms cada — detecta regex com retrocesso catastrófico (ReDoS), que importa porque a entrada vem de um modelo.
- `nextWallTime` em 10 fusos × 365 dias (inclui mudanças de horário de verão): < 1 s no total.
- **Custo por run** (a métrica que vira crédito): número de chamadas `kin` por cenário, verificado exatamente:
  - parado / pausado / sem Kin: **1** (hoje 2);
  - rodando, nada devido: 2;
  - leitura acordado: `get, get, kins, ask, get, put`;
  - leitura que adormece: + `ask` de sono + `get, put`.
- Tempo de parede do `node main.js` com `kin` instantâneo: < 300 ms (inicialização do Node + programa).

---

## 5. Riscos e como mitigar

| Risco | Mitigação |
| --- | --- |
| Quebrar a compatibilidade com Safari 14.1 ao dividir módulos | o bundler já recusa sintaxe nova; e2e roda o `screen/app.js` gerado |
| Mudar textos da tela sem querer (o roteiro do Kin real depende deles) | `build --check` do roteiro falha se qualquer frase mudar; snapshots das frases nos testes |
| Regressão sutil na leitura de respostas "quase JSON" | os testes `what-if`/`polaris-what-if`/ambiguidade ficam intocados durante a Fase 4 e são a rede de segurança |
| Mudança no formato de `status.json` | `v: 1` mantido; teste que carrega o `sample/status.json` e um arquivo antigo |
| Divisão grande demais num commit só | um commit por passo; nenhum commit mistura mover código e mudar comportamento |

## 6. Decisões pendentes (para você)

1. **`devDependencies`:** posso adicionar `eslint`, `typescript`, `@types/node` e fixar `playwright`? (Nada entra em tempo de execução.)
2. **Formatação:** reformatar tudo de uma vez com Prettier (um commit só, grande e mecânico) ou só aplicar o limite de colunas nos trechos tocados?
3. **CI:** criar o workflow do GitHub Actions neste repositório?
4. **Idioma:** manter código, comentários e mensagens em inglês (como hoje) e só a documentação de testes em português?

## 7. Ordem sugerida e tamanho

| Fase | Commits (aprox.) | Risco |
| --- | --- | --- |
| 0 — Rede de segurança | 4–5 | nenhum (não toca produção) |
| 1 — Correções | 5–6 | baixo, cada um com teste |
| 2 — Limpeza | 2–3 | muito baixo |
| 3 — DRY | 4–5 | baixo |
| 4 — Estrutura | 6–8 | médio (maior mudança; coberta pelos testes atuais) |
| 5 — Clean Code / tipos | 3–4 | baixo |
| 6 — Desempenho | 2–3 | baixo |
| 7 — Fechamento | 1–2 | nenhum |
