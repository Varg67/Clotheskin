// Demo scenes for local mode. `chat` is what a person would paste; `response` is what a Kin should answer.
// The Portuguese chat shows that the chat language does not matter: the answer, and the sentence, are English.
const r = (o) => JSON.stringify(o);

export const DEMO_SCENES = [
  {
    id: 'pt-jeans-jacket',
    title: 'Blue jeans, leather jacket, perfumed shirt (Portuguese chat)',
    chat: 'Isa: *sorri e ajeita a gola* Hoje estou vestindo uma calça jeans azul, uma jaqueta de couro e uma camisa branca perfumada.',
    response: r({ topwear: ['a perfumed white shirt', 'a leather jacket'], bottomwear: ['blue jeans'] }),
  },
  {
    id: 'accessories-bag',
    title: 'Dress, glasses, necklace and a bag',
    chat: 'Isa: Glasses on, silver necklace, and my brown backpack on one shoulder. Still in my black dress and ankle boots.',
    response: r({ topwear: ['a black dress'], footwear: ['ankle boots'], 'eyes-accessory': ['round glasses'], 'neck-accessory': ['a silver necklace'], bags: ['a brown backpack'] }),
  },
  {
    id: 'taken-off',
    title: 'Takes the cardigan off',
    chat: 'Isa: I put on the green cardigan over my T-shirt and my jeans.\nUser: Cozy!\nIsa: Too warm, actually. *takes the cardigan off and drapes it on the chair*',
    response: r({ topwear: ['a T-shirt'], bottomwear: ['jeans'] }),
  },
  {
    id: 'loose-keys',
    title: 'Answer without slot names (still understood)',
    chat: 'Isa: Sneakers, a striped sweater, a watch and a cap today.',
    response: r({ clothing: ['a striped sweater', 'sneakers', 'a cap'], accessories: ['a watch'] }),
  },
  {
    id: 'nothing-said',
    title: 'Nothing about clothes in the chat',
    chat: 'Isa: How was your day?\nUser: Long. Yours?\nIsa: Quiet, mostly. I read a lot.',
    response: '{}',
  },
  {
    id: 'in-character',
    title: 'The Kin answers in character (error case)',
    chat: 'Isa: I am wearing a red scarf.',
    response: '*giggles* Oh, a form? How cute. I am wearing a red scarf, silly!',
  },
];
