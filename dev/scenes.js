// Scenes for the dev harness (npm start): what the stand-in Kin answers. `chat` is the scene as the person would see it
// in their chat (shown in the harness only); `response` is the Kin's answer to the reading question; `sleep` and
// `dream` answer the sleep and dream questions. The Portuguese chat shows that the chat language does not matter:
// the answers, and the sentences, are English.
const r = (o) => JSON.stringify(o);

export const DEMO_SCENES = [
  {
    id: 'night',
    title: 'Goes to sleep (asleep until 07:30, then a dream)',
    chat: 'Isa: *yawns, pulls the blanket up* Good night… I set the alarm for half past seven.',
    response: r({ location: 'in the bedroom', pose: 'lying in bed', action: 'sleeping', topwear: ['an oversized T-shirt'], 'ears-accessory': ['small silver studs'] }),
    sleep: r({ sleeping: true, wake_at: '07:30' }),
    dream: r({ dream: 'I was flying over the sea at night with my sister, and the lighthouse kept calling my name', remembered: 'most' }),
  },
  {
    id: 'pt-jeans-jacket',
    title: 'Blue jeans, leather jacket, perfumed shirt (Portuguese chat)',
    chat: 'Isa: *sorri e ajeita a gola, parada na sala* Hoje estou vestindo uma calça jeans azul, uma jaqueta de couro e uma camisa branca perfumada.',
    response: r({ location: 'in the living room', pose: 'standing', action: 'adjusting her collar', topwear: ['a perfumed white shirt', 'a leather jacket'], bottomwear: ['blue jeans'] }),
  },
  {
    id: 'accessories-bag',
    title: 'Café in Alfenas: dress, glasses, necklace and a bag',
    chat: 'Isa: Sitting at my usual café in Alfenas, sipping a latte. Glasses on, silver necklace, and my brown backpack on the chair. Still in my black dress and ankle boots, hair up in a messy bun, a bit of red lipstick.',
    response: r({ location: 'at a café in Alfenas', pose: 'sitting at a table', action: 'sipping a latte', topwear: ['a black dress'], footwear: ['ankle boots'], 'eyes-accessory': ['round glasses'], 'neck-accessory': ['a silver necklace'], bags: ['a brown backpack'], hair: 'up in a messy bun', makeup: 'red lipstick' }),
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
