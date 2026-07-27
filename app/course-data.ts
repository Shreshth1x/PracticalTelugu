export type SituationGroup =
  | "quick-start"
  | "family"
  | "out-and-about"
  | "backup";

export type TeluguWord = {
  telugu: string;
  roman: string;
  pronunciation: string;
  english: string;
  note?: string;
  audioSrc?: string;
};

export type Lesson = {
  id: string;
  group: SituationGroup;
  title: string;
  eyebrow: string;
  description: string;
  outcome: string;
  minutes: number;
  words: TeluguWord[];
  milestone?: boolean;
};

export type PracticePack = {
  id: string;
  title: string;
  outcome: string;
  words: TeluguWord[];
};

type TeluguWordSource = Omit<TeluguWord, "pronunciation">;
type LessonSource = Omit<Lesson, "words"> & {
  words: TeluguWordSource[];
};

export const situationGroups: {
  id: SituationGroup;
  eyebrow: string;
  title: string;
  description: string;
}[] = [
  {
    id: "quick-start",
    eyebrow: "START HERE",
    title: "Your 30-minute head start",
    description:
      "The greetings, replies, and rescue phrases that make it easier to join in right away.",
  },
  {
    id: "family",
    eyebrow: "WITH FAMILY",
    title: "Keep the visit moving",
    description:
      "Check in, talk about plans, and answer without dropping back into English.",
  },
  {
    id: "out-and-about",
    eyebrow: "OUT & ABOUT",
    title: "Handle the everyday errand",
    description:
      "Point, ask, travel, shop, and pay with a short phrase ready when you need it.",
  },
  {
    id: "backup",
    eyebrow: "WHEN IT MATTERS",
    title: "Ask for help clearly",
    description:
      "A small safety net for feeling unwell or needing someone’s help.",
  },
];

const learnerPronunciations: Record<string, string> = {
  "నమస్కారం": "nuh-muh-SKAA-rum",
  "ఎలా ఉన్నారు?": "eh-LAA oon-NAA-roo?",
  "బాగున్నాను": "baa-goon-NAA-noo",
  "మళ్లీ కలుద్దాం": "mul-LEE kuh-lood-DAAM",
  "ధన్యవాదాలు": "dun-yuh-VAA-daa-loo",
  "దయచేసి": "duh-yuh-CHAY-see",
  "పరవాలేదు": "puh-ruh-vaa-LAY-doo",
  "క్షమించండి": "kshuh-min-CHUN-dee",
  "అవును": "uh-VOO-noo",
  "కాదు": "KAA-doo",
  "సరే": "suh-RAY",
  "తెలియదు": "teh-lee-YUH-doo",
  "మీ పేరు ఏంటి?": "MEE PAY-roo AYN-tee?",
  "నా పేరు…": "NAA PAY-roo…",
  "మిమ్మల్ని కలవడం సంతోషం":
    "mim-MUL-nee kuh-luh-VUH-dum sun-TOH-shum",
  "మీరు ఎక్కడి నుంచి?": "MEE-roo ek-KUH-dee NOON-chee?",
  "తిన్నారా?": "tin-NAA-raa?",
  "మీరు ఎలా ఉన్నారు?": "MEE-roo eh-LAA oon-NAA-roo?",
  "మీరు ఎక్కడ ఉన్నారు?": "MEE-roo ek-KUH-duh oon-NAA-roo?",
  "అమ్మ ఇంట్లో ఉన్నారా?": "UM-muh IN-tloh oon-NAA-raa?",
  "నీళ్లు కావాలి": "NEE-lloo KAA-vaa-lee",
  "ఇది చాలా బాగుంది": "IH-dee CHAA-laa BAA-goon-dee",
  "ఇంకొంచెం": "in-KON-chem",
  "చాలు": "CHAA-loo",
  "నాకు అర్థం కాలేదు": "NAA-koo AR-thum kaa-LAY-doo",
  "మెల్లగా చెప్పండి": "mel-luh-GAA chep-PUN-dee",
  "మళ్లీ చెప్పండి": "mul-LEE chep-PUN-dee",
  "నాకు తెలుగు బాగా రాదు": "NAA-koo TEH-loo-goo BAA-gaa RAA-doo",
  "నేను బాగున్నాను": "NAY-noo baa-goon-NAA-noo",
  "నాకు అలసటగా ఉంది": "NAA-koo uh-luh-suh-tuh-GAA OON-dee",
  "నాకు సంతోషంగా ఉంది": "NAA-koo sun-TOH-shum-gaa OON-dee",
  "నేను రేపు వస్తాను": "NAY-noo RAY-poo vus-TAA-noo",
  "మీరు ఎప్పుడు ఇంట్లో ఉంటారు?": "MEE-roo EP-poo-doo IN-tloh oon-TAA-roo?",
  "నేను ఇప్పుడు బయల్దేరాను": "NAY-noo IP-poo-doo buh-yul-DAY-raa-noo",
  "నాకు ఇది కావాలి": "NAA-koo IH-dee KAA-vaa-lee",
  "నాకు ఇది వద్దు": "NAA-koo IH-dee VUD-doo",
  "ఇది ఎంత?": "IH-dee EN-tuh?",
  "అది": "UH-dee",
  "బస్ స్టాప్ ఎక్కడ ఉంది?": "BUS STAAP ek-KUH-duh OON-dee?",
  "ఇక్కడ ఆపండి దయచేసి": "ik-KUH-duh AA-pun-dee duh-yuh-CHAY-see",
  "సూటిగా వెళ్ళండి": "SOO-tee-gaa vel-LUN-dee",
  "ఇది అక్కడికి వెళ్లే దారినా?":
    "IH-dee uk-KUH-dee-kee vel-LAY DAA-ree-naa?",
  "చాలా ఖరీదు": "CHAA-laa khuh-REE-doo",
  "ధర తగ్గించగలరా?": "dhuh-ruh tug-gin-chuh-guh-luh-RAA?",
  "చేంజ్ ఉందా?": "CHAYNJ OON-daa?",
  "నాకు ఒంట్లో బాగా లేదు": "NAA-koo ON-tloh BAA-gaa LAY-doo",
  "నాకు కొంచెం జ్వరంగా ఉంది":
    "NAA-koo KON-chem jwuh-RUM-gaa OON-dee",
  "నాకు డాక్టర్ కావాలి": "NAA-koo DAAK-tur KAA-vaa-lee",
  "నాకు సహాయం కావాలి": "NAA-koo suh-HAA-yum KAA-vaa-lee",
};

function addLearnerPronunciation(word: TeluguWordSource): TeluguWord {
  const pronunciation = learnerPronunciations[word.telugu];

  if (!pronunciation) {
    throw new Error(`Missing learner pronunciation: ${word.telugu}`);
  }

  return { ...word, pronunciation };
}

const practicalLessonSources: LessonSource[] = [
  {
    id: "hello-goodbye",
    group: "quick-start",
    title: "Arrive & leave warmly",
    eyebrow: "The first two minutes",
    description: "Greet everyone, answer the first question, and say you’ll see them again.",
    outcome: "Walk into a visit without waiting for someone else to start.",
    minutes: 4,
    words: [
      {
        telugu: "నమస్కారం",
        roman: "namaskaaram",
        english: "hello",
        note: "A respectful greeting that is safe with elders and new people.",
      },
      {
        telugu: "ఎలా ఉన్నారు?",
        roman: "elaa unnaaru?",
        english: "how are you? (respectful)",
        note: "Use this respectful form with elders, relatives, and people you just met.",
      },
      {
        telugu: "బాగున్నాను",
        roman: "baagunnaanu",
        english: "I’m well",
      },
      {
        telugu: "మళ్లీ కలుద్దాం",
        roman: "malli kaluddaam",
        english: "see you again",
      },
    ],
  },
  {
    id: "please-thank-you",
    group: "quick-start",
    title: "Be polite right away",
    eyebrow: "The polite handful",
    description: "Thank someone, ask kindly, apologize, and keep small moments easy.",
    outcome: "Move through a visit without every request feeling abrupt.",
    minutes: 4,
    words: [
      {
        telugu: "ధన్యవాదాలు",
        roman: "dhanyavaadaalu",
        english: "thank you",
        note: "Clear and respectful; your family may use a shorter local expression in casual speech.",
      },
      {
        telugu: "దయచేసి",
        roman: "dayachesi",
        english: "please",
        note: "A polite form that can sound formal in some families.",
      },
      {
        telugu: "పరవాలేదు",
        roman: "paravaaledu",
        english: "it’s okay / no problem",
      },
      {
        telugu: "క్షమించండి",
        roman: "kshaminchandi",
        english: "sorry / excuse me",
        note: "A respectful form for apologies or getting someone’s attention.",
      },
    ],
  },
  {
    id: "yes-no-okay",
    group: "quick-start",
    title: "Give a quick answer",
    eyebrow: "Answer right away",
    description: "Say yes, no, okay, or “I don’t know” without switching languages.",
    outcome: "Respond even when you are not ready for a full sentence.",
    minutes: 3,
    words: [
      { telugu: "అవును", roman: "avunu", english: "yes" },
      { telugu: "కాదు", roman: "kaadu", english: "no" },
      { telugu: "సరే", roman: "sare", english: "okay" },
      { telugu: "తెలియదు", roman: "teliyadu", english: "I don’t know" },
    ],
  },
  {
    id: "names-introductions",
    group: "quick-start",
    title: "Introduce yourself",
    eyebrow: "Meet someone",
    description: "Ask a name, offer yours, and get through a first introduction.",
    outcome: "Meet a relative or family friend without rehearsing a speech.",
    minutes: 4,
    words: [
      {
        telugu: "మీ పేరు ఏంటి?",
        roman: "mee peru enti?",
        english: "what is your name?",
        note: "A common spoken form. “Mee peru emiti?” is a slightly more formal alternative.",
      },
      {
        telugu: "నా పేరు…",
        roman: "naa peru…",
        english: "my name is…",
      },
      {
        telugu: "మిమ్మల్ని కలవడం సంతోషం",
        roman: "mimmalni kalavadam santosham",
        english: "nice to meet you",
        note: "Respectful and a little formal; ask your family how they shorten it.",
      },
      {
        telugu: "మీరు ఎక్కడి నుంచి?",
        roman: "meeru ekkadi nunchi?",
        english: "where are you from?",
      },
    ],
  },
  {
    id: "family-words",
    group: "quick-start",
    title: "Check in with family",
    eyebrow: "At home",
    description: "Ask the warm questions that come up as soon as everyone sits down.",
    outcome: "Join the first few minutes of a family visit.",
    minutes: 4,
    words: [
      {
        telugu: "తిన్నారా?",
        roman: "tinnaaraa?",
        english: "have you eaten?",
        note: "A warm, everyday family check-in; especially common in casual speech.",
      },
      {
        telugu: "మీరు ఎలా ఉన్నారు?",
        roman: "meeru elaa unnaaru?",
        english: "how are you? (respectful)",
      },
      {
        telugu: "మీరు ఎక్కడ ఉన్నారు?",
        roman: "meeru ekkada unnaaru?",
        english: "where are you?",
      },
      {
        telugu: "అమ్మ ఇంట్లో ఉన్నారా?",
        roman: "amma intlo unnaaraa?",
        english: "is mom at home?",
      },
    ],
  },
  {
    id: "food-water",
    group: "quick-start",
    title: "Sit down to eat",
    eyebrow: "At the table",
    description: "Ask for water, praise the food, take a little more, or say you have enough.",
    outcome: "Handle the most common moments around a family meal.",
    minutes: 4,
    words: [
      {
        telugu: "నీళ్లు కావాలి",
        roman: "neellu kaavaali",
        english: "I would like water",
      },
      {
        telugu: "ఇది చాలా బాగుంది",
        roman: "idi chaalaa baagundi",
        english: "this is very good",
      },
      {
        telugu: "ఇంకొంచెం",
        roman: "inkonchem",
        english: "a little more",
      },
      {
        telugu: "చాలు",
        roman: "chaalu",
        english: "that’s enough",
        note: "Useful at the table; tone does a lot of the politeness work.",
      },
    ],
  },
  {
    id: "when-stuck",
    group: "quick-start",
    title: "Keep up when you’re stuck",
    eyebrow: "Stay in the conversation",
    description: "Say what is wrong, slow things down, and hear the phrase one more time.",
    outcome: "Stay in Telugu instead of ending the conversation.",
    minutes: 4,
    words: [
      {
        telugu: "నాకు అర్థం కాలేదు",
        roman: "naaku artham kaaledu",
        english: "I didn’t understand",
      },
      {
        telugu: "మెల్లగా చెప్పండి",
        roman: "mellagaa cheppandi",
        english: "please say it slowly",
      },
      {
        telugu: "మళ్లీ చెప్పండి",
        roman: "malli cheppandi",
        english: "please say it again",
      },
      {
        telugu: "నాకు తెలుగు బాగా రాదు",
        roman: "naaku telugu baagaa raadu",
        english: "I don’t know Telugu well",
        note: "A practical way to set expectations without abandoning the conversation.",
      },
    ],
  },
  {
    id: "essentials-milestone",
    group: "quick-start",
    title: "Your first real visit",
    eyebrow: "30-minute check",
    description: "Run the phrases you will reach for first, all in one quick practice.",
    outcome: "Feel ready to greet, respond, ask, eat, and recover.",
    minutes: 5,
    milestone: true,
    words: [
      { telugu: "నమస్కారం", roman: "namaskaaram", english: "hello" },
      { telugu: "ధన్యవాదాలు", roman: "dhanyavaadaalu", english: "thank you" },
      {
        telugu: "మీ పేరు ఏంటి?",
        roman: "mee peru enti?",
        english: "what is your name?",
      },
      {
        telugu: "మళ్లీ చెప్పండి",
        roman: "malli cheppandi",
        english: "please say it again",
      },
    ],
  },
  {
    id: "first-feelings",
    group: "family",
    title: "Say how you’re doing",
    eyebrow: "Check in",
    description: "Answer honestly and ask how someone else is feeling.",
    outcome: "Get through a real check-in with more than “fine.”",
    minutes: 4,
    words: [
      {
        telugu: "నేను బాగున్నాను",
        roman: "nenu baagunnaanu",
        english: "I am well",
      },
      {
        telugu: "నాకు అలసటగా ఉంది",
        roman: "naaku alasatagaa undi",
        english: "I am tired",
      },
      {
        telugu: "నాకు సంతోషంగా ఉంది",
        roman: "naaku santoshamgaa undi",
        english: "I am happy",
      },
      {
        telugu: "మీరు ఎలా ఉన్నారు?",
        roman: "meeru elaa unnaaru?",
        english: "how are you?",
      },
    ],
  },
  {
    id: "i-you-we",
    group: "family",
    title: "Make a simple plan",
    eyebrow: "Before you go",
    description: "Say when you are coming, leaving, or meeting again.",
    outcome: "Coordinate the next small plan without switching to English.",
    minutes: 4,
    words: [
      {
        telugu: "నేను రేపు వస్తాను",
        roman: "nenu repu vastaanu",
        english: "I’ll come tomorrow",
      },
      {
        telugu: "మీరు ఎప్పుడు ఇంట్లో ఉంటారు?",
        roman: "meeru eppudu intlo untaaru?",
        english: "when will you be home?",
      },
      {
        telugu: "నేను ఇప్పుడు బయల్దేరాను",
        roman: "nenu ippudu bayalderaanu",
        english: "I’m leaving now",
      },
      {
        telugu: "మళ్లీ కలుద్దాం",
        roman: "malli kaluddaam",
        english: "let’s meet again",
      },
    ],
  },
  {
    id: "this-that",
    group: "out-and-about",
    title: "Point & choose",
    eyebrow: "Make it clear",
    description: "Choose what you want and reject what you do not.",
    outcome: "Get through a counter, stall, or quick choice with less explaining.",
    minutes: 3,
    words: [
      {
        telugu: "నాకు ఇది కావాలి",
        roman: "naaku idi kaavaali",
        english: "I want this",
      },
      {
        telugu: "నాకు ఇది వద్దు",
        roman: "naaku idi vaddu",
        english: "I don’t want this",
      },
      { telugu: "ఇది ఎంత?", roman: "idi enta?", english: "how much is this?" },
      { telugu: "అది", roman: "adi", english: "that one" },
    ],
  },
  {
    id: "question-words",
    group: "out-and-about",
    title: "Find your way",
    eyebrow: "Getting around",
    description: "Find the bus stop, confirm the route, and ask someone to stop.",
    outcome: "Handle the most useful directions without a long exchange.",
    minutes: 4,
    words: [
      {
        telugu: "బస్ స్టాప్ ఎక్కడ ఉంది?",
        roman: "bus stop ekkada undi?",
        english: "where is the bus stop?",
      },
      {
        telugu: "ఇక్కడ ఆపండి దయచేసి",
        roman: "ikkada aapandi dayachesi",
        english: "stop here, please",
      },
      {
        telugu: "సూటిగా వెళ్ళండి",
        roman: "sootigaa vellandi",
        english: "go straight",
      },
      {
        telugu: "ఇది అక్కడికి వెళ్లే దారినా?",
        roman: "idi akkadiki velle daarinaa?",
        english: "is this the way there?",
      },
    ],
  },
  {
    id: "first-conversation",
    group: "out-and-about",
    title: "Shop & pay",
    eyebrow: "At the counter",
    description: "Ask the price, react, and finish a small purchase.",
    outcome: "Handle a quick purchase without handing the whole interaction to English.",
    minutes: 4,
    words: [
      { telugu: "ఇది ఎంత?", roman: "idi enta?", english: "how much is this?" },
      {
        telugu: "చాలా ఖరీదు",
        roman: "chaalaa khareedu",
        english: "too expensive",
      },
      {
        telugu: "ధర తగ్గించగలరా?",
        roman: "dhara tagginchagalaraa?",
        english: "can you reduce the price?",
      },
      {
        telugu: "చేంజ్ ఉందా?",
        roman: "change undaa?",
        english: "do you have change?",
        note: "Everyday urban Telugu often keeps the English word “change.”",
      },
    ],
  },
  {
    id: "building-blocks-milestone",
    group: "backup",
    title: "Say you don’t feel well",
    eyebrow: "Get help",
    description: "Explain that something is wrong and ask for a doctor or help.",
    outcome: "Have a calm first sentence ready when you need support.",
    minutes: 4,
    words: [
      {
        telugu: "నాకు ఒంట్లో బాగా లేదు",
        roman: "naaku ontlo baagaa ledu",
        english: "I’m not feeling well",
      },
      {
        telugu: "నాకు కొంచెం జ్వరంగా ఉంది",
        roman: "naaku konchem jwarangaa undi",
        english: "I have a slight fever",
      },
      {
        telugu: "నాకు డాక్టర్ కావాలి",
        roman: "naaku doctor kaavaali",
        english: "I need a doctor",
      },
      {
        telugu: "నాకు సహాయం కావాలి",
        roman: "naaku sahaayam kaavaali",
        english: "I need help",
      },
    ],
  },
];

export const practicalLessons: Lesson[] = practicalLessonSources.map(
  (lesson) => ({
    ...lesson,
    words: lesson.words.map(addLearnerPronunciation),
  }),
);

export const quickStartLessons = practicalLessons.filter(
  (lesson) => lesson.group === "quick-start",
);

export const allLessons = practicalLessons;

export function findLesson(id: string | null | undefined) {
  return practicalLessons.find((lesson) => lesson.id === id);
}

function findPracticeWord(lessonId: string, english: string) {
  const lesson = findLesson(lessonId);
  const word = lesson?.words.find((candidate) => candidate.english === english);

  if (!word) {
    throw new Error(`Missing practice phrase: ${lessonId}/${english}`);
  }

  return word;
}

export const practicePacks: PracticePack[] = [
  {
    id: "first-five",
    title: "Your first five",
    outcome:
      "Greet someone, thank them, ask a name, request water, and ask for a repeat.",
    words: [
      findPracticeWord("hello-goodbye", "hello"),
      findPracticeWord("please-thank-you", "thank you"),
      findPracticeWord("names-introductions", "what is your name?"),
      findPracticeWord("food-water", "I would like water"),
      findPracticeWord("when-stuck", "please say it again"),
    ],
  },
  {
    id: "quick-replies",
    title: "Quick replies",
    outcome:
      "Answer the questions you hear first without dropping back into English.",
    words: [
      findPracticeWord("hello-goodbye", "how are you? (respectful)"),
      findPracticeWord("hello-goodbye", "I’m well"),
      findPracticeWord("yes-no-okay", "yes"),
      findPracticeWord("yes-no-okay", "no"),
      findPracticeWord("yes-no-okay", "okay"),
    ],
  },
  {
    id: "everyday-courtesy",
    title: "Everyday courtesy",
    outcome:
      "Make a request, apologize, and handle small social moments naturally.",
    words: [
      findPracticeWord("please-thank-you", "please"),
      findPracticeWord("please-thank-you", "it’s okay / no problem"),
      findPracticeWord("please-thank-you", "sorry / excuse me"),
      findPracticeWord("yes-no-okay", "I don’t know"),
      findPracticeWord("when-stuck", "please say it slowly"),
    ],
  },
  {
    id: "stay-connected",
    title: "Stay connected",
    outcome:
      "Recover when you are stuck, then introduce yourself without leaving Telugu.",
    words: [
      findPracticeWord("when-stuck", "I didn’t understand"),
      findPracticeWord("when-stuck", "I don’t know Telugu well"),
      findPracticeWord("names-introductions", "my name is…"),
      findPracticeWord("names-introductions", "nice to meet you"),
      findPracticeWord("names-introductions", "where are you from?"),
    ],
  },
  {
    id: "family-check-in",
    title: "Family check-in",
    outcome:
      "Join the familiar first conversation and answer how you are feeling.",
    words: [
      findPracticeWord("family-words", "have you eaten?"),
      findPracticeWord("family-words", "how are you? (respectful)"),
      findPracticeWord("first-feelings", "I am well"),
      findPracticeWord("first-feelings", "I am tired"),
      findPracticeWord("first-feelings", "I am happy"),
    ],
  },
  {
    id: "at-the-table",
    title: "At the table",
    outcome:
      "Respond while food is being served and make a simple choice clearly.",
    words: [
      findPracticeWord("food-water", "this is very good"),
      findPracticeWord("food-water", "a little more"),
      findPracticeWord("food-water", "that’s enough"),
      findPracticeWord("this-that", "I want this"),
      findPracticeWord("this-that", "I don’t want this"),
    ],
  },
  {
    id: "make-a-plan",
    title: "Make a plan",
    outcome:
      "Find family members and coordinate a simple arrival or departure.",
    words: [
      findPracticeWord("family-words", "where are you?"),
      findPracticeWord("family-words", "is mom at home?"),
      findPracticeWord("i-you-we", "I’ll come tomorrow"),
      findPracticeWord("i-you-we", "when will you be home?"),
      findPracticeWord("i-you-we", "I’m leaving now"),
    ],
  },
  {
    id: "shop-and-pay",
    title: "Shop and pay",
    outcome:
      "Point, choose, ask the price, and get through a small purchase.",
    words: [
      findPracticeWord("this-that", "that one"),
      findPracticeWord("this-that", "how much is this?"),
      findPracticeWord("first-conversation", "too expensive"),
      findPracticeWord("first-conversation", "can you reduce the price?"),
      findPracticeWord("first-conversation", "do you have change?"),
    ],
  },
  {
    id: "get-around",
    title: "Get around",
    outcome:
      "Ask for directions, stop a ride, and end the exchange warmly.",
    words: [
      findPracticeWord("question-words", "where is the bus stop?"),
      findPracticeWord("question-words", "stop here, please"),
      findPracticeWord("question-words", "go straight"),
      findPracticeWord("question-words", "is this the way there?"),
      findPracticeWord("hello-goodbye", "see you again"),
    ],
  },
  {
    id: "ask-for-help",
    title: "Ask for help",
    outcome:
      "Say that something is wrong and ask clearly for the support you need.",
    words: [
      findPracticeWord("building-blocks-milestone", "I’m not feeling well"),
      findPracticeWord("building-blocks-milestone", "I have a slight fever"),
      findPracticeWord("building-blocks-milestone", "I need a doctor"),
      findPracticeWord("building-blocks-milestone", "I need help"),
    ],
  },
];
