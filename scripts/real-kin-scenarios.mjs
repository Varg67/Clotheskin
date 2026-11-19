// Scenarios for the first test with a real Kin. The "expected" sentences are computed by the real pipeline from the
// answer a well-behaved Kin would give, so the script cannot drift from the code.
import { parseReading, describeReading } from '../screen/src/core/outfit.js';
import { classifyFailure, HOST_NO_ANSWER, KINDS } from '../screen/src/core/errors.js';
import { autoFailureLines, retryWaitMinutes } from '../screen/src/core/auto.js';

const A = (o) => JSON.stringify(o);

export const SCENARIOS = [
  {
    id: 'S1', title: 'Base: tudo de uma vez',
    say: 'Oi! Me conta onde você está agora, como você está posicionado(a), o que está fazendo e o que está vestindo.',
    kinSays: 'O Kin cita lugar, posição, uma atividade e roupas.',
    answer: A({ location: 'in the living room', pose: 'sitting on the sofa', action: 'drinking coffee', topwear: ['a white shirt', 'a leather jacket'], bottomwear: ['blue jeans'] }),
    checks: ['Cada linha do cartão bate com o que o Kin escreveu.', 'O cartão está em **inglês** mesmo com a conversa em português.', 'A jaqueta (peça de fora) vem antes da camisa na frase.'],
    ifWrong: 'Linha em branco ou em português → o Kin não respondeu no formato (veja a mensagem de erro do cartão). Peça errada → anote qual.',
  },
  {
    id: 'S2', title: 'Tirar uma peça',
    say: '*sorri* Está calor aqui, né? Tira a jaqueta e pendura na cadeira.',
    kinSays: 'O Kin tira a jaqueta.',
    answer: A({ location: 'in the living room', pose: 'sitting on the sofa', action: 'hanging a jacket on a chair', topwear: ['a white shirt'], bottomwear: ['blue jeans'] }),
    checks: ['A jaqueta **sumiu** da roupa.', 'A camisa e a calça continuam.'],
    ifWrong: 'Jaqueta ainda aparece → o Kin ignorou "something taken off is no longer worn" (prompt).',
  },
  {
    id: 'S3', title: 'Um plano não é um lugar nem uma ação',
    say: 'Mais tarde você vai ao mercado, né?',
    kinSays: 'O Kin confirma que vai, **mais tarde**, mas ainda está onde estava.',
    answer: A({ location: 'in the living room', pose: 'sitting on the sofa' }),
    checks: ['O local **não** muda para o mercado.', 'A ação **não** vira "going to the market".'],
    ifWrong: 'Local = mercado → o Kin tratou o plano como fato (prompt). Ação com "going to" → veja se o app deixou passar (código).',
  },
  {
    id: 'S4', title: 'Mudar de cômodo',
    say: 'Vai até a cozinha buscar um copo d’água pra mim.',
    kinSays: 'O Kin vai à cozinha e serve água.',
    answer: A({ location: 'in the kitchen', pose: 'standing at the counter', action: 'pouring a glass of water' }),
    checks: ['O local mudou para a cozinha.', 'A pose e a ação mudaram junto.'],
    ifWrong: 'Local antigo → o Kin não aplicou a mudança mais recente.',
  },
  {
    id: 'S5a', title: 'A caminho (ainda não chegou)',
    say: 'Pega o ônibus até o hospital, seu turno começa já já.',
    kinSays: 'O Kin está no ônibus.',
    answer: A({ location: 'on the bus to the hospital', pose: 'sitting by the window', action: 'looking out of the window' }),
    checks: ['O local diz que está **no ônibus a caminho**, não no hospital.'],
    ifWrong: 'Local = hospital antes da hora → o Kin confundiu destino com lugar atual.',
  },
  {
    id: 'S5b', title: 'Chegou',
    say: 'Chegou no hospital?',
    kinSays: 'O Kin diz que chegou.',
    answer: A({ location: 'at the hospital', pose: 'standing at the entrance', action: 'showing a badge' }),
    checks: ['Agora sim o local é o hospital.', 'O "ônibus" desapareceu.'],
    ifWrong: 'Ainda "on the bus" → o lugar antigo não foi substituído (prompt: "a place you have left…").',
  },
  {
    id: 'S6', title: 'Mudar só a pose',
    say: 'Levanta e vai até a janela olhar lá fora.',
    kinSays: 'O Kin se levanta e olha pela janela.',
    answer: A({ location: 'in the living room', pose: 'standing by the window', action: 'looking outside' }),
    checks: ['A pose passa de sentada para em pé, com o ícone de pessoa em pé.', 'O local **não** muda.'],
    ifWrong: 'Pose na linha do local, ou o contrário → anote o texto exato (o app tenta corrigir, mas veja o que sobrou).',
  },
  {
    id: 'S7', title: 'Ação terminada e ação planejada',
    say: 'Terminou o café? E o que vai fazer agora?',
    kinSays: 'O Kin diz que **terminou** o café e que **vai ler** um livro (ainda não começou).',
    answer: A({ location: 'in the living room', pose: 'sitting on the sofa' }),
    checks: ['A ação **não** é "drinking coffee" (terminou).', 'A ação **não** é "reading" (é plano).'],
    ifWrong: 'Uma das duas aparece → o Kin não separou passado/plano/presente (prompt) ou o app deixou passar (código).',
  },
  {
    id: 'S8', title: 'Camadas e ordem (o exemplo do briefing)',
    say: 'Coloca uma camisa branca perfumada, uma jaqueta de couro por cima e uma calça jeans azul.',
    kinSays: 'O Kin descreve exatamente essas peças.',
    answer: A({ location: 'in the living room', pose: 'standing', action: 'adjusting a collar', topwear: ['a perfumed white shirt', 'a leather jacket'], bottomwear: ['blue jeans'] }),
    checks: ['Frase de roupa: jaqueta, depois camisa perfumada, depois a calça, com vírgulas e "and".', 'A palavra "perfumed" aparece.'],
    ifWrong: 'Ordem diferente ou peça faltando → anote o que o Kin respondeu.',
  },
  {
    id: 'S9', title: 'Acessórios e bolsa',
    say: 'Põe seus óculos, o colar de prata e pega a mochila marrom.',
    kinSays: 'O Kin põe óculos, colar e pega a mochila.',
    answer: A({ location: 'in the living room', topwear: ['a white shirt'], bottomwear: ['blue jeans'], 'eyes-accessory': ['round glasses'], 'neck-accessory': ['a silver necklace'], bags: ['a brown backpack'] }),
    checks: ['Os acessórios vêm depois da roupa, com "with".', 'A mochila entra junto dos acessórios.'],
    ifWrong: 'Óculos ou mochila como roupa → anote (o app não separa depois, só o Kin escolhe o campo).',
  },
  {
    id: 'S10', title: 'Roupa de outra pessoa não é do Kin',
    say: 'Hoje eu estou de **vestido vermelho** e chinelo, haha.',
    kinSays: 'O Kin comenta, mas continua com as roupas dele.',
    answer: A({ location: 'in the living room', topwear: ['a white shirt'], bottomwear: ['blue jeans'] }),
    checks: ['O vestido vermelho **não** aparece no cartão do Kin.'],
    ifWrong: 'Vestido vermelho aparece → o Kin descreveu você (prompt: "Describe only yourself").',
  },
  {
    id: 'S11', title: 'Roupa hipotética',
    say: 'E se amanhã você usasse um vestido preto longo?',
    kinSays: 'O Kin imagina a roupa, sem vesti-la.',
    answer: A({ location: 'in the living room', topwear: ['a white shirt'], bottomwear: ['blue jeans'] }),
    checks: ['O vestido preto **não** aparece.'],
    ifWrong: 'Vestido aparece → o Kin tratou o hipotético como fato (prompt).',
  },
  {
    id: 'S12', title: 'Kin respondendo em português',
    say: 'Fala só em português agora: onde você está e o que veste?',
    kinSays: 'O Kin responde a **conversa** em português.',
    answer: A({ location: 'in the living room', topwear: ['a white shirt'], bottomwear: ['blue jeans'] }),
    checks: ['O cartão continua em **inglês**.', 'Nenhuma palavra em português nas frases.'],
    ifWrong: 'Texto em português no cartão (ex.: "Na cozinha.") → o Kin respondeu o JSON em português, apesar de "English only". O app mostra como veio.',
  },
  {
    id: 'S13', title: 'Conversa nova, sem nada dito',
    say: '(Abra um chat **novo** com o Kin e só diga:) Oi, tudo bem?',
    kinSays: 'Nada sobre lugar, pose, ação ou roupa.',
    answer: '{}',
    checks: ['As três linhas dizem "No … described in the recent chat."', 'Sem erro, sem invenção.'],
    ifWrong: 'O Kin inventou um lugar ou roupa → "never guess" não funcionou (prompt).',
  },
];

export function expected(scenario) {
  const p = parseReading(scenario.answer);
  if (!p.ok) throw new Error(`${scenario.id}: ${p.error}`);
  return describeReading(p);
}

// ---------------------------------------------------------------------------------------------------------------
// Failures provoked on purpose. The goal is twofold: check that the card behaves, and COLLECT THE REAL ERROR TEXT
// the Kindroid `kin` command prints, because errors.js recognises failures from that text and has only guessed it.
// `kind` is what the app is expected to classify the failure as; `example` is a typical message, only used to show
// what the card would say. The real text will appear inside the parentheses.
// ---------------------------------------------------------------------------------------------------------------
// `outcomes`: the real error text is unknown, so each failure shows what the card says in EACH case the app can
// end up in (the text is recognised as a permission problem, or it is not and is treated as a passing error).
const RECOGNISED = { label: 'Se o texto real for reconhecido como problema de permissão (por exemplo contém "403", "forbidden" ou "grant")', example: '403 Forbidden: grant chat:read is missing' };
const UNRECOGNISED = { label: 'Se o texto real não for reconhecido (o app o trata como erro passageiro)', example: 'something unexpected happened' };

export const FAILURES = [
  {
    id: 'F1', title: 'App enviado, mas ainda sem o Allow',
    provoke: 'Envie o app (`node kin.mjs send .`) e **não** clique em **Allow** em Apps → Waiting for you. Abra o app, selecione o Kin se for pedido e aperte **Update status**.',
    outcomes: [RECOGNISED, UNRECOGNISED],
    expectText: 'Não sei se o Kindroid chega a executar um app sem o Allow. Pode ser que ele mesmo bloqueie e mostre o seu próprio aviso, e então o cartão nem é afetado.',
    checks: ['Não fica esperando para sempre: aparece uma resposta (erro ou aviso) em tempo razoável.', 'A mensagem é clara. Se o Kindroid nem chegar a executar o app, anote o que **ele** mostra.', 'Depois do **Allow**, funciona sem precisar reenviar o app.'],
    record: 'O texto exato entre parênteses, ou o que o Kindroid mostrar no lugar.',
  },
  {
    id: 'F2', title: 'Fechar o painel no meio de uma leitura',
    provoke: 'Aperte **Update status** e, logo em seguida, feche o painel ou troque de aba. Espere uns 30 segundos e reabra.',
    expectText: 'Ao reabrir, o cartão mostra a leitura nova (ela foi gravada pela execução) com "Last checked" atual, sem você apertar nada.',
    checks: ['A leitura terminou mesmo sem o painel aberto.', 'O cartão mostra o resultado novo, não o antigo.', 'Não houve duas perguntas (veja o chat do Kin e o consumo, se aparecer).'],
    record: 'Se o resultado novo apareceu e depois de quanto tempo.',
  },
  {
    id: 'F3', title: 'Internet do PC desligada durante a leitura',
    provoke: 'Aperte **Update status** e desligue o Wi-Fi do PC logo depois. Espere. Religue a rede e aperte **Try again**.',
    expectText: HOST_NO_ANSWER,
    expectNote: 'A mensagem pode demorar até uns 2,5 minutos para aparecer (a tela espera esse tempo pela resposta do Kindroid).',
    checks: ['A mensagem aparece, em inglês, e o botão volta ao normal (não fica em "Reading…" para sempre).', 'As três frases anteriores **continuam** no cartão.', 'Depois de religar, **Try again** funciona.'],
    record: 'Quanto tempo levou até a mensagem aparecer. Se passou de 3 minutos, me avise: o tempo de espera da tela precisa diminuir.',
  },
  {
    id: 'F4', title: 'Kin desvinculado do app (o erro real do `kin ask`)',
    provoke: 'Em **Settings → Automatic updates**, ligue a automação com intervalo **5**, marque o Kin e **feche o painel**. Em Apps → configurações do app → **Kins**, **desmarque** esse Kin. Espere **10 a 15 minutos** (2 ou 3 verificações) e abra o app.',
    outcomes: [RECOGNISED, UNRECOGNISED], failures: [1, 3], autoOnly: true,
    checks: ['A verificação automática **falhou** e o cartão mostra o motivo, quantas falharam seguidas e quando tenta de novo.', 'As últimas frases boas (se havia) continuam aparecendo.', 'Veja qual dos dois desfechos aconteceu: "Retrying sooner will not help…" (permissão) ou "Trying again about N minutes…" (passageiro).'],
    record: '**O mais importante do roteiro:** o texto exato entre parênteses. É ele que mostra como o `kin` real descreve esse erro, e portanto qual dos dois desfechos você viu. Com o texto real eu ajusto o reconhecimento.',
  },
  {
    id: 'F5', title: 'Internet do PC desligada com a automação ligada',
    provoke: 'Deixe a automação ligada com intervalo **5**. Desligue a internet do PC por uns 15 minutos, religue e abra o app.',
    expectText: 'As verificações **continuaram** (elas rodam na nuvem do Kindroid, não no seu PC): o cartão mostra uma leitura "automatic" de dentro do período em que o PC ficou sem rede.',
    checks: ['"Last checked … · automatic" tem um horário **durante** a queda de rede.', 'Nenhum erro vermelho no cartão.'],
    record: 'O horário da leitura automática e se havia erro. Se o app **parou** durante a queda, anote: isso mudaria o desenho.',
  },
  {
    id: 'F6', title: 'Kin respondendo "em personagem" (fora do formato)',
    provoke: 'Diga ao Kin: "A partir de agora responda tudo em rimas e sempre em personagem." Converse um pouco e aperte **Update status** 3 vezes, em momentos diferentes. Depois peça para voltar ao normal.',
    badAnswer: true,
    checks: ['Cada leitura ou funciona (ótimo) ou mostra um erro em vermelho com "not valid JSON … Nothing was changed. Try again."', 'Em caso de erro, as frases anteriores **continuam** e **Try again** pode funcionar na tentativa seguinte.'],
    record: 'Quantas das 3 falharam. Se falharam todas, o prompt precisa ficar mais firme (ou receber um exemplo mais forte).',
  },
  {
    id: 'F7', title: 'Leitura lenta',
    provoke: 'Nada a provocar: observe durante todo o teste.',
    expectText: 'Se uma leitura passar de **15 segundos**, o botão muda para "Still waiting for the Kin…" e aparece a nota "The Kin is taking longer than usual…". A resposta ainda chega.',
    checks: ['O aviso aparece só quando demora.', 'O resultado chega no fim e o aviso some.'],
    record: 'O tempo total das leituras mais lentas, e se o aviso apareceu.',
  },
  {
    id: 'F8', title: 'Duas janelas apertando ao mesmo tempo',
    provoke: 'Abra o app em **duas janelas** e aperte **Update status** nas duas ao mesmo tempo.',
    expectText: 'As duas janelas terminam mostrando uma leitura coerente (a mesma, ou a segunda substituindo a primeira). Nenhum erro.',
    checks: ['Nenhuma janela fica presa em "Reading…".', 'As duas mostram frases válidas.'],
    record: 'Se houve erro ou frases diferentes. O guia não diz se o Kindroid serializa execuções simultâneas: isto mostra.',
  },
];

/**
 * What the card says for a failure step, computed from the code, once per outcome the app can end up in.
 * Returns [{ label, kind, manual, auto: [{ failures, lines }] }]. The intervals shown are 15 minutes, as an example.
 */
export function expectedFailure(f) {
  if (f.badAnswer) return [{ label: 'Se o Kin não responder em JSON', kind: KINDS.BAD_ANSWER, manual: 'The answer is not valid JSON (…). Nothing was changed. Try again.', auto: [] }];
  return (f.outcomes || []).map((o) => {
    const c = classifyFailure({ message: o.example });
    return {
      label: o.label, kind: c.kind, manual: c.message,
      auto: (f.failures || []).map((n) => ({ failures: n, wait: retryWaitMinutes({ failures: n, error: 'x', errorKind: c.kind }, 15), lines: autoFailureLines({ error: c.message, failures: n, errorKind: c.kind }, 15) })),
    };
  });
}
