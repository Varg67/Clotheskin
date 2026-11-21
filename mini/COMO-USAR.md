# Clotheskin: passo a passo

## Por que mudou

O Kin Bank e o Planner funcionam, e o nosso não. Comparando os três, o Clotheskin fazia 3 coisas que nenhum app que funciona faz:

| | Kin Bank e Planner (funcionam) | Clotheskin antigo |
| --- | --- | --- |
| Quem preenche os dados | **o próprio Kin, no chat**, chamando uma ação (`by: ["kin","user"]`) | o app perguntava ao Kin com `kin ask` |
| Permissões | nenhuma para ler o chat | `kin:read` e `chat:read:2` |
| Roda sozinho? | não, só quando alguém usa | a cada 15 minutos (`schedule`) |
| Salvar arquivo | `kin files put <arquivo>` com o conteúdo pela entrada | `kin files put <arquivo> /tmp/arquivo` ❌ |

A última linha provavelmente era um erro de verdade. Os dois apps que funcionam mandam o conteúdo pela entrada; o nosso mandava o caminho de um arquivo.

**Agora o Clotheskin funciona como o Kin Bank.** O Kin, no chat, usa a ação `update_look` quando muda de lugar ou de roupa, do mesmo jeito que o Kin Bank usa `record_transaction` quando compra algo. A tela mostra o que ele salvou. O Kin também pode consultar a própria roupa com `get_look` para não se contradizer.

## Os 4 arquivos

| Arquivo | O que faz |
| --- | --- |
| `kin.json` | o manifesto: a tela e as ações `update_look` e `get_look` |
| `package.json` | uma linha, igual à do Kin Bank |
| `main.js` | o programa das ações: lê e salva `looks/kin-<id>.json` |
| `screen/index.html` | a tela: escolher o Kin, ver o que ele está usando, editar à mão, e o Diagnóstico |

---

## Passo 1: colar no agente do Kindroid

```
Create a new app called "Clotheskin" with exactly these 4 files.
Copy them exactly as they are, character for character. Do not rewrite, shorten,
translate or "improve" anything, and do not add files.
After creating it, tell me if anything was rejected, and the exact error.

=== kin.json ===
(cole aqui)

=== package.json ===
(cole aqui)

=== main.js ===
(cole aqui)

=== screen/index.html ===
(cole aqui)
```

## Passo 2: ligar o Kin

Nas configurações do app → **Kins** → marque o Kin do roleplay.

## Passo 3: testar a tela (sem o Kin)

1. Abra a tela do Clotheskin. A lista deve mostrar o seu Kin, e a mensagem deve ser "Ainda nada salvo".
2. Abra **Editar à mão**, escreva uma roupa e aperte **Salvar**. A roupa deve aparecer no cartão.

Se isso funcionar, a tela, as ações e os arquivos estão todos certos.

## Passo 4: testar com o Kin

No chat, escreva para o Kin:

> Use Clotheskin to update your look.

Depois, abra a tela e aperte **Atualizar**. Deve aparecer o que ele salvou, com "pelo Kin".

Teste também:
- Peça para ele trocar de roupa no roleplay e veja se ele atualiza sozinho.
- Pergunte "what are you wearing? check Clotheskin" para ver se ele usa o `get_look`.

## Se der erro

| O que aparece | O que significa |
| --- | --- |
| "Nenhum Kin ligado ao app" | falta o Passo 2 |
| "O Kindroid não respondeu à tela" | a tela não conectou |
| "Falhou: …" ao salvar | a ação rodou mas falhou: a frase diz por quê |
| O Kin diz que não consegue usar | as ações não chegaram até ele no chat |

Em qualquer erro: abra o **Diagnóstico** no fim da tela, tire um print e me mande junto com a mensagem.

---

## Depois que funcionar (um passo de cada vez)

1. Maquiagem e acessórios separados
2. Histórico das roupas do dia
3. Sono e sonho (o Kin salva quando dorme e quando acorda, do mesmo jeito)
