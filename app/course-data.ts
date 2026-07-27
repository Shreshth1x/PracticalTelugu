export type TrackId = "essentials" | "foundations";

export type TeluguWord = {
  telugu: string;
  roman: string;
  english: string;
  note?: string;
  audioSrc?: string;
};

export type Lesson = {
  id: string;
  track: TrackId;
  title: string;
  eyebrow: string;
  description: string;
  icon: string;
  xp: number;
  words: TeluguWord[];
  milestone?: boolean;
};

export type LockedUnit = {
  number: number;
  title: string;
  icon: string;
  unlockCopy: string;
};

export const essentialsLessons: Lesson[] = [
  {
    id: "hello-goodbye",
    track: "essentials",
    title: "Hello & goodbye",
    eyebrow: "The first two minutes",
    description: "Walk in, greet everyone, and leave warmly.",
    icon: "👋",
    xp: 20,
    words: [
      {
        telugu: "నమస్కారం",
        roman: "namaskaaram",
        english: "hello / respectful greeting",
      },
      {
        telugu: "ఎలా ఉన్నారు?",
        roman: "elaa unnaaru?",
        english: "how are you? (respectful)",
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
    track: "essentials",
    title: "Please & thank you",
    eyebrow: "The polite handful",
    description: "Four phrases that carry a whole conversation.",
    icon: "🤝",
    xp: 20,
    words: [
      {
        telugu: "ధన్యవాదాలు",
        roman: "dhanyavaadaalu",
        english: "thank you",
      },
      {
        telugu: "దయచేసి",
        roman: "dayachesi",
        english: "please",
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
      },
    ],
  },
  {
    id: "names-introductions",
    track: "essentials",
    title: "Names & introductions",
    eyebrow: "Meet someone",
    description: "Ask a name and offer yours without overthinking it.",
    icon: "💬",
    xp: 20,
    words: [
      {
        telugu: "మీ పేరు ఏంటి?",
        roman: "mee peru enti?",
        english: "what is your name?",
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
    track: "essentials",
    title: "Family words",
    eyebrow: "Around the family",
    description: "The people you are most likely learning this for.",
    icon: "🏠",
    xp: 20,
    words: [
      { telugu: "అమ్మ", roman: "amma", english: "mom" },
      { telugu: "నాన్న", roman: "naanna", english: "dad" },
      { telugu: "అమ్మమ్మ", roman: "ammamma", english: "maternal grandmother" },
      { telugu: "తాతయ్య", roman: "taatayya", english: "grandfather" },
    ],
  },
  {
    id: "food-water",
    track: "essentials",
    title: "Food & water",
    eyebrow: "At the table",
    description: "Ask for what you need and give the cook their flowers.",
    icon: "🥣",
    xp: 20,
    words: [
      {
        telugu: "నీళ్లు కావాలి",
        roman: "neellu kaavaali",
        english: "I would like water",
      },
      {
        telugu: "నాకు ఆకలిగా ఉంది",
        roman: "naaku aakaligaa undi",
        english: "I’m hungry",
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
    ],
  },
  {
    id: "when-stuck",
    track: "essentials",
    title: "When you’re stuck",
    eyebrow: "Keep the conversation going",
    description: "Slow it down, hear it again, and ask for help.",
    icon: "🛟",
    xp: 20,
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
        telugu: "సహాయం చేయండి",
        roman: "sahaayam cheyandi",
        english: "please help",
      },
    ],
  },
  {
    id: "essentials-milestone",
    track: "essentials",
    title: "First visit ready",
    eyebrow: "Essentials milestone",
    description: "A quick mix of the phrases you will reach for first.",
    icon: "🦚",
    xp: 30,
    milestone: true,
    words: [
      {
        telugu: "నమస్కారం",
        roman: "namaskaaram",
        english: "hello",
      },
      {
        telugu: "ధన్యవాదాలు",
        roman: "dhanyavaadaalu",
        english: "thank you",
      },
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
];

export const foundationLessons: Lesson[] = [
  {
    id: "i-you-we",
    track: "foundations",
    title: "I, you & we",
    eyebrow: "Building blocks",
    description: "Start with the people inside every sentence.",
    icon: "●",
    xp: 20,
    words: [
      { telugu: "నేను", roman: "nenu", english: "I" },
      { telugu: "మీరు", roman: "meeru", english: "you (respectful)" },
      { telugu: "నువ్వు", roman: "nuvvu", english: "you (familiar)" },
      { telugu: "మనం", roman: "manam", english: "we (including you)" },
    ],
  },
  {
    id: "yes-no-okay",
    track: "foundations",
    title: "Yes, no & okay",
    eyebrow: "Building blocks",
    description: "The smallest answers do the most work.",
    icon: "✓",
    xp: 20,
    words: [
      { telugu: "అవును", roman: "avunu", english: "yes" },
      { telugu: "కాదు", roman: "kaadu", english: "no" },
      { telugu: "సరే", roman: "sare", english: "okay" },
      { telugu: "తెలియదు", roman: "teliyadu", english: "I don’t know" },
    ],
  },
  {
    id: "this-that",
    track: "foundations",
    title: "This & that",
    eyebrow: "Building blocks",
    description: "Point to the world around you.",
    icon: "↔",
    xp: 20,
    words: [
      { telugu: "ఇది", roman: "idi", english: "this" },
      { telugu: "అది", roman: "adi", english: "that" },
      { telugu: "ఇక్కడ", roman: "ikkada", english: "here" },
      { telugu: "అక్కడ", roman: "akkada", english: "there" },
    ],
  },
  {
    id: "question-words",
    track: "foundations",
    title: "Tiny questions",
    eyebrow: "Building blocks",
    description: "Four words that open up a conversation.",
    icon: "?",
    xp: 20,
    words: [
      { telugu: "ఎవరు?", roman: "evaru?", english: "who?" },
      { telugu: "ఏంటి?", roman: "enti?", english: "what?" },
      { telugu: "ఎక్కడ?", roman: "ekkada?", english: "where?" },
      { telugu: "ఎప్పుడు?", roman: "eppudu?", english: "when?" },
    ],
  },
  {
    id: "first-feelings",
    track: "foundations",
    title: "How you feel",
    eyebrow: "Building blocks",
    description: "Move from words into useful little sentences.",
    icon: "☀",
    xp: 20,
    words: [
      {
        telugu: "నేను బాగున్నాను",
        roman: "nenu baagunnaanu",
        english: "I am well",
      },
      {
        telugu: "నాకు సంతోషంగా ఉంది",
        roman: "naaku santoshamgaa undi",
        english: "I am happy",
      },
      {
        telugu: "నాకు అలసటగా ఉంది",
        roman: "naaku alasatagaa undi",
        english: "I am tired",
      },
      {
        telugu: "మీరు ఎలా ఉన్నారు?",
        roman: "meeru elaa unnaaru?",
        english: "how are you?",
      },
    ],
  },
  {
    id: "first-conversation",
    track: "foundations",
    title: "First conversation",
    eyebrow: "Building blocks",
    description: "Put your first pieces together out loud.",
    icon: "••",
    xp: 20,
    words: [
      {
        telugu: "నమస్కారం",
        roman: "namaskaaram",
        english: "hello",
      },
      {
        telugu: "మీరు ఎలా ఉన్నారు?",
        roman: "meeru elaa unnaaru?",
        english: "how are you?",
      },
      {
        telugu: "నేను బాగున్నాను",
        roman: "nenu baagunnaanu",
        english: "I am well",
      },
      {
        telugu: "మరి మీరు?",
        roman: "mari meeru?",
        english: "and you?",
      },
    ],
  },
  {
    id: "building-blocks-milestone",
    track: "foundations",
    title: "A small conversation",
    eyebrow: "Unit 1 milestone",
    description: "Show Mayu what you can already understand.",
    icon: "✦",
    xp: 30,
    milestone: true,
    words: [
      { telugu: "నేను", roman: "nenu", english: "I" },
      { telugu: "అవును", roman: "avunu", english: "yes" },
      { telugu: "ఇక్కడ", roman: "ikkada", english: "here" },
      {
        telugu: "మరి మీరు?",
        roman: "mari meeru?",
        english: "and you?",
      },
    ],
  },
];

export const lockedUnits: LockedUnit[] = [
  {
    number: 2,
    title: "Telugu script & sounds",
    icon: "అ",
    unlockCopy: "Complete 5 Building Blocks lessons to unlock.",
  },
  {
    number: 3,
    title: "People & family",
    icon: "ఇ",
    unlockCopy: "Unlocks after Telugu script & sounds.",
  },
  {
    number: 4,
    title: "Home & daily life",
    icon: "ఉ",
    unlockCopy: "Unlocks after People & family.",
  },
  {
    number: 5,
    title: "Food & hospitality",
    icon: "ఎ",
    unlockCopy: "Unlocks after Home & daily life.",
  },
  {
    number: 6,
    title: "Numbers & time",
    icon: "ఒ",
    unlockCopy: "Unlocks after Food & hospitality.",
  },
  {
    number: 7,
    title: "Getting around",
    icon: "క",
    unlockCopy: "Unlocks after Numbers & time.",
  },
  {
    number: 8,
    title: "Stories & celebrations",
    icon: "త",
    unlockCopy: "Unlocks after Getting around.",
  },
];

export const allLessons = [...essentialsLessons, ...foundationLessons];

export function findLesson(id: string | null | undefined) {
  return allLessons.find((lesson) => lesson.id === id);
}
