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

## Falhas provocadas (a parte que mais ensina)

Os passos acima verificam se o cartão entende o chat. Estes verificam o que acontece **quando algo dá errado**, e servem a um segundo objetivo: **coletar o texto real dos erros** do `kin ask`. O app reconhece o tipo de erro por esse texto (`screen/src/core/errors.js`), mas eu só consegui *supor* como ele aparece. Em cada erro o cartão mostra o texto real entre parênteses: **copie-o exatamente** na tabela. Com ele eu ajusto o reconhecimento.

Vale em todas as falhas: as **últimas frases boas continuam no cartão**, e o botão **Try again** não pode ficar travado.

Regra de ouro para a automação: ela roda **na nuvem do Kindroid**, não no seu PC. Desligar a internet do PC não pára as verificações; só impede você de ver o resultado até voltar.

### F1. App enviado, mas ainda sem o Allow

**Como provocar:** Envie o app (`node kin.mjs send .`) e **não** clique em **Allow** em Apps → Waiting for you. Abra o app, selecione o Kin se for pedido e aperte **Update status**.

**Se o texto real for reconhecido como problema de permissão (por exemplo contém "403", "forbidden" ou "grant"):**

**Update status** mostraria (o texto real do erro viria entre parênteses no fim):

> Kindroid refused the question. The app may need a permission: check Apps, Waiting for you. (403 Forbidden: grant chat:read is missing)

**Se o texto real não for reconhecido (o app o trata como erro passageiro):**

**Update status** mostraria (o texto real do erro viria entre parênteses no fim):

> The Kin could not be asked. (something unexpected happened)

**O que esperar:** Não sei se o Kindroid chega a executar um app sem o Allow. Pode ser que ele mesmo bloqueie e mostre o seu próprio aviso, e então o cartão nem é afetado.

**Confira:**
- Não fica esperando para sempre: aparece uma resposta (erro ou aviso) em tempo razoável.
- A mensagem é clara. Se o Kindroid nem chegar a executar o app, anote o que **ele** mostra.
- Depois do **Allow**, funciona sem precisar reenviar o app.

**Anote:** O texto exato entre parênteses, ou o que o Kindroid mostrar no lugar.

### F2. Fechar o painel no meio de uma leitura

**Como provocar:** Aperte **Update status** e, logo em seguida, feche o painel ou troque de aba. Espere uns 30 segundos e reabra.

**O que esperar:** Ao reabrir, o cartão mostra a leitura nova (ela foi gravada pela execução) com "Last checked" atual, sem você apertar nada.

**Confira:**
- A leitura terminou mesmo sem o painel aberto.
- O cartão mostra o resultado novo, não o antigo.
- Não houve duas perguntas (veja o chat do Kin e o consumo, se aparecer).

**Anote:** Se o resultado novo apareceu e depois de quanto tempo.

### F3. Internet do PC desligada durante a leitura

**Como provocar:** Aperte **Update status** e desligue o Wi-Fi do PC logo depois. Espere. Religue a rede e aperte **Try again**.

**O que esperar:** Kindroid did not answer in time. Check your connection and try again. Your last reading is still shown. A mensagem pode demorar até uns 2,5 minutos para aparecer (a tela espera esse tempo pela resposta do Kindroid).

**Confira:**
- A mensagem aparece, em inglês, e o botão volta ao normal (não fica em "Reading…" para sempre).
- As três frases anteriores **continuam** no cartão.
- Depois de religar, **Try again** funciona.

**Anote:** Quanto tempo levou até a mensagem aparecer. Se passou de 3 minutos, me avise: o tempo de espera da tela precisa diminuir.

### F4. Kin desvinculado do app (o erro real do `kin ask`)

**Como provocar:** Em **Settings → Automatic updates**, ligue a automação com intervalo **5**, marque o Kin e **feche o painel**. Em Apps → configurações do app → **Kins**, **desmarque** esse Kin. Espere **10 a 15 minutos** (2 ou 3 verificações) e abra o app.

**Se o texto real for reconhecido como problema de permissão (por exemplo contém "403", "forbidden" ou "grant"):**

E a verificação automática explicaria, sob o cartão (intervalo de 15 min como exemplo):

Depois de 1 falha:
> The last automatic check failed: Kindroid refused the question. The app may need a permission: check Apps, Waiting for you. (403 Forbidden: grant chat:read is missing)
> Retrying sooner will not help: fix the cause, then press Try again.

Depois de 3 falhas:
> The last automatic check failed: Kindroid refused the question. The app may need a permission: check Apps, Waiting for you. (403 Forbidden: grant chat:read is missing)
> 3 checks in a row have failed.
> Retrying sooner will not help: fix the cause, then press Try again.

**Se o texto real não for reconhecido (o app o trata como erro passageiro):**

E a verificação automática explicaria, sob o cartão (intervalo de 15 min como exemplo):

Depois de 1 falha:
> The last automatic check failed: The Kin could not be asked. (something unexpected happened)
> Trying again about 5 minutes after the last attempt.

Depois de 3 falhas:
> The last automatic check failed: The Kin could not be asked. (something unexpected happened)
> 3 checks in a row have failed.
> Trying again about 15 minutes after the last attempt.

**Confira:**
- A verificação automática **falhou** e o cartão mostra o motivo, quantas falharam seguidas e quando tenta de novo.
- As últimas frases boas (se havia) continuam aparecendo.
- Veja qual dos dois desfechos aconteceu: "Retrying sooner will not help…" (permissão) ou "Trying again about N minutes…" (passageiro).

**Anote:** **O mais importante do roteiro:** o texto exato entre parênteses. É ele que mostra como o `kin` real descreve esse erro, e portanto qual dos dois desfechos você viu. Com o texto real eu ajusto o reconhecimento.

### F5. Internet do PC desligada com a automação ligada

**Como provocar:** Deixe a automação ligada com intervalo **5**. Desligue a internet do PC por uns 15 minutos, religue e abra o app.

**O que esperar:** As verificações **continuaram** (elas rodam na nuvem do Kindroid, não no seu PC): o cartão mostra uma leitura "automatic" de dentro do período em que o PC ficou sem rede.

**Confira:**
- "Last checked … · automatic" tem um horário **durante** a queda de rede.
- Nenhum erro vermelho no cartão.

**Anote:** O horário da leitura automática e se havia erro. Se o app **parou** durante a queda, anote: isso mudaria o desenho.

### F6. Kin respondendo "em personagem" (fora do formato)

**Como provocar:** Diga ao Kin: "A partir de agora responda tudo em rimas e sempre em personagem." Converse um pouco e aperte **Update status** 3 vezes, em momentos diferentes. Depois peça para voltar ao normal.

**Se o Kin não responder em JSON:**

**Update status** mostraria:

> The answer is not valid JSON (…). Nothing was changed. Try again.

**Confira:**
- Cada leitura ou funciona (ótimo) ou mostra um erro em vermelho com "not valid JSON … Nothing was changed. Try again."
- Em caso de erro, as frases anteriores **continuam** e **Try again** pode funcionar na tentativa seguinte.

**Anote:** Quantas das 3 falharam. Se falharam todas, o prompt precisa ficar mais firme (ou receber um exemplo mais forte).

### F7. Leitura lenta

**Como provocar:** Nada a provocar: observe durante todo o teste.

**O que esperar:** Se uma leitura passar de **15 segundos**, o botão muda para "Still waiting for the Kin…" e aparece a nota "The Kin is taking longer than usual…". A resposta ainda chega.

**Confira:**
- O aviso aparece só quando demora.
- O resultado chega no fim e o aviso some.

**Anote:** O tempo total das leituras mais lentas, e se o aviso apareceu.

### F8. Duas janelas apertando ao mesmo tempo

**Como provocar:** Abra o app em **duas janelas** e aperte **Update status** nas duas ao mesmo tempo.

**O que esperar:** As duas janelas terminam mostrando uma leitura coerente (a mesma, ou a segunda substituindo a primeira). Nenhum erro.

**Confira:**
- Nenhuma janela fica presa em "Reading…".
- As duas mostram frases válidas.

**Anote:** Se houve erro ou frases diferentes. O guia não diz se o Kindroid serializa execuções simultâneas: isto mostra.

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

| Passo | Resultado (OK / parcial / falhou) | Tipo | Resposta do Kin ou **texto real do erro** (cole) | Cartão (cole as 3 frases ou o aviso) |
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
| F1 |  |  |  |  |
| F2 |  |  |  |  |
| F3 |  |  |  |  |
| F4 |  |  |  |  |
| F5 |  |  |  |  |
| F6 |  |  |  |  |
| F7 |  |  |  |  |
| F8 |  |  |  |  |

