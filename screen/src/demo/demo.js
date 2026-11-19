// Demo scenes for local mode. `chat` is what a person would paste; `response` is what a Kin should answer.
// The Portuguese chat shows that the chat language does not matter: the answer, and the sentences, are English.
const r = (o) => JSON.stringify(o);

export const DEMO_SCENES = [
  {
    id: 'pt-jeans-jacket',
    title: 'Blue jeans, leather jacket, perfumed shirt (Portuguese chat)',
    chat: 'Isa: *sorri e ajeita a gola, parada na sala* Hoje estou vestindo uma calça jeans azul, uma jaqueta de couro e uma camisa branca perfumada.',
    response: r({ location: 'in the living room', pose: 'standing', action: 'adjusting her collar', topwear: ['a perfumed white shirt', 'a leather jacket'], bottomwear: ['blue jeans'] }),
  },
  {
    id: 'accessories-bag',
    title: 'Café in Alfenas: dress, glasses, necklace and a bag',
    chat: 'Isa: Sitting at my usual café in Alfenas, sipping a latte. Glasses on, silver necklace, and my brown backpack on the chair. Still in my black dress and ankle boots.',
    response: r({ location: 'at a café in Alfenas', pose: 'sitting at a table', action: 'sipping a latte', topwear: ['a black dress'], footwear: ['ankle boots'], 'eyes-accessory': ['round glasses'], 'neck-accessory': ['a silver necklace'], bags: ['a brown backpack'] }),
  },
  {
    id: 'taken-off',
    title: 'Takes the cardigan off',
    chat: 'Isa: I put on the green cardigan over my T-shirt and my jeans.\nUser: Cozy!\nIsa: Too warm, actually. *stands up and takes the cardigan off*',
    response: r({ location: 'in the living room', pose: 'standing', action: 'taking off a cardigan', topwear: ['a T-shirt'], bottomwear: ['jeans'] }),
  },
  {
    id: 'travelling',
    title: 'Travelling: on the bus, not there yet',
    chat: 'Isa: Okay, I am on the bus to the hospital now, headphones on, scrolling on my phone. My shift starts in forty minutes.',
    response: r({ location: 'on the bus to the hospital', action: 'scrolling on a phone', 'ears-accessory': ['headphones'] }),
  },
  {
    id: 'plan-not-move',
    title: 'A plan is not a move, and not an action',
    chat: 'Isa: I am home, lounging on the sofa in my pyjamas. Later I will go to the hospital, but not yet. I am going to read for a bit.',
    response: r({ location: 'at home', pose: 'lounging on the sofa', action: 'going to read later', topwear: ['pyjamas'] }),
  },
  {
    id: 'pose-is-place',
    title: 'The pose answer is really a place (it becomes the location)',
    chat: 'Isa: *chopping onions* Dinner is almost ready, I have been in the kitchen all afternoon.',
    response: r({ pose: 'in the kitchen', action: 'I am chopping onions' }),
  },
  {
    id: 'loose-keys',
    title: 'Answer without slot names (still understood)',
    chat: 'Isa: Sneakers, a striped sweater, a watch and a cap today. We are walking around the park.',
    response: r({ location: 'at the park', action: 'walking around the park', clothing: ['a striped sweater', 'sneakers', 'a cap'], accessories: ['a watch'] }),
  },
  {
    id: 'nothing-said',
    title: 'Nothing about place, pose, action or clothes',
    chat: 'Isa: How was your day?\nUser: Long. Yours?\nIsa: Quiet, mostly. I read a lot.',
    response: '{}',
  },
  {
    id: 'in-character',
    title: 'The Kin answers in character (error case)',
    chat: 'Isa: I am at the beach in a red scarf.',
    response: '*giggles* Oh, a form? How cute. I am at the beach in a red scarf, silly!',
  },
];
