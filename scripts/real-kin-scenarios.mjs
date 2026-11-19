// Scenarios for the first test with a real Kin. The "expected" sentences are computed by the real pipeline from the
// answer a well-behaved Kin would give, so the script cannot drift from the code.
import { parseReading, describeReading } from '../screen/src/core/outfit.js';

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
