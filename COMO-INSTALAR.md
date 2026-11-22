# Clotheskin: como instalar e atualizar no Kindroid

## O jeito que funciona: o raw do GitHub

O agente do Workshop baixa cada arquivo direto do GitHub, exatamente como está. Assim ele não redigita nem "melhora" nada.

Endereço de cada arquivo:

```
https://raw.githubusercontent.com/Varg67/Clotheskin/<branch>/<arquivo>
```

Troque `<branch>` pelo branch da versão que você quer (hoje, `claude/pensive-noether-c7dwbw`).

## Os 22 arquivos que o Kindroid usa

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
src/core/prompt.js
src/core/schedule.js
src/core/sleep.js
src/core/state.js
src/core/text.js
src/core/time.js
screen/index.html
screen/app.js
screen/styles.css
screen/theme.css
screen/assets/icon.svg
sample/settings.json
sample/status.json
```

O resto do repositório (`tests/`, `dev/`, `scripts/`, `docs/`, `prints/`) é só para desenvolver e testar: o Kindroid não precisa.

## Mensagem para o agente

```
Update the Clotheskin app from GitHub. For each file below, download it from
https://raw.githubusercontent.com/Varg67/Clotheskin/<branch>/<file>
and save it at the same path, exactly as downloaded. Do not rewrite, shorten
or "improve" anything. Then tell me if anything was rejected, with the exact error.

(cole aqui a lista dos arquivos)
```

**Para atualizar**, dá para mandar só os arquivos que mudaram. Na dúvida, mande todos: não faz mal.

## Depois de instalar

1. Apps → **Waiting for you** → **Allow** (o app lê o chat, por isso espera a sua permissão).
2. Configurações do app → **Kins** → marque os Kins.
3. Abra a tela, escolha o Kin do roleplay, aperte **Update status** e depois **Start**.

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
