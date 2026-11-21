# Clotheskin Mini: passo a passo

A mesma receita do Status Bar: o agente do Kindroid copia os arquivos e você testa.
Desta vez são **3 arquivos** e só uma peça nova: o botão **Ler agora** pergunta ao Kin.

| Arquivo | O que faz |
| --- | --- |
| `kin.json` | o manifesto: a tela, a ação `read_now` e a permissão de ler o chat (2 dias) |
| `screen/index.html` | a tela: escolher o Kin, o botão, as 3 linhas e o Diagnóstico |
| `main.js` | o programa: pergunta ao Kin, salva `status.json` e termina |

Ainda não tem: atualização automática, cabelo e maquiagem, sono e sonho. Essas partes entram só depois que isto funcionar.

---

## Passo 1: colar no agente do Kindroid

Mande esta mensagem ao agente e, logo abaixo, cole o conteúdo dos 3 arquivos:

```
Create a new app called "Clotheskin Mini" with exactly these 3 files.
Copy them exactly as they are, character for character. Do not rewrite, shorten,
translate or "improve" anything, and do not add files.
After creating it, tell me if anything in kin.json was rejected, and the exact error.

=== kin.json ===
(cole aqui)

=== main.js ===
(cole aqui)

=== screen/index.html ===
(cole aqui)
```

## Passo 2: permitir e ligar o Kin

1. Apps → **Waiting for you** → **Allow**. Ele pede para ler o chat, por isso espera a sua permissão.
2. Nas configurações do app → **Kins** → marque o Kin do roleplay.

## Passo 3: testar

Abra a tela do Clotheskin.

| O que aparece | O que significa |
| --- | --- |
| A lista mostra o seu Kin | a tela conversa com o Kindroid ✅ |
| "Nenhum Kin ligado ao app" | falta o Passo 2, item 2 |
| "O Kindroid não respondeu à tela" | a tela não conectou: me mande o Diagnóstico |

Aperte **Ler agora** e espere até 1 minuto.

| O que aparece | O que significa |
| --- | --- |
| Local / Fazendo / Vestindo preenchidos | **funcionou** 🎉 |
| "Falhou: kin ask: …" | o Kin não pôde ser perguntado: me mande a frase inteira |
| "Falhou: kin files: …" | a pergunta funcionou, mas não salvou |
| "The Kin answered, but not in the three lines" | funcionou, mas o Kin respondeu em roleplay: abra o Diagnóstico e me mande a resposta |
| Fica em "Perguntando…" para sempre | a ação não rodou: me mande o Diagnóstico |

**Em qualquer erro:** abra **Diagnóstico** (no fim da tela), tire um print e me mande junto com a mensagem. Com isso eu sei exatamente qual peça falhou.

---

## Depois que funcionar (um passo de cada vez)

1. Atualização automática a cada X minutos, com Start e Pause
2. Cabelo e maquiagem
3. Sono e sonho

Cada passo é uma mensagem curta ao agente, só com o que muda.
