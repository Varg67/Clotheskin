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
| **B4** | `src/core/json.js` (`normalizeLoose`, `parseJsonObject`) | Sem limite de tamanho na entrada do parser, e a saída do `kin ask` aceita até 32 MB (`run/kin.js:43`). Palavras soltas repetidas crescem mais que linearmente (32 KB → 27 ms, 128 KB → 243 ms); milhares de `{...}` pequenos custam ~3,5 µs por caractere, porque cada um é uma tentativa de parse (60 KB → ~210 ms). | Baixa (endurecimento) |
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

### 2.1 Compatibilidade com o Kindroid Workshop (do guia "Making things for a Kin with your own coding tool")

| Regra do guia | Consequência para a refatoração |
| --- | --- |
| *"Packages come from a lockfile, installed when each run starts"* | **Nenhum pacote no `package.json`/`package-lock.json` da raiz.** Ferramentas de desenvolvimento (ESLint, TypeScript, `@types/node`: 81 pacotes, 42 MB) ficam em `tools/`, com lockfile próprio, e nunca são instaladas num run. Os scripts da raiz não podem se chamar `install`, `prepare` ou `postinstall` (o `npm ci` da raiz os executaria). |
| `run.entry` é exatamente `node <file>`; a cópia compartilhada roda numa pasta só de leitura e grava só em `/tmp` | `main.js` continua a entrada; `run/kin.js` já grava em `/tmp`. Nenhum passo de build em tempo de run. |
| Todo arquivo do commit é texto (ou imagem/fonte/som da tela), sem código compilado | `screen/app.js` continua gerado e **commitado**; nenhum minificador binário. |
| A tela é uma moldura de ~390 pt, sem cookies nem armazenamento, e põe dados salvos como texto, nunca HTML | Regras já garantidas pelo bundler e pelo e2e; o lint agora também as cobre. |
| O `kin end` aceita até **4.000** caracteres e o resultado de uma ação volta para o Kin | O código usa 500 (`run/kin.js:17`, `END_LIMIT`), um limite antigo. Manter curto é bom para créditos, mas o comentário "kin end keeps at most 500" está errado: corrigir na Fase 2. |
| A resposta a `{ kin: "kins" }` traz `current` quando a tela é aberta do chat de um Kin | Fora do escopo da refatoração (é recurso novo), mas a separação da tela na Fase 4 deve deixar fácil usar `current` para escolher o Kin. |
| A entrada de uma ação traz `"kin":"<id>"` no topo | Já tratado (`program.js:70`). |

### 2.2 Como o app chega ao Kindroid (instalação por links)

A instalação real não usa `kin send`: os links *raw* do GitHub vão, com um prompt, para o agente do Kindroid Apps, que copia os arquivos para dentro do programa. Consequências:

| Fato | Consequência |
| --- | --- |
| O programa precisa de **22 dos 68 arquivos** do repositório (~160 KB): `kin.json`, `package.json`, `package-lock.json`, `main.js`, `run/kin.js`, `run/program.js`, 9 arquivos de `src/core/`, os 5 de `screen/` e os 2 de `sample/` | O resto (`dev/`, `tests/`, `scripts/`, `docs/`, `tools/`, configs de lint e tipos, `server.mjs`, README) **não vai** para o Kindroid. Isso confirma a decisão do §2.1: ferramentas de desenvolvimento nunca entram na lista. |
| Cada arquivo copiado é uma chance de o agente esquecer ou alterar um | A lista **não pode ser mantida à mão**: é gerada seguindo os imports a partir de `main.js` e de `screen/index.html` (ver 0.10). Uma refatoração que cria um módulo novo em `src/core/` aumenta a lista automaticamente. |
| `screen/app.js` tem 66 KB; se o agente reescrever o arquivo em vez de baixá-lo, pode truncar ou "corrigir" o código | Cada arquivo vai com seu SHA-256; o prompt pede ao agente que confira os hashes depois de copiar (se ele tiver um terminal). A tela e o run mostram um **identificador de build** curto, que a pessoa compara com o do prompt. A minificação (O5) fica **descartada**: linhas gigantes são as mais fáceis de corromper numa cópia. |
| O GitHub serve os links *raw* de um branch com cache de alguns minutos, e o branch padrão hoje é `claude/zealous-heisenberg-mn7vjm` | Os links apontam para um **commit** (`raw.githubusercontent.com/Varg67/Clotheskin/<sha>/...`), não para um branch: nada de versão misturada nem cache velho, e a refatoração nos branches de trabalho não afeta o que está instalado até ser enviada de propósito. |
| `screen/app.js` e `kin.json` são gerados | O prompt só é gerado se `npm run check` passar naquele commit (arquivos gerados em dia). |

**Portão de cada commit:** `npm test` verde · `npm run build` sem diferença no git · `npm run test:e2e` 17/17 · lint e typecheck sem erros (a partir da Fase 0).

---

## 3. Plano em fases

Cada fase é um conjunto pequeno de commits revisáveis; nenhuma mistura "mudar comportamento" com "mover código".

### Fase 0 — Rede de segurança (antes de mexer em qualquer coisa) — **feita**, exceto a CI (0.9) e o pacote de instalação (0.10)

O que ficou pronto: `tools/` (ESLint 10, TypeScript 6, `@types/node` 22, fora do lockfile da raiz), `eslint.config.mjs`, `jsconfig.json`, `tools/run.mjs` e os scripts `npm run tools | lint | typecheck | test:coverage | test:perf | build:check | check`; testes `tests/run-cost.test.js`, `tests/regressions.test.js` e `tests/perf/parsing.test.js`. `npm run check` passa: lint com 0 erros e 25 avisos (5 de código morto, que viram erro na Fase 2; 20 de tamanho e complexidade, que viram erro na Fase 4), 158 testes verdes e 6 pendentes (`todo`: B1, B2, B3 e o O1 nos três casos), cobertura de 99,9 % das linhas com limite mínimo aplicado, desempenho dentro do orçamento (2 pendentes: os dois casos do B4) e arquivos gerados em dia. O `typecheck` roda, mas só entra no `check` depois da Fase 1: hoje acusa 19 erros, todos de anotação (§1.4, mais `scripts/build-screen.mjs:46` e `scripts/real-kin-scenarios.mjs:138`).

| Passo | Entrega |
| --- | --- |
| 0.1 | `eslint`, `typescript` e `@types/node` em `tools/package.json` (ver §2.1; **não** na raiz). `playwright` continua instalado à mão até decidir a CI. |
| 0.2 | `eslint.config.js` (flat config): `no-unused-vars`, `no-undef` com globais por pasta (node / browser / harness), `no-unreachable`, `eqeqeq: smart`, `prefer-const`, `no-shadow`, `complexity: 12`, `max-params: 4`, `max-depth: 4`. Regras de complexidade começam como `warn` e viram `error` no fim da Fase 4. Ignorar `screen/app.js` (gerado). |
| 0.3 | `jsconfig.json` com `checkJs`, `noEmit`, `strict: false` no início (endurecer na Fase 5). Script `npm run typecheck`. |
| 0.4 | Regra própria no lint ou no `build-screen.mjs` que já recusa sintaxe nova também nos módulos importados por `run/program.js` (garantir o invariante 2: nenhum `node:` no grafo do programa). |
| 0.5 | `npm run check` = lint + typecheck + test + `build --check` (os três geradores). |
| 0.6 | Cobertura com `node --test --experimental-test-coverage` e limites mínimos (`--test-coverage-lines=95 --test-coverage-branches=85` para `src/core` e `run/`). |
| 0.7 | **Testes de regressão para B1–B4 escritos primeiro** (falham hoje; marcados `todo` até a Fase 1): mensagem do run quando `kin kins` falha; falta de tempo não conta como falha do servidor; `describeReading({})` não quebra; entrada de 200 KB processada em < 100 ms. |
| 0.8 | Teste de desempenho `tests/perf.test.js` (ver §4.2) e teste de **custo por run** (contar chamadas `kin` por cenário). |
| 0.9 | CI no GitHub Actions: Node 22, `npm ci`, `npm run check`, e2e com Chromium; artefato com capturas em caso de falha. |
| 0.10 | **Pacote de instalação** (§2.2): `scripts/build-install.mjs` segue os imports a partir de `main.js` e `screen/index.html` e acrescenta `kin.json`, `package*.json` e `sample/`. `npm run install-prompt` (só depois de `npm run check` passar e do commit estar no GitHub) imprime o prompt para o agente do Kindroid: os links *raw* fixados no commit, o tamanho e o SHA-256 de cada arquivo, a instrução de copiar byte a byte sem editar e de conferir os hashes, e o identificador de build. Um teste garante que a lista cobre todo import do run e da tela (nenhum arquivo esquecido) e que nada de `tools/`, `dev/`, `tests/` ou `scripts/` entra nela. O identificador de build é um hash curto do conteúdo dos arquivos da lista, mostrado no rodapé das configurações da tela e no `kin end` de uma ação. |

### Fase 1 — Correções e tratamento de erros — **feita**

Resultado: B1–B5 corrigidos, cada um com teste de regressão ativo; `npm run check` agora inclui o `typecheck` (0 erros); 165 testes verdes, 3 pendentes (só o O1, Fase 6); desempenho 10/10; e2e 17/17; o roteiro do Kin real não mudou nenhuma frase. O que saiu diferente do planejado:
- **1.4:** acima de 20.000 caracteres a resposta **ainda é lida se for JSON estrito** (um `JSON.parse`, linear); só a busca e o reparo deixam de rodar. Recusar tudo quebraria um comportamento já testado (`what-if.test.js`: JSON válido de 1 MB é lido e cortado). O `maxBuffer` do `kin ask` **não** foi reduzido: estourá-lo viraria uma "falha do Kindroid" em vez de uma resposta inválida do Kin. Pior caso no limite: ~50 ms (antes, sem teto, ~210 ms com 60 KB).
- **1.5:** a mensagem para entrada que não é JSON ficou a mesma; JSON que não é objeto tem mensagem própria.
- **1.7:** o `dispose()` da tela foi **descartado**: ninguém o chamaria (a tela vive enquanto a moldura existe), então seria código morto novo. Ficou só a tipagem de `channel.wait`.
- **1.8:** além do `getTime()`, `isDue`/`startDueFor` agora tratam uma data ilegível como "agora": antes, `isDue` ficava falso para sempre (nada mais seria lido) e `startDueFor` lançava `RangeError` na tela.
- **Tipos:** os resultados de parse são uniões discriminadas (`ok: true | ok: false`), conferidas com `ok === false` onde o resultado é usado depois. Sem `strictNullChecks`, `!ok` não estreita o tipo. Ligar `strictNullChecks` traz 31 erros, a maioria sobre o estado da tela, e fica para a Fase 5, quando `!ok` volta a funcionar. Tipos importados no JSDoc usam `@import`, porque o bundler recusa (com razão) `import(`.

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

### Fase 2 — Limpeza (código morto, imports órfãos, superfície da API) — **feita**

Resultado: os 6 itens abaixo feitos; `npm run check` com `unused-exports` e regras de código morto do lint como **erro** (testei: um export sem uso e uma variável sem uso plantados são barrados). Lint: 0 erros, 20 avisos (todos de tamanho e complexidade, Fase 4). O que saiu diferente:
- O detector achou dois exports a mais que o levantamento manual (`append` em `src/screen/dom.js`, além da lista do §1.3) e entende `await import(...)`, por isso não acusou `createAppServer`, que o e2e usa.
- **`KinError`:** ficou interna (não exportada). O `kin.get` continua distinguindo o 404 por `e.code` numérico, que diz se o `kin` chegou a rodar; um `instanceof` não substituiria isso.
- Também saiu uma regra de CSS órfã (`.auto-note`, sem uso desde `88d6e03`). O CSS vai para o Kindroid, então conta como código morto.
- Os comentários sobre o limite do `kin end` agora dizem que o guia aceita 4.000 caracteres e que 500 é uma escolha nossa.

1. Remover imports/variáveis não usados dos testes (§1.3).
2. Remover `parseOutfit` depois de migrar seus testes para `parseReading`.
3. Remover o wrapper `cleanHair` e o reexport `ACTION, OPS` de `program.js`.
4. Desexportar os símbolos listados em §1.3 (se um teste precisar, testar pela função pública que os usa).
5. Decidir `KinError`: passar a usá-la (`instanceof` em `kin.get` para o 404) ou removê-la.
6. Regra de lint `no-unused-vars` como `error` a partir daqui; um script `npm run unused-exports` (o mesmo levantamento deste plano, ~20 linhas) roda no `check`.

### Fase 3 — DRY — **feita**

Resultado: as 11 repetições resolvidas em 7 commits, sem mudar nenhuma frase do app (o roteiro gerado do Kin real ficou idêntico, e os prompts foram conferidos byte a byte). 167 testes verdes, desempenho 10/10, e2e 17/17, lint e tipos sem erros. A lista de arquivos que vão para o Kindroid passou de 22 para **23** (`src/core/vocabulary.js`, o primeiro dos ~3 módulos da opção (a) do §4.4). O que saiu diferente ou a mais:
- **D1:** a tabela única foi conferida contra as listas antigas antes da troca (as mesmas 37 chaves em português e os mesmos 44 sinônimos de slot). As buscas usam `Map`, então nomes embutidos como `constructor` continuam sem significado.
- **D2:** `toSentence` adota a regra mais completa (não põe ponto depois de `.`, `!`, `?` ou `…`). Os valores que chegam até ela já vêm sem pontuação final, então o resultado é o mesmo.
- **D6:** com `cleanString`, o nome do Kin no prompt também perde caracteres invisíveis e nunca corta um emoji ao meio.
- **D8:** além de unificar, achou um custo escondido: `zonedParts` validava o fuso criando um `Intl.DateTimeFormat` novo a cada chamada. Com o cache, `zonedParts` foi de 57 para 9 µs e `nextWallTime` de 518 para 55 µs; o orçamento de desempenho foi apertado de 8 s para 2 s, para proteger o ganho. Em troca, a formatação de datas da tela custa ~4 µs a mais por data.
- **D9:** as constantes se chamam `ERROR` (em `schedule.js`) e `AUTO` (em `state.js`). `ERROR.TIME` está documentado como "nunca gravado".
- **D10:** `scripts/lib/generated.mjs` também traz `isMainModule`, usado pelos quatro scripts.
- **Achado no caminho:** a ferramenta de escrita gravou o intervalo `̀-ͯ` como caracteres combinantes literais (invisíveis). Foi corrigido para o escape, e uma varredura confirmou que não há outros no código. O único que resta é proposital, num teste de fuzz.

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

### Fase 4 — Estrutura (SOLID aplicado ao tamanho do projeto) — **feita**

Resultado: os 20 avisos de tamanho e complexidade zerados em 4 blocos (motor, leitura das respostas, tela, scripts), e as regras viraram **erro** no lint. Nenhuma função passa de 60 linhas, 4 parâmetros ou complexidade 12. 176 testes verdes (7 novos da tela em Node e 2 das transições puras), cobertura de 98,9 % das linhas, desempenho 10/10, e2e 17/17. O roteiro do Kin real ficou idêntico; a única mudança nele é apontar também `phrases.js` como lugar da leitura da resposta. O que saiu diferente do planejado:
- **4.1:** as transições puras (`succeeded`, `failedEntry`, `postponedEntry`, `mergeConcurrent`) foram para `state.js`, não para um `entry.js` novo: ficam junto do resto da forma do `status.json` e não aumentam a lista de instalação.
- **4.2:** a divisão moderada (opção (a)) ficou em `vocabulary.js` (Fase 3) + `phrases.js` (limpeza e frases de local, pose/ação, cabelo e maquiagem) + `outfit.js` (roupas, leitura do JSON, idioma, montagem). O `joinNatural` foi para `text.js`. **A lista de instalação tem 24 arquivos.** Cada reescrita de parser foi conferida contra o código antigo, com resultado idêntico em todas as funções. *Correção (integração):* o gerador aleatório dessa conferência entrava em ciclo, então as "~7.000 respostas" tinham repetições. Refeita com um gerador correto: o código antes da Fase 3 e o do fim da Fase 5 dão o mesmo resultado em **48.532 respostas distintas**. No `json.js`, o `normalizeLoose` virou uma tabela de leitores, com desempenho igual dentro do ruído (−5 % a +7 %).
- **4.3:** a tela ficou em `store.js` + `texts.js` (sem DOM, testados em Node: 92 % e 99 % de linhas, agora dentro do limite de cobertura do `check`), `announcer.js`, `views/` (`card`, `kinList`, `automation`, `settings`) e `app.js`. O `dispose()` continua descartado (ver Fase 1), e `startApp` não devolve mais nada, porque ninguém usava o retorno.
- **Bug B6, achado ao mover o código:** num Kin **nunca lido**, se o Kindroid não respondesse ao Update status, o erro era apagado na hora (`null !== undefined` na comparação de `lastRunAt`). Não aparecia banner nem alerta. Corrigido, com teste.
- **Tamanho do `screen/app.js`:** passou de 68 KB (antes da Fase 3) para 85 KB. Em código (sem comentários), foi de ~51 KB para ~59 KB. Três causas: as transições do run em `state.js` entram no pacote da tela, os leitores do `json.js`, e a ligação entre as novas peças da tela; o resto são comentários. Como esse é o arquivo que o agente do Kindroid copia (§2.2), tirar os comentários do arquivo gerado (cerca de 59 KB) é uma opção, mas eles ajudam quem revisa o código publicado (decisão 7 no §6).

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

**4.4 Arquivos que vão para o Kindroid (§2.2).** A tela é empacotada num arquivo só, então dividir `src/screen/` não muda nada na instalação. Já cada módulo novo em `src/core/` é **um arquivo a mais para o agente copiar**: a divisão de `outfit.js` em 7 arquivos levaria a lista de 22 para 28. (Depois da Fase 3, a lista tem 23: `vocabulary.js` já é o primeiro módulo da opção (a).) Duas saídas (decisão 5 no §6):
- (a) dividir `src/core/` com moderação (`outfit.js` → 3 arquivos: vocabulário, limpeza das frases, leitura), mantendo a lista em ~24;
- (b) empacotar também o run num arquivo gerado, como já é feito com a tela, e enviar só ele, o que deixa a lista em ~12 arquivos fixos, seja qual for a estrutura interna. Custa um gerador a mais e deixa o código do run publicado como gerado (legível, como `screen/app.js`).

**4.5 Critérios de saída da Fase 4:** nenhuma função com complexidade > 12 ou > 4 parâmetros (regras viram `error`); nenhuma função com mais de 60 linhas; `src/screen` com cobertura unitária ≥ 80 % nos módulos puros.

### Fase 5 — Clean Code e tipagem — **feita**

Resultado, em 4 blocos (5a–5d): 177 testes verdes, cobertura de 99 % das linhas, desempenho 10/10, e2e 17/17, lint e tipos sem erros. O que saiu diferente ou a mais:
- **Tipagem:** `strict: true` **sem** `noImplicitAny`, com 0 erros. O `strict` completo daria ~450 erros, 398 deles "parâmetro sem tipo": exigir JSDoc em cada parâmetro incharia o código (e o arquivo que o agente copia) sem achar bugs. Há tipos para `Settings`, `Entry`, `Status`, `KinApi`, o contexto e os resultados do run, e o estado da tela.
- **Bugs que o modo estrito achou:** uma falha que não é `Error` (uma string, `null`) virava "...: undefined" na mensagem e no `status.json`. Agora há `errorMessage()`, com teste, e confirmei o comportamento antigo rodando o código anterior. Além disso, o exemplo do prompt deixou de ser lido de volta do próprio prompt por regex: o prompt é montado a partir dele, byte a byte igual. O 404 do `kin files get` agora usa `instanceof KinError`.
- **`!ok` voltou a estreitar o tipo**, então o contorno `ok === false` da Fase 1 saiu, exceto no protocolo da página (`channel.js`), onde um `ok` ausente significa sucesso. Agora há um comentário lá, porque a troca automática quase quebrou essa linha.
- **Linhas longas:** o limite de 140 colunas vale para **código**. Frases, templates e regex longas não são quebradas, porque ficariam piores de ler. Sobraram 19 linhas de código longas, corrigidas, e as que escondiam lógica ganharam nome (`canRetry`, `NOT_AN_ACTION`).
- **Regex grandes:** "não diz nada" (unknown, none, n/a, not mentioned…) estava escrito 3 vezes com diferenças pequenas; agora `nothingSaid()` monta cada uma. As novas dão resultado idêntico às antigas. *Correção (integração):* as "21.806 strings" tinham repetições (gerador aleatório em ciclo). Refeito com um gerador correto: idênticas em **44.335 strings distintas**.
- **Comentários:** os 54 comentários de fim de linha do código de produção explicam o porquê ou dão exemplos do domínio; nenhum foi removido.
- O `screen/app.js` gerado está em **~90 KB**, por causa dos tipos JSDoc (ver decisão 7).

1. JSDoc `@typedef` para `Settings`, `Status`, `Entry`, `Reading`, `Sleep`, `Dream`, `AskResult` (união discriminada por `ok`), `KinApi` (o contrato injetado em `runProgram`); `@param` em todas as funções exportadas.
2. `jsconfig` com `strict: true` (ou ao menos `strictNullChecks`) e **0 erros** no `npm run typecheck`.
3. Nomes: `e`, `p`, `s`, `d`, `r` em funções longas viram `entry`, `parsed`, `sleepAnswer`, `dreamAnswer`, `reading`.
4. Linhas: limite de 140 colunas no lint; as ~100 linhas acima de 160 colunas (principalmente regex e expressões ternárias encadeadas) são quebradas em constantes nomeadas.
5. Regex grandes (`GOING_TO_VERB`, `PT_WORDS`, `NO_PLACE`) montadas a partir de listas com nome, como `EN_PREP` já faz.
6. Comentários: manter os que explicam *por quê* (são bons); remover os que repetem o código.

### Fase 6 — Desempenho — **feita**

Resultado: 181 testes verdes e **nenhum pendente**: os 3 testes do O1, escritos na Fase 0, agora passam. Desempenho 12/12, e2e 18/18. Medidas com o `node main.js` real e um `kin` rodando como processo à parte, como no Kindroid:

| Medida | Antes | Depois |
| --- | --- | --- |
| Início parado / pausado / sem Kin | 3 chamadas `kin` (com o `kin end`), 164 ms | **2 chamadas, 112 ms (−32 %)** |
| Início rodando, nada devido | 3 chamadas, 142 ms | 3 chamadas, 150 ms (igual, dentro do ruído) |
| Update status: leituras simultâneas | 1 (uma depois da outra) | **2 (juntas)** |
| Uma renderização completa da tela | não medido | **2,4 ms** (o teste falha acima de 16 ms) |

O que saiu diferente ou a mais:
- **O1/O2:** um início agendado não pode ler os dois arquivos em paralelo, porque só sabe se precisa do `status.json` depois de ler o `settings.json`. Para ele, economizar uma chamada nos inícios parados vale mais que ganhar uma latência nos que rodam. A ação da tela, que sempre precisa dos dois, lê em paralelo. Um gatilho desconhecido agora termina sem ler nada.
- **O3** foi feito na Fase 1 (B4); **O5** (minificar) foi descartado no §2.2.
- **A mais:** `tests/perf/run.test.js` mede o início inteiro (`node main.js`), que é o que o Kindroid cobra 96 vezes por dia, para que um import pesado ou uma chamada a mais no futuro não passem despercebidos.

| # | Otimização | Ganho esperado | Como verificar |
| --- | --- | --- | --- |
| ~~O1~~ | **Desfeito na integração** (ver abaixo): no início agendado, ler `settings.json` primeiro e só ler `status.json` se estiver rodando e com Kin | Inícios parados/pausados: 2 → **1** chamada `kin` (o caso mais comum, 96 vezes por dia) | teste de custo por run |
| O2 | Quando os dois arquivos forem necessários, lê-los em paralelo (`Promise.all`) | −1 latência de chamada por início com leitura devida | teste com `kin` fake com atraso fixo |
| O3 | Limite de tamanho da resposta (1.4) e regex com âncora/limite em `normalizeLoose` | elimina o pior caso quadrático (243 ms → < 10 ms em 128 KB) | `tests/perf.test.js` |
| O4 | Tela: manter o "não renderiza se `status.json` não mudou"; medir o `render()` completo no e2e (`performance.now`) e falhar acima de 16 ms | renderização sem travar a rolagem | e2e |
| ~~O5~~ | ~~Minificar `screen/app.js`~~ — **descartado** (§2.2): o agente do Kindroid copia os arquivos, e linhas gigantes são as mais fáceis de corromper | — | — |

Não otimizar o que já é rápido (`parseReading`, fusos): o custo está nas chamadas ao Kindroid.

### Integração da linha de produção (até a 0.6.0) — **feita**

A refatoração partiu de `4b10472`. O app em produção (beta 1.1, `7afd8c7`) e a 0.6.0 (`afc5414`) estavam em outra linha, `claude/pensive-noether-c7dwbw`, com 17 commits que mudam comportamento nos mesmos arquivos. Por decisão sua, ela foi integrada por **merge** (`d49478a`), com o comportamento dela valendo, recolocado na estrutura refatorada:

- **Motor:** pergunta como diretiva fora do personagem e uma segunda tentativa com correção na mesma execução; a última frase conhecida fica (`carryOver`); contar o visual ao Kin por escolha (`tellLook`); o sonho só é contado por escolha e é apagado depois de um dia ou do Stop (`forgetOld`); a versão gravada no `status.json`; a linha do log no relógio da pessoa; `kin files put` com o conteúdo no stdin (como Kin Bank e Planner, confirmado no Kindroid).
- **Leitura:** as revisões de local, roupa, pose/ação, cabelo e maquiagem entraram em `phrases.js` e `outfit.js`. Comparadas com o `outfit.js` deles em **34.060 respostas distintas**: resultado idêntico, exceto onde corrigem dois defeitos que eles tinham:
  - **B7:** um Kin que agrupa a roupa (`{"outfit": {...}}`) e diz que está sem roupa fazia a leitura lançar uma exceção. A execução inteira falhava em 126 respostas distintas do corpus. O defeito veio depois da beta 1.1, então não está em produção.
  - **Ponto duplo:** "Lying in bed reading.." quando a pose vinha numa lista com ponto final dentro.

  Há testes de regressão para os dois.
- **Tela:** marcas "seen …", os cartões **Current look** e **Dreams** à vista, a versão em Settings e o aviso de versões diferentes, nenhuma linha para rosto sem maquiagem.
- **O1 desfeito:** apagar um sonho antigo "em até um início" (requisito da revisão da App Library) exige ler o `status.json` em todo início, mesmo parado. Requisito vale mais que economia. Agora todo início lê os dois arquivos **em paralelo** (antes só a ação fazia isso); os testes de custo registram isso.
- **Decisão 7:** a linha de produção limita `screen/app.js` a 80.000 caracteres. O build agora tira as linhas que são só comentário (101 KB → 71 KB); as fontes continuam comentadas.
- **A lista de instalação** tem 24 arquivos, e o `COMO-INSTALAR.md` (vindo da outra linha) foi atualizado. Um teste dela garante que a lista bate com os arquivos que o app usa.
- **Coincidências:** a outra linha também tinha removido o `parseOutfit` e desexportado as mesmas constantes que a Fase 2. Os dois lados chegaram ao mesmo resultado.
- **Testes:** as suítes das duas linhas passam juntas (254 unitários, 12 de desempenho, 22 de navegador).

### Fusão de consistência — **feita**

Depois de várias conversas e linhas paralelas, o projeto foi alinhado para contar uma história só:

- **Um jeito de instalar.** O `scripts/pack.mjs` (tarball que nunca foi usado) saiu. O `COMO-INSTALAR.md` agora é gerado por `scripts/build-install.mjs`: a lista dos 24 arquivos sai dos imports de `main.js` e de `screen/index.html`, e as mensagens são as do método que funcionou (perguntar o manifesto, seguir os imports, seguir a tela, copiar, reler a cópia, testar). `npm run install-prompt` imprime as mensagens com o commit e o tamanho e o SHA-256 de cada arquivo. A ideia do branch `claude/vigilant-gauss-fd2spi` (o pacote de mensagens com a tabela de conferência) entrou aqui.
- **Conferir que a cópia veio inteira:** a última linha do `screen/app.js` é `// end of Clotheskin screen <versão>`, e o passo 5 pede essa linha.
- **A versão Mini, abandonada,** não deixou mais rastros: as duas imagens dela em `prints/` saíram.
- **Os textos batem com o código:** README (instalação, layout, o que cada início lê), o roteiro com o Kin real (instalar pelo `COMO-INSTALAR.md`).
- **`CLAUDE.md`** guarda as regras para qualquer conversa nova: `main` é a fonte da verdade, um jeito de instalar, os arquivos gerados, as verificações antes de entregar, a língua de cada coisa.

### Fase 7 — Fechamento

1. ~~Atualizar o `README.md` e a instalação~~ (feito na fusão de consistência).
2. Regras de complexidade e de cobertura viram bloqueantes no CI (pendente: não há CI).
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
| O agente do Kindroid esquecer ou alterar um arquivo ao copiar | lista gerada a partir dos imports, links fixados num commit, SHA-256 por arquivo e identificador de build visível na tela (0.10) |
| Divisão grande demais num commit só | um commit por passo; nenhum commit mistura mover código e mudar comportamento |

## 6. Decisões pendentes (para você)

1. ~~**`devDependencies`**~~ — aprovado, desde que compatível com o Workshop: ficam em `tools/` (§2.1).
2. **Formatação:** reformatar tudo de uma vez com Prettier (um commit só, grande e mecânico) ou só aplicar o limite de colunas nos trechos tocados?
3. **CI:** criar o workflow do GitHub Actions neste repositório?
4. **Idioma:** manter código, comentários e mensagens em inglês (como hoje) e só a documentação de testes em português?
5. **Arquivos do run (§4.4):** (a) dividir `src/core/` com moderação, ou (b) empacotar o run num arquivo gerado, como a tela? Recomendo (a) agora e (b) só se a cópia pelo agente se mostrar pouco confiável.
6. **Instalação (§2.2):** o agente do Kindroid baixa cada link (cópia exata) ou lê e reescreve o conteúdo? E ele tem um terminal para conferir SHA-256? Isso decide se a conferência de hashes vai no prompt ou fica só o identificador de build na tela.
7. ~~**Comentários no `screen/app.js` gerado**~~ — resolvido na integração: a linha de produção tem um teste que limita o arquivo a 80.000 caracteres. O build tira as linhas que são só comentário (71 KB); as fontes em `src/` continuam comentadas.

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
