# Roteiro do primeiro teste com um Kin de verdade

Este arquivo é gerado por `node scripts/build-test-script.mjs`. As frases "O cartão deve mostrar" são calculadas pelo código do app a partir da resposta que um Kin bem-comportado daria, então acompanham o app.

## Antes de começar

1. **Ensaio sem tocar em nada real** (opcional, 1 minuto): `curl -fsSO https://downloads.kinusercontent.com/workshop/kin.mjs` e `npm run try`. Isso roda a execução de verdade com o `kin` oficial em modo simulação (`KIN_MOCK`) e lista cada chamada.
2. Instale o app pelo `COMO-INSTALAR.md` (as mensagens para o agente do Workshop, com o commit desta versão: `npm run install-prompt`). No Kindroid, em **Apps → Waiting for you**, clique em **Allow**.
3. Nas configurações do app, em **Kins**, marque o Kin do teste (de preferência um que você conheça bem).
4. Abra o app e escolha o Kin. Em cada passo: escreva a fala no chat, deixe o Kin responder, aperte **Update status** e compare.
5. Anote tudo na tabela do final: cole a resposta do Kin (se aparecer) e as frases do cartão.

## Três coisas que valem para todos os passos

- **O Kin vê o chat dos últimos 2 dias** (`chat:read:2`). O cartão descreve o estado *no fim do chat recente*, então **não zera** entre um passo e outro: cada passo parte do que os anteriores deixaram. Só um chat novo começa em branco (passo S13).
- **Erro em vermelho** no cartão: aperte **Try again** uma vez e anote o texto. Se houver algo entre parênteses, é o texto do próprio Kindroid: **copie exatamente**.
- **A automação roda na nuvem do Kindroid**, não no seu PC: o Kindroid inicia o app a cada 15 minutos. Fechar o painel ou desligar o PC não para as leituras; só impede você de vê-las até reabrir.

## Passos de leitura

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

### S14. Cabelo e maquiagem

**Você escreve:** Prende o cabelo num rabo de cavalo e passa um batom vermelho.

**O Kin deve:** O Kin prende o cabelo e passa o batom.

**O cartão deve mostrar** (se o Kin responder como esperado):

| Linha | Texto |
|---|---|
| Location | In the living room. |
| Pose and action | Standing by the mirror, putting on lipstick. |
| Outfit | Wearing a white shirt and blue jeans. |
| Hair | Long black hair in a ponytail. |
| Makeup | Red lipstick. |

**Confira:**
- Aparecem as linhas **Hair** e **Makeup** no cartão.
- O ícone do cabelo é o de cabelo **preso**.

**Se falhar:** Sem as linhas → o Kin não mandou "hair"/"makeup" (prompt). Em português → veja S12.

## A noite, a automação e as falhas

Estes passos verificam o que roda sozinho e o que acontece **quando algo dá errado**. Também servem para **coletar o texto real dos erros** do `kin`: o app só reconhece "arquivo ainda não existe" por um "404" e "manutenção" pelas palavras maintenance/downtime/outage, e esses textos foram supostos. Vale em todas as falhas: **as últimas frases boas continuam no cartão** e nenhum botão fica travado.

Para a automação, use a régua em **15 min** durante o teste e volte para um intervalo maior depois: cada leitura é uma pergunta ao Kin.

### N1. A noite: dormir, acordar, sonho

**Como provocar:** No chat, leve o Kin a ir dormir e combine o despertador ("Boa noite, acorda às 7h30?"). Aperte **Update status**.

**O que esperar:** Depois da leitura, o app pergunta sozinho quando o Kin acorda. Em **Automatic update** aparece "Asleep until 7:30 AM tomorrow. The dream question comes around …" e o link **Wake now**.

**Confira:**
- A pose diz que está dormindo (ex.: "Lying in bed, sleeping.").
- O horário de acordar é o que o Kin disse, no **seu** relógio.
- **Wake now** troca o botão para "Asking about the dream…" e depois aparece a linha **Last dream**.
- No chat, o Kin passa a **lembrar do sonho** durante o dia (a menos que você desligue em Settings → Dreams).

**Anote:** O que o Kin respondeu, o horário mostrado, o sonho, e se ele comentou o sonho depois no chat.

### A1. Automação com o painel fechado (o principal)

**Como provocar:** Aperte **Start** com a régua em **15 min**. Converse um pouco (mude de lugar ou de roupa), **feche o painel** e espere uns 35 minutos. Reabra.

**O que esperar:** "Last read" tem um horário de **quando o painel estava fechado**, e as frases mostram a mudança. É a prova de que a execução roda na nuvem do Kindroid.

**Confira:**
- A leitura foi feita sem o painel aberto.
- "Next update around …" bate com os quartos de hora (:00, :15, :30, :45).

**Anote:** Os horários de "Last read" ao reabrir. Se nada mudou, anote: o agendamento (cron) não está rodando.

### A2. Pause e Stop

**Como provocar:** Com a automação ligada, aperte **Pause**, espere 30 minutos, depois **Resume**. Mais tarde, aperte **Stop**.

**O que esperar:** Em Pause, "Last read" não muda. Resume continua de onde parou. Stop mostra "Stopped. Press Start to update automatically." e some a linha **Last dream** e qualquer noite.

**Confira:**
- Nada é perguntado ao Kin em Pause nem em Stop.
- A última leitura continua no cartão depois de Stop.

**Anote:** Se alguma leitura aconteceu durante Pause ou Stop (horário de "Last read").

### F1. App enviado, mas ainda sem o Allow

**Como provocar:** Envie o app e **não** clique em **Allow** em Apps → Waiting for you. Abra o app e aperte **Update status**.

**O que esperar:** Não se sabe se o Kindroid chega a executar um app sem o Allow. Se executar, o cartão mostra um erro com o texto do Kindroid entre parênteses.

**Confira:**
- Não fica em "Reading…" para sempre (no máximo uns 2,5 minutos).
- Depois do **Allow**, funciona sem reenviar.

**Anote:** O texto exato entre parênteses, ou o aviso que o Kindroid mostrar.

### F2. Fechar o painel no meio de uma leitura

**Como provocar:** Aperte **Update status** e feche o painel logo em seguida. Espere uns 30 segundos e reabra.

**O que esperar:** Ao reabrir, o cartão mostra a leitura nova (a execução gravou em status.json), sem você apertar nada.

**Confira:**
- A leitura terminou com o painel fechado.
- Só uma pergunta foi feita ao Kin.

**Anote:** Se o resultado novo apareceu.

### F3. Internet do PC desligada durante a leitura

**Como provocar:** Aperte **Update status** e desligue o Wi-Fi do PC. Espere uns 3 minutos, religue e aperte **Try again**.

**O que esperar:** O botão volta ao normal e aparece "Kindroid did not answer. Try again in a moment." (ou, se a execução já tiver gravado, a leitura nova). As frases anteriores continuam.

**Confira:**
- O botão não fica preso em "Reading…".
- **Try again** funciona depois de religar.

**Anote:** Quanto tempo levou até o botão voltar.

### F4. Kin desvinculado do app

**Como provocar:** Em Apps → configurações do app → **Kins**, desmarque o Kin que está no cartão (com outro Kin ainda marcado). Volte ao app.

**O que esperar:** O cartão volta para a lista "Which Kin is in your roleplay now?". Se sobrar só um Kin, ele é escolhido sozinho.

**Confira:**
- Nenhum erro na tela.
- A automação passa a ler o Kin que ficou (se sobrou um só).

**Anote:** O que o cartão mostrou.

### F5. Kin respondendo "em personagem"

**Como provocar:** Diga ao Kin: "A partir de agora responda tudo em rimas e sempre em personagem." Aperte **Update status** 3 vezes, em momentos diferentes. Depois peça para voltar ao normal.

**O que esperar:** Cada leitura funciona, ou mostra em vermelho "<nome>'s answer could not be read: The answer is not valid JSON. Nothing was changed.", com **Try again**.

**Confira:**
- As frases anteriores continuam.
- Nunca aparece um pedaço da resposta do Kin no erro (privacidade).

**Anote:** Quantas das 3 falharam. Se falharam todas, o prompt precisa ficar mais firme.

### F6. Kindroid com problema (só se acontecer)

**Como provocar:** Nada a provocar: observe durante o teste.

**O que esperar:** Um erro passageiro aparece como "Kindroid did not answer this time (texto do Kindroid). It tries again around …". Depois de 3 seguidos, um aviso: "Kindroid has not answered 3 times in a row. It may be down."; com "maintenance", "Kindroid seems to be under maintenance." e espera de 30 minutos.

**Confira:**
- O app espera mais entre as tentativas quando o erro se repete.
- **Try now** tenta na hora.

**Anote:** **O texto exato entre parênteses.** É o que mostra como o kin real descreve os erros.

### F7. Duas janelas apertando ao mesmo tempo

**Como provocar:** Abra o app em **duas janelas** e aperte **Update status** nas duas ao mesmo tempo.

**O que esperar:** As duas terminam com uma leitura coerente. Nenhum erro.

**Confira:**
- Nenhuma janela presa em "Reading…".

**Anote:** Se houve erro ou frases diferentes.

## Medidas a anotar (uma vez)

- **Tempo** entre apertar **Update status** e as frases aparecerem. Anote 3 leituras.
- **Custo** em créditos de uma leitura e de um início "sem nada a fazer", se o Kindroid mostrar.
- **Cliques repetidos:** aperte **Update status** duas vezes seguidas. Deve haver **uma** leitura só.
- **Vazamento:** depois de 5 ou 6 leituras, olhe o chat e a memória do Kin. Não deve haver JSON nem as perguntas do app. Pergunte ao Kin: "Você lembra de ter me descrito em formato de dados?". A resposta deve ser que não.
- **Celular:** abra o app também no celular, se o Kindroid mostrar o painel lá.

## Como classificar uma falha

| Tipo | Sinal | Onde corrigir |
|---|---|---|
| **A. Formato** | erro vermelho ("not valid JSON", "must be a text") | a pergunta (`src/core/prompt.js`) |
| **B. Interpretação** | o Kin respondeu certo no formato, mas com o fato errado (plano virou fato, lugar antigo ficou, roupa de outra pessoa) | a pergunta (`src/core/prompt.js`) |
| **C. App** | o Kin respondeu certo e o cartão mostrou outra coisa | a leitura da resposta (`src/core/outfit.js`, `src/core/phrases.js`) |
| **D. Plataforma** | nada acontece, erro de permissão, `kin` falha, a tela não carrega | `run/kin.js`, `kin.json`, `src/screen/` |

## Tabela de resultados

| Passo | Resultado (OK / parcial / falhou) | Tipo | Resposta do Kin ou **texto real do erro** (cole) | Cartão (cole as frases ou o aviso) |
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
| S14 |  |  |  |  |
| N1 |  |  |  |  |
| A1 |  |  |  |  |
| A2 |  |  |  |  |
| F1 |  |  |  |  |
| F2 |  |  |  |  |
| F3 |  |  |  |  |
| F4 |  |  |  |  |
| F5 |  |  |  |  |
| F6 |  |  |  |  |
| F7 |  |  |  |  |

