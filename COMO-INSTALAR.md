# Clotheskin: como instalar e atualizar no Kindroid

Este arquivo é gerado por `npm run build` (`scripts/build-install.mjs`): não edite à mão. Versão do app: **0.6.0**.

## O jeito que funciona

O agente do Workshop abre cada arquivo pelo endereço *raw* do GitHub, **um por vez**, no mesmo chat do Workshop, em etapas. A pasta local não fica acessível ao agente, e baixar o repositório inteiro dá 403.

O endereço aponta para um **commit**, não para um branch: assim o agente pega o motor, a tela e o manifesto da mesma versão, sem cache velho do GitHub.

- **Mensagens prontas, com o commit preenchido:** depois do push, rode `npm run install-prompt` (ou peça ao Claude para rodar). Ele imprime as mensagens abaixo com o commit, as respostas esperadas e o tamanho e o SHA-256 de cada arquivo.
- **À mão:** troque `<commit>` pelo hash completo do commit em cada mensagem.

## Os 24 arquivos que o Kindroid usa

```
kin.json
package.json
main.js
run/kin.js
run/program.js
src/core/constants.js
src/core/format.js
src/core/json.js
src/core/outfit.js
src/core/phrases.js
src/core/prompt.js
src/core/schedule.js
src/core/sleep.js
src/core/state.js
src/core/text.js
src/core/time.js
src/core/vocabulary.js
screen/app.js
screen/assets/icon.svg
screen/index.html
screen/styles.css
screen/theme.css
sample/settings.json
sample/status.json
```

O resto do repositório (`tests/`, `dev/`, `scripts/`, `docs/`, `tools/`, `prints/`) é só para desenvolver e testar: o Kindroid não precisa. **Para atualizar, mande sempre os 24 juntos**: eles dependem uns dos outros, e uma mistura de arquivos novos e velhos pode quebrar o app.

## As mensagens para o agente, em ordem

### 1. Conferir que ele lê o manifesto (sem dar a resposta no prompt)

```
Open this raw GitHub file: https://raw.githubusercontent.com/Varg67/Clotheskin/<commit>/kin.json. What are the exact values of run.timeout and triggers[0].cron? Only inspect the file for now.
```

**Resposta certa:** `2m` e `*/15 * * * *` (e o run entry `node main.js`). Outra resposta: ele está lendo outra coisa, talvez uma cópia antiga que já está no Workshop.

### 2. Seguir o motor pelos imports

```
Starting from the same raw GitHub revision, open main.js and follow its local imports. Which file and function handle a manual status update? List the files you successfully opened.
```

**Resposta certa:** a função `onAction` em `run/program.js`, e os 15 arquivos: `main.js`, `run/kin.js`, `run/program.js`, `src/core/constants.js`, `src/core/format.js`, `src/core/json.js`, `src/core/outfit.js`, `src/core/phrases.js`, `src/core/prompt.js`, `src/core/schedule.js`, `src/core/sleep.js`, `src/core/state.js`, `src/core/text.js`, `src/core/time.js`, `src/core/vocabulary.js`.

### 3. Seguir a tela

```
Open screen/index.html from the same revision and follow its local scripts, stylesheets, and assets. Trace the Update status button. Which file handles the click, and what action and payload does it send to Kindroid?
```

**Resposta certa:** `screen/app.js`; a ação `update_status` com `{ kin: <id do Kin>, op: "read" }`.

### 4. Copiar para o projeto do Workshop

```
Copy the existing Clotheskin app from the verified raw GitHub revision into the current Workshop project. Copy exactly these 24 files, each from https://raw.githubusercontent.com/Varg67/Clotheskin/<commit>/<path>, saved at the same path, exactly as downloaded: do not rewrite, shorten or "improve" anything. Keep kin.json at the project root.

kin.json
package.json
main.js
run/kin.js
run/program.js
src/core/constants.js
src/core/format.js
src/core/json.js
src/core/outfit.js
src/core/phrases.js
src/core/prompt.js
src/core/schedule.js
src/core/sleep.js
src/core/state.js
src/core/text.js
src/core/time.js
src/core/vocabulary.js
screen/app.js
screen/assets/icon.svg
screen/index.html
screen/styles.css
screen/theme.css
sample/settings.json
sample/status.json

Apply the files now. If a file fails to copy, report its path and the exact error.
```

**Resposta certa:** que copiou os arquivos, ou o caminho e o erro exato de cada um que falhou.

### 5. Conferir a cópia, relendo do projeto do Workshop (não do GitHub)

```
Now reopen these files from the Workshop project, not from GitHub, and report: the run entry, screen entry and schedule in kin.json; the value of APP_VERSION in src/core/constants.js; and the exact last line of screen/app.js. Then open the screen in Workshop preview.
```

**Resposta certa:** `node main.js`, `screen/index.html`, `*/15 * * * *`; `APP_VERSION` = `0.6.0`; última linha `// end of Clotheskin screen 0.6.0`. Outra última linha: o `screen/app.js` foi cortado na cópia (repita o passo 4 só com ele).

### 6. Testar dentro do Kindroid

1. Apps → **Waiting for you** → **Allow** (o app lê o chat, por isso espera a sua permissão).
2. Configurações do app → **Kins** → marque os Kins.
3. Abra a tela, escolha o Kin do roleplay e aperte **Update status**. Em **Settings**, no fim, aparece "Clotheskin 0.6.0". Se só uma parte foi atualizada, a tela mostra um aviso amarelo no topo: *"Some of Clotheskin's files are from another update… Update all the files together."*
4. A automação merece um teste próprio: aperte **Start** e deixe chegar uma leitura programada, sem apertar o botão.

## O log do Workshop

O log mostra cada pergunta ao Kin e a resposta dele. O que é normal:

| No log | Significa |
| --- | --- |
| `Asked your Kin: [DIRECTIVE — OUT OF CHARACTER …` | a pergunta da leitura |
| `Your Kin said: {"location":…}` | uma resposta certa |
| `[DIRECTIVE — OUT OF CHARACTER] Your previous reply … could not be used` | a primeira resposta veio em roleplay, e o app perguntou de novo |
| `Nothing to do yet: next update around 3:27 AM.` | o início a cada 15 minutos, sem nada para fazer (não pergunta nada ao Kin) |
| `Automatic update is stopped.` | o Stop está ligado |

Se a pergunta no log começar com `You are …` em vez de `[DIRECTIVE …`, o Kindroid ainda está com uma versão antiga.
