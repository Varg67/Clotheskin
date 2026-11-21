# Clotheskin completo: como instalar no Kindroid

## O que foi corrigido

Comparando com o Kin Bank e o Planner, que funcionam, o Clotheskin **salvava arquivos do jeito errado**:

- **Antes:** `kin files put status.json /tmp/arquivo` (passava o caminho de um arquivo)
- **Agora:** `kin files put status.json`, com o conteúdo pela entrada, igual aos dois apps

Sem essa correção, nenhuma leitura era salva, então a tela nunca mostrava nada.

## O pacote

`dist/clotheskin.tar.gz` (52 KB) tem só o que o Kindroid roda, no mesmo formato dos pacotes do Planner e do Kin Bank:

```
kin.json  package.json  main.js
run/        o programa (pergunta ao Kin, salva, sono e sonho)
src/core/   a lógica compartilhada
screen/     a tela bonita (index.html, app.js, styles.css, theme.css, assets/)
sample/     exemplo para a figura na App Library
```

Para gerar de novo: `npm run build && npm run pack`.

## Instalar

**Se o agente aceita arquivo:** mande o `clotheskin.tar.gz` e escreva:

```
Install this app package exactly as it is. Do not rewrite, shorten or "improve"
any file. It has the same layout as Kin Bank and Planner.
After installing, tell me if anything in kin.json was rejected, and the exact error.
```

**Se ele não aceita arquivo:** me avise. Montamos a instalação em partes, porque o `screen/app.js` tem 66 mil caracteres, e é fácil o agente cortar um texto grande desses.

Depois:
1. Apps → **Waiting for you** → **Allow**. O app pede para ler o chat, por isso espera a sua permissão.
2. Configurações do app → **Kins** → marque o Kin do roleplay.

## Testar, em ordem

| # | Faça | Se der certo | Se der errado, me mande |
| --- | --- | --- | --- |
| 1 | Instalar | o app aparece | o erro exato do agente (principalmente sobre `grants`, `triggers` ou `schedule`) |
| 2 | Abrir a tela | aparece **Select a Kin** com o seu Kin | um print ("Could not reach Kindroid" ou tela branca) |
| 3 | Tocar no Kin e em **Update status** | aparecem Location, Pose and action e Outfit | a mensagem vermelha da tela |
| 4 | **Start**, esperar 30 min | a leitura atualiza sozinha | o texto embaixo da régua |

## O que ainda não sabemos

Três peças do Clotheskin **não aparecem** no Kin Bank nem no Planner, então ainda não foram provadas:

1. **`kin ask`**: perguntar ao Kin por fora do chat
2. **`grants: kin:read, chat:read:2`**: a permissão para ler o chat
3. **`triggers: schedule`**: rodar sozinho a cada 15 minutos

Se o Kindroid recusar uma delas, o teste de cima mostra qual foi. Aí a gente troca só aquela peça, sem perder a tela.
