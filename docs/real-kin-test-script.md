# Roteiro do primeiro teste com um Kin de verdade

Este arquivo é gerado por `node scripts/build-test-script.mjs`. As frases "O cartão deve mostrar" são calculadas pelo código do app a partir da resposta que um Kin bem-comportado daria, então elas acompanham o app.

## Antes de começar

1. Envie o app: `node kin.mjs send .` (passos completos no README). No Kindroid, em **Apps → Waiting for you**, clique em **Allow**.
2. Nas configurações do app, em **Kins**, marque o Kin do teste (de preferência um que você já conheça bem).
3. Abra o app e selecione o Kin. Em cada passo abaixo: escreva a fala no chat, deixe o Kin responder, aperte **Update status** e compare.
4. Anote tudo na tabela de resultados no final. Cole a resposta do Kin e as três frases do cartão.

## Duas coisas que valem para todos os passos

- **O Kin vê o chat do último dia** (`chat:read:1`). O cartão descreve o estado *no fim do chat recente*, então ele **não zera** entre um passo e outro: cada passo parte do que os anteriores deixaram. Só um chat novo começa em branco (passo S13).
- Se o cartão mostrar um **erro em vermelho**, o Kin não respondeu no formato esperado. Aperte **Try again** uma vez. Anote o texto do erro: ele diz se o problema foi JSON inválido, tipo errado ou falha ao chamar o Kin.

## Passos

### S1. Base: tudo de uma vez

**Você escreve:** Oi! Me conta onde você está agora, como você está posicionado(a), o que está fazendo e o que está vestindo.

**O Kin deve:** O Kin cita lugar, posição, uma atividade e roupas.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | Sitting on the sofa, drinking coffee. |
| Outfit | Wearing a leather jacket, a white shirt and blue jeans. |

**Confira:**
- Cada linha do cartão bate com o que o Kin escreveu.
- O cartão está em **inglês** mesmo com a conversa em português.
- A jaqueta (peça de fora) vem antes da camisa na frase.

**Se falhar:** Linha em branco ou em português → o Kin não respondeu no formato (veja a mensagem de erro do cartão). Peça errada → anote qual.

### S2. Tirar uma peça

**Você escreve:** *sorri* Está calor aqui, né? Tira a jaqueta e pendura na cadeira.

**O Kin deve:** O Kin tira a jaqueta.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | Sitting on the sofa, hanging a jacket on a chair. |
| Outfit | Wearing a white shirt and blue jeans. |

**Confira:**
- A jaqueta **sumiu** da roupa.
- A camisa e a calça continuam.

**Se falhar:** Jaqueta ainda aparece → o Kin ignorou "something taken off is no longer worn" (prompt).

### S3. Um plano não é um lugar nem uma ação

**Você escreve:** Mais tarde você vai ao mercado, né?

**O Kin deve:** O Kin confirma que vai, **mais tarde**, mas ainda está onde estava.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | Sitting on the sofa. |
| Outfit | No outfit described in the recent chat. |

**Confira:**
- O local **não** muda para o mercado.
- A ação **não** vira "going to the market".

**Se falhar:** Local = mercado → o Kin tratou o plano como fato (prompt). Ação com "going to" → veja se o app deixou passar (código).

### S4. Mudar de cômodo

**Você escreve:** Vai até a cozinha buscar um copo d’água pra mim.

**O Kin deve:** O Kin vai à cozinha e serve água.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the kitchen. |
| Pose and action | Standing at the counter, pouring a glass of water. |
| Outfit | No outfit described in the recent chat. |

**Confira:**
- O local mudou para a cozinha.
- A pose e a ação mudaram junto.

**Se falhar:** Local antigo → o Kin não aplicou a mudança mais recente.

### S5a. A caminho (ainda não chegou)

**Você escreve:** Pega o ônibus até o hospital, seu turno começa já já.

**O Kin deve:** O Kin está no ônibus.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | On the bus to the hospital. |
| Pose and action | Sitting by the window, looking out of the window. |
| Outfit | No outfit described in the recent chat. |

**Confira:**
- O local diz que está **no ônibus a caminho**, não no hospital.

**Se falhar:** Local = hospital antes da hora → o Kin confundiu destino com lugar atual.

### S5b. Chegou

**Você escreve:** Chegou no hospital?

**O Kin deve:** O Kin diz que chegou.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | At the hospital. |
| Pose and action | Standing at the entrance, showing a badge. |
| Outfit | No outfit described in the recent chat. |

**Confira:**
- Agora sim o local é o hospital.
- O "ônibus" desapareceu.

**Se falhar:** Ainda "on the bus" → o lugar antigo não foi substituído (prompt: "a place you have left…").

### S6. Mudar só a pose

**Você escreve:** Levanta e vai até a janela olhar lá fora.

**O Kin deve:** O Kin se levanta e olha pela janela.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | Standing by the window, looking outside. |
| Outfit | No outfit described in the recent chat. |

**Confira:**
- A pose passa de sentada para em pé, com o ícone de pessoa em pé.
- O local **não** muda.

**Se falhar:** Pose na linha do local, ou o contrário → anote o texto exato (o app tenta corrigir, mas veja o que sobrou).

### S7. Ação terminada e ação planejada

**Você escreve:** Terminou o café? E o que vai fazer agora?

**O Kin deve:** O Kin diz que **terminou** o café e que **vai ler** um livro (ainda não começou).

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | Sitting on the sofa. |
| Outfit | No outfit described in the recent chat. |

**Confira:**
- A ação **não** é "drinking coffee" (terminou).
- A ação **não** é "reading" (é plano).

**Se falhar:** Uma das duas aparece → o Kin não separou passado/plano/presente (prompt) ou o app deixou passar (código).

### S8. Camadas e ordem (o exemplo do briefing)

**Você escreve:** Coloca uma camisa branca perfumada, uma jaqueta de couro por cima e uma calça jeans azul.

**O Kin deve:** O Kin descreve exatamente essas peças.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | Standing, adjusting a collar. |
| Outfit | Wearing a leather jacket, a perfumed white shirt and blue jeans. |

**Confira:**
- Frase de roupa: jaqueta, depois camisa perfumada, depois a calça, com vírgulas e "and".
- A palavra "perfumed" aparece.

**Se falhar:** Ordem diferente ou peça faltando → anote o que o Kin respondeu.

### S9. Acessórios e bolsa

**Você escreve:** Põe seus óculos, o colar de prata e pega a mochila marrom.

**O Kin deve:** O Kin põe óculos, colar e pega a mochila.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | No pose or action described in the recent chat. |
| Outfit | Wearing a white shirt and blue jeans, with round glasses, a silver necklace and a brown backpack. |

**Confira:**
- Os acessórios vêm depois da roupa, com "with".
- A mochila entra junto dos acessórios.

**Se falhar:** Óculos ou mochila como roupa → anote (o app não separa depois, só o Kin escolhe o campo).

### S10. Roupa de outra pessoa não é do Kin

**Você escreve:** Hoje eu estou de **vestido vermelho** e chinelo, haha.

**O Kin deve:** O Kin comenta, mas continua com as roupas dele.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | No pose or action described in the recent chat. |
| Outfit | Wearing a white shirt and blue jeans. |

**Confira:**
- O vestido vermelho **não** aparece no cartão do Kin.

**Se falhar:** Vestido vermelho aparece → o Kin descreveu você (prompt: "Describe only yourself").

### S11. Roupa hipotética

**Você escreve:** E se amanhã você usasse um vestido preto longo?

**O Kin deve:** O Kin imagina a roupa, sem vesti-la.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | No pose or action described in the recent chat. |
| Outfit | Wearing a white shirt and blue jeans. |

**Confira:**
- O vestido preto **não** aparece.

**Se falhar:** Vestido aparece → o Kin tratou o hipotético como fato (prompt).

### S12. Kin respondendo em português

**Você escreve:** Fala só em português agora: onde você está e o que veste?

**O Kin deve:** O Kin responde a **conversa** em português.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | No pose or action described in the recent chat. |
| Outfit | Wearing a white shirt and blue jeans. |

**Confira:**
- O cartão continua em **inglês**.
- Nenhuma palavra em português nas frases.

**Se falhar:** Texto em português no cartão (ex.: "Na cozinha.") → o Kin respondeu o JSON em português, apesar de "English only". O app mostra como veio.

### S13. Conversa nova, sem nada dito

**Você escreve:** (Abra um chat **novo** com o Kin e só diga:) Oi, tudo bem?

**O Kin deve:** Nada sobre lugar, pose, ação ou roupa.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | No location described in the recent chat. |
| Pose and action | No pose or action described in the recent chat. |
| Outfit | No outfit described in the recent chat. |

**Confira:**
- As três linhas dizem "No … described in the recent chat."
- Sem erro, sem invenção.

**Se falhar:** O Kin inventou um lugar ou roupa → "never guess" não funcionou (prompt).

## Medidas a anotar (uma vez)

- **Tempo** entre apertar **Update status** e a frase aparecer. Anote 3 leituras.
- **Custo** em créditos de uma leitura, se o Kindroid mostrar. O guia não diz quanto custa um `kin ask`.
- **Cliques repetidos:** aperte **Update status** duas vezes seguidas. Deve haver **uma** leitura só (o botão fica em "Reading…").
- **Vazamento:** depois de 5 ou 6 leituras, olhe o chat e a memória do Kin. Não deve haver JSON, pergunta do rastreador nem respostas em inglês que você não pediu. Pergunte ao Kin: "Você lembra de ter me descrito em formato de dados?". A resposta deve ser que não.
- **Dois Kins com o mesmo nome** (se tiver): selecione um, aperte **Update status**, troque para o outro no meio da leitura. O resultado deve aparecer só no primeiro.

## Como classificar uma falha

| Tipo | Sinal | Onde corrigir |
|---|---|---|
| **A. Formato** | erro vermelho no cartão ("not valid JSON", "must be a text") | prompt (exemplo, instruções de formato) |
| **B. Interpretação** | o Kin respondeu JSON válido mas com o fato errado (plano virou fato, lugar antigo ficou, roupa de outra pessoa) | prompt (`screen/src/core/prompt.js`) |
| **C. App** | o JSON do Kin estava certo e o cartão mostrou outra coisa | código (`screen/src/core/outfit.js`) |
| **D. Plataforma** | nada acontece, erro de permissão, `kin ask` falha, o cartão não recebe a frase | suposições do README (`run/kin-cli.js`, grants) |

## Tabela de resultados

| Passo | Resultado (OK / parcial / falhou) | Tipo | Resposta do Kin (cole) | Cartão (cole as 3 frases) |
|---|---|---|---|---|
| S1 |  |  |  |  |
| S2 |  |  |  |  |
| S3 |  |  |  |  |
| S4 |  |  |  |  |
| S5a |  |  |  |  |
| S5b |  |  |  |  |
| S6 |  |  |  |  |
| S7 |  |  |  |  |
| S8 |  |  |  |  |
| S9 |  |  |  |  |
| S10 |  |  |  |  |
| S11 |  |  |  |  |
| S12 |  |  |  |  |
| S13 |  |  |  |  |

