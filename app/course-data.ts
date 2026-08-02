import { resolvePhraseAudioSrc } from "./phrase-audio.ts";

export type SituationGroup =
  | "quick-start"
  | "family"
  | "out-and-about"
  | "backup";

export type TeluguAudience = "anyone" | "familiar" | "respectful";

export type TeluguUsageKind =
  | "relationship"
  | "courtesy"
  | "style"
  | "referent-honor";

export type TeluguFormUsage = {
  audience: TeluguAudience;
  kind: TeluguUsageKind;
  label?: string;
  guidance?: string;
};

export const teluguRelationshipGuidance =
  "Use the familiar form only with someone you know well. For an elder or anyone new, use the respectful form, even if they are your age.";

export const teluguAudienceGuidance: Record<
  TeluguAudience,
  { label: string; guidance: string }
> = {
  anyone: {
    label: "Works with anyone",
    guidance: "This form does not depend on who is listening.",
  },
  familiar: {
    label: "Someone close",
    guidance:
      "Use this with a sibling, close friend, or someone you genuinely know well. Being the same age is not enough by itself.",
  },
  respectful: {
    label: "Elder or someone new",
    guidance:
      "This is the safe choice for an elder or anyone new or unknown, even if they are your age.",
  },
};

export type ResolvedTeluguFormUsage = {
  audience: TeluguAudience;
  kind: TeluguUsageKind | "default";
  label: string;
  guidance: string;
  showContext: boolean;
};

export function resolveTeluguFormUsage(
  usage?: TeluguFormUsage,
): ResolvedTeluguFormUsage {
  if (!usage) {
    return {
      audience: "anyone",
      kind: "default",
      ...teluguAudienceGuidance.anyone,
      showContext: false,
    };
  }

  const audienceGuidance = teluguAudienceGuidance[usage.audience];

  if (usage.kind === "courtesy") {
    return {
      audience: usage.audience,
      kind: usage.kind,
      label: usage.label ?? "Polite with a stranger",
      guidance:
        usage.guidance ??
        "Respectful wording is the safe choice with a stranger, service worker, or anyone you do not know well.",
      showContext: true,
    };
  }

  if (usage.kind === "referent-honor") {
    return {
      audience: usage.audience,
      kind: usage.kind,
      label: usage.label ?? "Honors the person mentioned",
      guidance:
        usage.guidance ??
        "The respectful ending honors the person being discussed, not necessarily the person listening.",
      showContext: true,
    };
  }

  return {
    audience: usage.audience,
    kind: usage.kind,
    label: usage.label ?? audienceGuidance.label,
    guidance: usage.guidance ?? audienceGuidance.guidance,
    showContext:
      usage.kind === "relationship" || Boolean(usage.label || usage.guidance),
  };
}

const familiarListenerUsage: TeluguFormUsage = {
  audience: "familiar",
  kind: "relationship",
};

const respectfulListenerUsage: TeluguFormUsage = {
  audience: "respectful",
  kind: "relationship",
};

const politeStrangerUsage: TeluguFormUsage = {
  audience: "respectful",
  kind: "courtesy",
};

const styleVariantUsage: TeluguFormUsage = {
  audience: "anyone",
  kind: "style",
};

export type TeluguAlternative = {
  label: string;
  telugu: string;
  roman: string;
  pronunciation: string;
  audioSrc?: string;
  usage?: TeluguFormUsage;
};

export type TeluguWord = {
  id: string;
  progressKey: string;
  telugu: string;
  roman: string;
  pronunciation: string;
  english: string;
  note?: string;
  audioSrc?: string;
  alternatives?: TeluguAlternative[];
  usage?: TeluguFormUsage;
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

type TeluguAlternativeSource = Omit<TeluguAlternative, "pronunciation"> & {
  pronunciation?: string;
};

type TeluguWordSource = Omit<
  TeluguWord,
  "pronunciation" | "alternatives"
> & {
  pronunciation?: string;
  alternatives?: TeluguAlternativeSource[];
};
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
  "నమస్కారం అండి": "nuh-muh-SKAA-rum UN-dee",
  "ఎలా ఉన్నావు?": "eh-LAA oon-NAA-voo?",
  "ఎలా ఉన్నారు?": "eh-LAA oon-NAA-roo?",
  "బాగున్నాను": "baa-goon-NAA-noo",
  "మళ్లీ కలుద్దాం": "mul-LEE kuh-lood-DAAM",
  "ధన్యవాదాలు": "dun-yuh-VAA-daa-loo",
  "దయచేసి": "duh-yuh-CHAY-see",
  "పర్లేదు": "pur-LAY-doo",
  "పరవాలేదు": "puh-ruh-vaa-LAY-doo",
  "క్షమించండి": "kshuh-min-CHUN-dee",
  "మన్నించండి": "mun-nin-CHUN-dee",
  "అవును": "uh-VOO-noo",
  "కాదు": "KAA-doo",
  "సరే": "suh-RAY",
  "తెలియదు": "teh-lee-YUH-doo",
  "నీ పేరు ఏంటి?": "NEE PAY-roo AYN-tee?",
  "మీ పేరు ఏంటి?": "MEE PAY-roo AYN-tee?",
  "నా పేరు…": "NAA PAY-roo…",
  "చాలా సంతోషం": "CHAA-laa sun-TOH-shum",
  "మిమ్మల్ని కలిసినందుకు సంతోషం":
    "mim-MUL-nee kuh-lee-see-NUN-doo-koo sun-TOH-shum",
  "ఎక్కడి నుంచి?": "ek-KUH-dee NOON-chee?",
  "మీరు ఎక్కడి నుంచి?": "MEE-roo ek-KUH-dee NOON-chee?",
  "తిన్నావా?": "tin-NAA-vaa?",
  "తిన్నారా?": "tin-NAA-raa?",
  "బాగున్నావా?": "baa-goon-NAA-vaa?",
  "బాగున్నారా?": "baa-goon-NAA-raa?",
  "ఎక్కడున్నావు?": "ek-kuh-DOON-naa-voo?",
  "ఎక్కడున్నారు?": "ek-kuh-DOON-naa-roo?",
  "అమ్మ ఇంట్లో ఉన్నారా?": "UM-muh IN-tloh oon-NAA-raa?",
  "నీళ్లు ఇస్తారా?": "NEE-lloo is-TAA-raa?",
  "నీళ్లు ఇస్తావా?": "NEE-lloo is-TAA-vaa?",
  "చాలా బాగుంది": "CHAA-laa BAA-goon-dee",
  "ఇంకొంచెం": "in-KON-chem",
  "చాలు": "CHAA-loo",
  "అర్థం కాలేదు": "AR-thum kaa-LAY-doo",
  "కొంచెం మెల్లగా చెప్పండి": "KON-chem mel-luh-GAA chep-PUN-dee",
  "కొంచెం మెల్లగా చెప్పు": "KON-chem mel-luh-GAA CHEP-poo",
  "మళ్లీ చెప్పండి": "mul-LEE chep-PUN-dee",
  "మళ్లీ చెప్పు": "mul-LEE CHEP-poo",
  "తెలుగు బాగా రాదు": "TEH-loo-goo BAA-gaa RAA-doo",
  "బాగానే ఉన్నాను": "baa-GAA-nay oon-NAA-noo",
  "అలసిపోయాను": "uh-luh-see-poh-YAA-noo",
  "చాలా సంతోషంగా ఉన్నాను": "CHAA-laa sun-TOH-shum-gaa oon-NAA-noo",
  "రేపు వస్తా": "RAY-poo vus-TAA",
  "రేపు వస్తాను": "RAY-poo vus-TAA-noo",
  "ఎప్పుడు ఇంట్లో ఉంటావు?": "EP-poo-doo IN-tloh oon-TAA-voo?",
  "ఎప్పుడు ఇంట్లో ఉంటారు?": "EP-poo-doo IN-tloh oon-TAA-roo?",
  "ఇప్పుడే బయల్దేరుతున్నా":
    "IP-poo-day buh-yul-day-roo-TOON-naa",
  "ఇప్పుడే బయల్దేరుతున్నాను":
    "IP-poo-day buh-yul-day-roo-TOON-naa-noo",
  "ఇది కావాలి": "IH-dee KAA-vaa-lee",
  "ఇది వద్దు": "IH-dee VUD-doo",
  "ఇది ఎంత?": "IH-dee EN-tuh?",
  "అది": "UH-dee",
  "బస్సు ఎక్కడ ఆగుతుంది?": "BOOS-soo ek-KUH-duh AA-goo-toon-dee?",
  "బస్సు నిలయం ఎక్కడ?": "BOOS-soo ni-LUH-yum ek-KUH-duh?",
  "ఇక్కడ ఆపండి": "ik-KUH-duh AA-pun-dee",
  "నేరుగా వెళ్లండి": "NAY-roo-gaa vel-LUN-dee",
  "అక్కడికి ఇదే దారినా?": "uk-KUH-dee-kee ih-DAY DAA-ree-naa?",
  "చాలా ఎక్కువ": "CHAA-laa EK-koo-vuh",
  "కొంచెం తగ్గించండి": "KON-chem tug-gin-CHUN-dee",
  "కొంచెం తగ్గిస్తారా?": "KON-chem tug-gis-TAA-raa?",
  "చిల్లర ఉందా?": "CHIL-luh-raa OON-daa?",
  "ఒంట్లో బాగోలేదు": "ON-tloh BAA-goh-LAY-doo",
  "కొంచెం జ్వరం ఉంది": "KON-chem JWUH-rum OON-dee",
  "వైద్యుడు కావాలి": "VAI-dyoo-doo KAA-vaa-lee",
  "సహాయం కావాలి": "suh-HAA-yum KAA-vaa-lee",
};

function resolveLearnerPronunciation(
  telugu: string,
  pronunciation?: string,
) {
  const resolved = pronunciation ?? learnerPronunciations[telugu];

  if (!resolved) {
    throw new Error(`Missing learner pronunciation: ${telugu}`);
  }

  return resolved;
}

function addLearnerPronunciation(word: TeluguWordSource): TeluguWord {
  const { alternatives, pronunciation, ...rest } = word;

  return {
    ...rest,
    pronunciation: resolveLearnerPronunciation(word.telugu, pronunciation),
    audioSrc: rest.audioSrc ?? resolvePhraseAudioSrc(word.telugu),
    alternatives: alternatives?.map((alternative) => ({
      ...alternative,
      pronunciation: resolveLearnerPronunciation(
        alternative.telugu,
        alternative.pronunciation,
      ),
      audioSrc:
        alternative.audioSrc ?? resolvePhraseAudioSrc(alternative.telugu),
    })),
  };
}

const practicalLessonSources: LessonSource[] = [
  {
    id: "hello-goodbye",
    group: "quick-start",
    title: "Arrive & leave warmly",
    eyebrow: "The first two minutes",
    description:
      "Open with a complete Telugu greeting, then use the familiar check-in that follows.",
    outcome: "Walk into a visit and start talking without sounding rehearsed.",
    minutes: 4,
    words: [
      {
        id: "hello",
        progressKey: "నమస్కారం::hello",
        telugu: "నమస్కారం",
        roman: "namaskaaram",
        english: "hello",
        note: "A clear Telugu greeting that works especially well with elders and people you are meeting for the first time.",
        alternatives: [
          {
            label: "Extra respectful",
            telugu: "నమస్కారం అండి",
            roman: "namaskaaram andi",
            usage: {
              audience: "respectful",
              kind: "courtesy",
              guidance:
                "Adding andi gives the greeting extra warmth and respect, especially with an elder.",
            },
          },
        ],
      },
      {
        id: "how-are-you",
        progressKey: "ఎలా ఉన్నారు?::how are you? (respectful)",
        telugu: "ఎలా ఉన్నావు?",
        roman: "elaa unnaavu?",
        english: "how are you?",
        note: "Use this with a sibling, close friend, or someone you genuinely know well. For an elder or anyone new, use the respectful form, even if they are your age.",
        usage: familiarListenerUsage,
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "ఎలా ఉన్నారు?",
            roman: "elaa unnaaru?",
            usage: respectfulListenerUsage,
          },
        ],
      },
      {
        id: "im-well",
        progressKey: "బాగున్నాను::I’m well",
        telugu: "బాగున్నాను",
        roman: "baagunnaanu",
        english: "I’m well",
      },
      {
        id: "see-you-again",
        progressKey: "మళ్లీ కలుద్దాం::see you again",
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
    description:
      "Use Telugu words for gratitude, requests, and apologies without falling back on English.",
    outcome: "Thank, ask, and apologize clearly in Telugu.",
    minutes: 4,
    words: [
      {
        id: "thank-you",
        progressKey: "ధన్యవాదాలు::thank you",
        telugu: "ధన్యవాదాలు",
        roman: "dhanyavaadaalu",
        english: "thank you",
        note: "The standard Telugu expression of gratitude. It sounds deliberate and respectful.",
      },
      {
        id: "please",
        progressKey: "దయచేసి::please",
        telugu: "దయచేసి",
        roman: "dayachesi",
        english: "please",
        note: "Use this when you want to make a request explicitly polite. A respectful verb ending often does the same job in conversation.",
      },
      {
        id: "no-problem",
        progressKey: "పరవాలేదు::it’s okay / no problem",
        telugu: "పర్లేదు",
        roman: "parledu",
        english: "it’s okay / no problem",
        note: "The quick spoken version you are most likely to hear.",
        alternatives: [
          {
            label: "Full form",
            telugu: "పరవాలేదు",
            roman: "paravaaledu",
            usage: styleVariantUsage,
          },
        ],
      },
      {
        id: "sorry",
        progressKey: "క్షమించండి::sorry / excuse me",
        telugu: "క్షమించండి",
        roman: "kshaminchandi",
        english: "sorry",
        note: "A genuine Telugu apology that also carries the sense of “please forgive me.”",
        usage: politeStrangerUsage,
        alternatives: [
          {
            label: "Pardon me / forgive me",
            telugu: "మన్నించండి",
            roman: "manninchandi",
            usage: {
              audience: "respectful",
              kind: "style",
              label: "Pardon me / forgive me",
              guidance:
                "This is another respectful apology; the difference is meaning, not a different listener relationship.",
            },
          },
        ],
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
      {
        id: "yes",
        progressKey: "అవును::yes",
        telugu: "అవును",
        roman: "avunu",
        english: "yes",
      },
      {
        id: "no",
        progressKey: "కాదు::no",
        telugu: "కాదు",
        roman: "kaadu",
        english: "no",
      },
      {
        id: "okay",
        progressKey: "సరే::okay",
        telugu: "సరే",
        roman: "sare",
        english: "okay",
      },
      {
        id: "dont-know",
        progressKey: "తెలియదు::I don’t know",
        telugu: "తెలియదు",
        roman: "teliyadu",
        english: "I don’t know",
      },
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
        id: "ask-name",
        progressKey: "మీ పేరు ఏంటి?::what is your name?",
        telugu: "నీ పేరు ఏంటి?",
        roman: "nee peru enti?",
        english: "what is your name?",
        note: "Use nee with a sibling, close friend, or someone you genuinely know well. Use mee for an elder or anyone new or unknown, even if they are your age.",
        usage: familiarListenerUsage,
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "మీ పేరు ఏంటి?",
            roman: "mee peru enti?",
            usage: respectfulListenerUsage,
          },
        ],
      },
      {
        id: "my-name",
        progressKey: "నా పేరు…::my name is…",
        telugu: "నా పేరు…",
        roman: "naa peru…",
        english: "my name is…",
      },
      {
        id: "happy-to-meet-you",
        progressKey: "మిమ్మల్ని కలవడం సంతోషం::nice to meet you",
        telugu: "చాలా సంతోషం",
        roman: "chaalaa santosham",
        english: "so nice to see you",
        note: "Telugu has no obligatory fixed “nice to meet you” formula. This is a warm reaction, not a required script.",
        alternatives: [
          {
            label: "Formal Telugu",
            telugu: "మిమ్మల్ని కలిసినందుకు సంతోషం",
            roman: "mimmalni kalisinanduku santosham",
            usage: {
              audience: "respectful",
              kind: "style",
              label: "Formal, respectful Telugu",
              guidance:
                "Mimmalni is respectful or plural. This full sentence is more formal than the everyday reaction chaalaa santosham.",
            },
          },
        ],
      },
      {
        id: "where-from",
        progressKey: "మీరు ఎక్కడి నుంచి?::where are you from?",
        telugu: "ఎక్కడి నుంచి?",
        roman: "ekkadi nunchi?",
        english: "where are you from?",
        note: "Telugu often drops the pronoun when the person is already clear.",
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "మీరు ఎక్కడి నుంచి?",
            roman: "meeru ekkadi nunchi?",
            usage: respectfulListenerUsage,
          },
        ],
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
        id: "have-you-eaten",
        progressKey: "తిన్నారా?::have you eaten?",
        telugu: "తిన్నావా?",
        roman: "tinnaavaa?",
        english: "have you eaten?",
        note: "A warm check-in with siblings, cousins, and close friends.",
        usage: familiarListenerUsage,
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "తిన్నారా?",
            roman: "tinnaaraa?",
            usage: respectfulListenerUsage,
          },
        ],
      },
      {
        id: "family-how-are-you",
        progressKey: "మీరు ఎలా ఉన్నారు?::how are you? (respectful)",
        telugu: "బాగున్నావా?",
        roman: "baagunnaavaa?",
        english: "are you doing well?",
        note: "A natural check-in for a sibling, close cousin, or friend you know well. Use the respectful ending for an elder or anyone new.",
        usage: familiarListenerUsage,
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "బాగున్నారా?",
            roman: "baagunnaaraa?",
            usage: respectfulListenerUsage,
          },
        ],
      },
      {
        id: "where-are-you",
        progressKey: "మీరు ఎక్కడ ఉన్నారు?::where are you?",
        telugu: "ఎక్కడున్నావు?",
        roman: "ekkadunnaavu?",
        english: "where are you?",
        note: "The words run together naturally in everyday speech. This ending is for someone you know well; use the respectful form with an elder or anyone new.",
        usage: familiarListenerUsage,
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "ఎక్కడున్నారు?",
            roman: "ekkadunnaaru?",
            usage: respectfulListenerUsage,
          },
        ],
      },
      {
        id: "is-mom-home",
        progressKey: "అమ్మ ఇంట్లో ఉన్నారా?::is mom at home?",
        telugu: "అమ్మ ఇంట్లో ఉన్నారా?",
        roman: "amma intlo unnaaraa?",
        english: "is mom at home?",
        note: "The -aaru ending honors Mom, the person you are asking about. It does not necessarily mark respect toward the listener.",
        usage: {
          audience: "anyone",
          kind: "referent-honor",
          label: "Honors Mom",
          guidance:
            "Here -aaru honors Mom, the person being discussed; it does not tell you how respectfully you are addressing the listener.",
        },
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
        id: "water",
        progressKey: "నీళ్లు కావాలి::I would like water",
        telugu: "నీళ్లు ఇస్తారా?",
        roman: "neellu istaaraa?",
        english: "could I have some water?",
        note: "Literally, “Would you give me water?” This respectful form is a natural choice with an elder or anyone new.",
        usage: respectfulListenerUsage,
        alternatives: [
          {
            label: "With family or friends",
            telugu: "నీళ్లు ఇస్తావా?",
            roman: "neellu istaavaa?",
            usage: familiarListenerUsage,
          },
        ],
      },
      {
        id: "food-is-good",
        progressKey: "ఇది చాలా బాగుంది::this is very good",
        telugu: "చాలా బాగుంది",
        roman: "chaalaa baagundi",
        english: "this is really good",
        note: "The subject is obvious at the table, so you can leave out “idi” (“this”).",
      },
      {
        id: "little-more",
        progressKey: "ఇంకొంచెం::a little more",
        telugu: "ఇంకొంచెం",
        roman: "inkonchem",
        english: "a little more",
      },
      {
        id: "enough",
        progressKey: "చాలు::that’s enough",
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
        id: "didnt-understand",
        progressKey: "నాకు అర్థం కాలేదు::I didn’t understand",
        telugu: "అర్థం కాలేదు",
        roman: "artham kaaledu",
        english: "I didn’t understand",
        note: "The shorter version is what you will usually need in the moment.",
      },
      {
        id: "say-slowly",
        progressKey: "మెల్లగా చెప్పండి::please say it slowly",
        telugu: "కొంచెం మెల్లగా చెప్పండి",
        roman: "konchem mellagaa cheppandi",
        english: "please say it slowly",
        note: "The respectful cheppandi is safe with an elder or anyone new. Use cheppu only with someone you know well.",
        usage: respectfulListenerUsage,
        alternatives: [
          {
            label: "With family or friends",
            telugu: "కొంచెం మెల్లగా చెప్పు",
            roman: "konchem mellagaa cheppu",
            usage: familiarListenerUsage,
          },
        ],
      },
      {
        id: "say-again",
        progressKey: "మళ్లీ చెప్పండి::please say it again",
        telugu: "మళ్లీ చెప్పండి",
        roman: "malli cheppandi",
        english: "please say it again",
        note: "The respectful cheppandi is safe with an elder or anyone new. Use cheppu only with someone you know well.",
        usage: respectfulListenerUsage,
        alternatives: [
          {
            label: "With family or friends",
            telugu: "మళ్లీ చెప్పు",
            roman: "malli cheppu",
            usage: familiarListenerUsage,
          },
        ],
      },
      {
        id: "telugu-not-well",
        progressKey: "నాకు తెలుగు బాగా రాదు::I don’t know Telugu well",
        telugu: "తెలుగు బాగా రాదు",
        roman: "telugu baagaa raadu",
        english: "I don’t know Telugu well",
        note: "A natural way to set expectations without abandoning the conversation.",
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
      {
        id: "hello",
        progressKey: "నమస్కారం::hello",
        telugu: "నమస్కారం",
        roman: "namaskaaram",
        english: "hello",
        alternatives: [
          {
            label: "Extra respectful",
            telugu: "నమస్కారం అండి",
            roman: "namaskaaram andi",
            usage: {
              audience: "respectful",
              kind: "courtesy",
              guidance:
                "Adding andi gives the greeting extra warmth and respect, especially with an elder.",
            },
          },
        ],
      },
      {
        id: "thank-you",
        progressKey: "ధన్యవాదాలు::thank you",
        telugu: "ధన్యవాదాలు",
        roman: "dhanyavaadaalu",
        english: "thank you",
      },
      {
        id: "ask-name",
        progressKey: "మీ పేరు ఏంటి?::what is your name?",
        telugu: "నీ పేరు ఏంటి?",
        roman: "nee peru enti?",
        english: "what is your name?",
        note: "Use nee with a sibling, close friend, or someone you genuinely know well. Use mee for an elder or anyone new or unknown, even if they are your age.",
        usage: familiarListenerUsage,
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "మీ పేరు ఏంటి?",
            roman: "mee peru enti?",
            usage: respectfulListenerUsage,
          },
        ],
      },
      {
        id: "say-again",
        progressKey: "మళ్లీ చెప్పండి::please say it again",
        telugu: "మళ్లీ చెప్పండి",
        roman: "malli cheppandi",
        english: "please say it again",
        note: "The respectful cheppandi is safe with an elder or anyone new. Use cheppu only with someone you know well.",
        usage: respectfulListenerUsage,
        alternatives: [
          {
            label: "With family or friends",
            telugu: "మళ్లీ చెప్పు",
            roman: "malli cheppu",
            usage: familiarListenerUsage,
          },
        ],
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
        id: "doing-well",
        progressKey: "నేను బాగున్నాను::I am well",
        telugu: "బాగానే ఉన్నాను",
        roman: "baagaane unnaanu",
        english: "I’m doing okay",
        note: "A relaxed “I’m doing okay” without the unnecessary pronoun.",
      },
      {
        id: "tired",
        progressKey: "నాకు అలసటగా ఉంది::I am tired",
        telugu: "అలసిపోయాను",
        roman: "alasipoyaanu",
        english: "I’m tired",
      },
      {
        id: "happy",
        progressKey: "నాకు సంతోషంగా ఉంది::I am happy",
        telugu: "చాలా సంతోషంగా ఉన్నాను",
        roman: "chaalaa santoshamgaa unnaanu",
        english: "I’m really happy",
        note: "A complete Telugu way to say you are genuinely happy.",
      },
      {
        id: "family-how-are-you",
        progressKey: "మీరు ఎలా ఉన్నారు?::how are you? (respectful)",
        telugu: "బాగున్నావా?",
        roman: "baagunnaavaa?",
        english: "are you doing well?",
        note: "A natural check-in for a sibling, close cousin, or friend you know well. Use the respectful ending for an elder or anyone new.",
        usage: familiarListenerUsage,
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "బాగున్నారా?",
            roman: "baagunnaaraa?",
            usage: respectfulListenerUsage,
          },
        ],
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
        id: "come-tomorrow",
        progressKey: "నేను రేపు వస్తాను::I’ll come tomorrow",
        telugu: "రేపు వస్తా",
        roman: "repu vastaa",
        english: "I’ll come tomorrow",
        note: "The ending is commonly shortened in casual conversation.",
        alternatives: [
          {
            label: "Full form",
            telugu: "రేపు వస్తాను",
            roman: "repu vastaanu",
            usage: styleVariantUsage,
          },
        ],
      },
      {
        id: "when-home",
        progressKey: "మీరు ఎప్పుడు ఇంట్లో ఉంటారు?::when will you be home?",
        telugu: "ఎప్పుడు ఇంట్లో ఉంటావు?",
        roman: "eppudu intlo untaavu?",
        english: "when will you be home?",
        note: "Use this familiar ending with someone you know well. Use the respectful form with an elder or anyone new.",
        usage: familiarListenerUsage,
        alternatives: [
          {
            label: "With elders or someone new",
            telugu: "ఎప్పుడు ఇంట్లో ఉంటారు?",
            roman: "eppudu intlo untaaru?",
            usage: respectfulListenerUsage,
          },
        ],
      },
      {
        id: "leaving-now",
        progressKey: "నేను ఇప్పుడు బయల్దేరాను::I’m leaving now",
        telugu: "ఇప్పుడే బయల్దేరుతున్నా",
        roman: "ippude bayalderutunnaa",
        english: "I’m leaving now",
        note: "This ongoing form matches “I’m leaving now” more closely.",
        alternatives: [
          {
            label: "Full form",
            telugu: "ఇప్పుడే బయల్దేరుతున్నాను",
            roman: "ippude bayalderutunnaanu",
            usage: styleVariantUsage,
          },
        ],
      },
      {
        id: "see-you-again",
        progressKey: "మళ్లీ కలుద్దాం::see you again",
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
        id: "want-this",
        progressKey: "నాకు ఇది కావాలి::I want this",
        telugu: "ఇది కావాలి",
        roman: "idi kaavaali",
        english: "I want this",
      },
      {
        id: "dont-want-this",
        progressKey: "నాకు ఇది వద్దు::I don’t want this",
        telugu: "ఇది వద్దు",
        roman: "idi vaddu",
        english: "I don’t want this",
      },
      {
        id: "how-much",
        progressKey: "ఇది ఎంత?::how much is this?",
        telugu: "ఇది ఎంత?",
        roman: "idi enta?",
        english: "how much is this?",
      },
      {
        id: "that-one",
        progressKey: "అది::that one",
        telugu: "అది",
        roman: "adi",
        english: "that one",
      },
    ],
  },
  {
    id: "question-words",
    group: "out-and-about",
    title: "Find your way",
    eyebrow: "Getting around",
    description: "Find where the bus stops, confirm the route, and ask someone to stop.",
    outcome: "Handle the most useful directions without a long exchange.",
    minutes: 4,
    words: [
      {
        id: "bus-stop",
        progressKey: "బస్ స్టాప్ ఎక్కడ ఉంది?::where is the bus stop?",
        telugu: "బస్సు ఎక్కడ ఆగుతుంది?",
        roman: "bussu ekkada aagutundi?",
        english: "where does the bus stop?",
        note: "This asks where the bus actually stops, which is more useful in conversation.",
        alternatives: [
          {
            label: "More formal",
            telugu: "బస్సు నిలయం ఎక్కడ?",
            roman: "bussu nilayam ekkada?",
            usage: styleVariantUsage,
          },
        ],
      },
      {
        id: "stop-here",
        progressKey: "ఇక్కడ ఆపండి దయచేసి::stop here, please",
        telugu: "ఇక్కడ ఆపండి",
        roman: "ikkada aapandi",
        english: "stop here, please",
        note: "The respectful “-andi” ending already makes this polite.",
        usage: politeStrangerUsage,
      },
      {
        id: "go-straight",
        progressKey: "సూటిగా వెళ్ళండి::go straight",
        telugu: "నేరుగా వెళ్లండి",
        roman: "nerugaa vellandi",
        english: "go straight",
        note: "The -andi ending makes this a respectful direction, suitable with a driver or anyone you do not know well.",
        usage: politeStrangerUsage,
      },
      {
        id: "way-there",
        progressKey: "ఇది అక్కడికి వెళ్లే దారినా?::is this the way there?",
        telugu: "అక్కడికి ఇదే దారినా?",
        roman: "akkadiki ide daarinaa?",
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
      {
        id: "how-much",
        progressKey: "ఇది ఎంత?::how much is this?",
        telugu: "ఇది ఎంత?",
        roman: "idi enta?",
        english: "how much is this?",
      },
      {
        id: "too-expensive",
        progressKey: "చాలా ఖరీదు::too expensive",
        telugu: "చాలా ఎక్కువ",
        roman: "chaalaa ekkuva",
        english: "too expensive",
        note: "Literally “too much,” and very natural when reacting to a price.",
      },
      {
        id: "lower-price",
        progressKey: "ధర తగ్గించగలరా?::can you reduce the price?",
        telugu: "కొంచెం తగ్గించండి",
        roman: "konchem tagginchandi",
        english: "please lower it a little",
        note: "This respectful request is a safe choice with a seller. You may hear anna or akka used as warm, respectful address; follow the other person’s preference when unsure.",
        usage: politeStrangerUsage,
        alternatives: [
          {
            label: "Softer at a shop",
            telugu: "కొంచెం తగ్గిస్తారా?",
            roman: "konchem taggistaraa?",
            usage: {
              audience: "respectful",
              kind: "style",
              label: "Softer at a shop",
              guidance:
                "This question form keeps the same respectful audience and makes the request sound softer.",
            },
          },
        ],
      },
      {
        id: "have-change",
        progressKey: "చేంజ్ ఉందా?::do you have change?",
        telugu: "చిల్లర ఉందా?",
        roman: "chillara undaa?",
        english: "do you have change?",
        note: "Use this when you need smaller notes or coins back.",
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
        id: "not-feeling-well",
        progressKey: "నాకు ఒంట్లో బాగా లేదు::I’m not feeling well",
        telugu: "ఒంట్లో బాగోలేదు",
        roman: "ontlo baagoledu",
        english: "I’m not feeling well",
      },
      {
        id: "slight-fever",
        progressKey: "నాకు కొంచెం జ్వరంగా ఉంది::I have a slight fever",
        telugu: "కొంచెం జ్వరం ఉంది",
        roman: "konchem jwaram undi",
        english: "I have a slight fever",
      },
      {
        id: "need-doctor",
        progressKey: "నాకు డాక్టర్ కావాలి::I need a doctor",
        telugu: "వైద్యుడు కావాలి",
        roman: "vaidyudu kaavaali",
        english: "I need a doctor",
        note: "A fully Telugu form for asking for medical help.",
      },
      {
        id: "need-help",
        progressKey: "నాకు సహాయం కావాలి::I need help",
        telugu: "సహాయం కావాలి",
        roman: "sahaayam kaavaali",
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

function findPracticeWord(lessonId: string, wordId: string) {
  const lesson = findLesson(lessonId);
  const word = lesson?.words.find((candidate) => candidate.id === wordId);

  if (!word) {
    throw new Error(`Missing practice phrase: ${lessonId}/${wordId}`);
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
      findPracticeWord("please-thank-you", "thank-you"),
      findPracticeWord("names-introductions", "ask-name"),
      findPracticeWord("food-water", "water"),
      findPracticeWord("when-stuck", "say-again"),
    ],
  },
  {
    id: "quick-replies",
    title: "Quick replies",
    outcome:
      "Answer the questions you hear first without dropping back into English.",
    words: [
      findPracticeWord("hello-goodbye", "how-are-you"),
      findPracticeWord("hello-goodbye", "im-well"),
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
      findPracticeWord("please-thank-you", "no-problem"),
      findPracticeWord("please-thank-you", "sorry"),
      findPracticeWord("yes-no-okay", "dont-know"),
      findPracticeWord("when-stuck", "say-slowly"),
    ],
  },
  {
    id: "stay-connected",
    title: "Stay connected",
    outcome:
      "Recover when you are stuck, then introduce yourself without leaving Telugu.",
    words: [
      findPracticeWord("when-stuck", "didnt-understand"),
      findPracticeWord("when-stuck", "telugu-not-well"),
      findPracticeWord("names-introductions", "my-name"),
      findPracticeWord("names-introductions", "happy-to-meet-you"),
      findPracticeWord("names-introductions", "where-from"),
    ],
  },
  {
    id: "family-check-in",
    title: "Family check-in",
    outcome:
      "Join the familiar first conversation and answer how you are feeling.",
    words: [
      findPracticeWord("family-words", "have-you-eaten"),
      findPracticeWord("family-words", "family-how-are-you"),
      findPracticeWord("first-feelings", "doing-well"),
      findPracticeWord("first-feelings", "tired"),
      findPracticeWord("first-feelings", "happy"),
    ],
  },
  {
    id: "at-the-table",
    title: "At the table",
    outcome:
      "Respond while food is being served and make a simple choice clearly.",
    words: [
      findPracticeWord("food-water", "food-is-good"),
      findPracticeWord("food-water", "little-more"),
      findPracticeWord("food-water", "enough"),
      findPracticeWord("this-that", "want-this"),
      findPracticeWord("this-that", "dont-want-this"),
    ],
  },
  {
    id: "make-a-plan",
    title: "Make a plan",
    outcome:
      "Find family members and coordinate a simple arrival or departure.",
    words: [
      findPracticeWord("family-words", "where-are-you"),
      findPracticeWord("family-words", "is-mom-home"),
      findPracticeWord("i-you-we", "come-tomorrow"),
      findPracticeWord("i-you-we", "when-home"),
      findPracticeWord("i-you-we", "leaving-now"),
    ],
  },
  {
    id: "shop-and-pay",
    title: "Shop and pay",
    outcome:
      "Point, choose, ask the price, and get through a small purchase.",
    words: [
      findPracticeWord("this-that", "that-one"),
      findPracticeWord("this-that", "how-much"),
      findPracticeWord("first-conversation", "too-expensive"),
      findPracticeWord("first-conversation", "lower-price"),
      findPracticeWord("first-conversation", "have-change"),
    ],
  },
  {
    id: "get-around",
    title: "Get around",
    outcome:
      "Ask for directions, stop a ride, and end the exchange warmly.",
    words: [
      findPracticeWord("question-words", "bus-stop"),
      findPracticeWord("question-words", "stop-here"),
      findPracticeWord("question-words", "go-straight"),
      findPracticeWord("question-words", "way-there"),
      findPracticeWord("hello-goodbye", "see-you-again"),
    ],
  },
  {
    id: "ask-for-help",
    title: "Ask for help",
    outcome:
      "Say that something is wrong and ask clearly for the support you need.",
    words: [
      findPracticeWord("building-blocks-milestone", "not-feeling-well"),
      findPracticeWord("building-blocks-milestone", "slight-fever"),
      findPracticeWord("building-blocks-milestone", "need-doctor"),
      findPracticeWord("building-blocks-milestone", "need-help"),
    ],
  },
];
