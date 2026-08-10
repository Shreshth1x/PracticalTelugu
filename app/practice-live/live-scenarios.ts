import {
  findLesson,
  practicePacks,
  type TeluguWord,
} from "../course-data.ts";
import type { LiveListenerRelationship } from "./live-config.ts";

export type LiveScenarioId =
  | "family-check-in"
  | "at-the-table"
  | "when-stuck";

export type LiveScenario = {
  id: LiveScenarioId;
  eyebrow: string;
  pickerLabel: string;
  title: string;
  description: string;
  openingCue: string;
  openingCues?: Partial<Record<LiveListenerRelationship, string>>;
  words: TeluguWord[];
};

function findPracticePack(id: string) {
  const pack = practicePacks.find((candidate) => candidate.id === id);

  if (!pack) {
    throw new Error(`Missing live practice pack: ${id}`);
  }

  return pack;
}

function findPracticeLesson(id: string) {
  const lesson = findLesson(id);

  if (!lesson) {
    throw new Error(`Missing live practice lesson: ${id}`);
  }

  return lesson;
}

export const liveScenarios: LiveScenario[] = [
  {
    id: "family-check-in",
    eyebrow: "WITH FAMILY",
    pickerLabel: "With family",
    title: "Check in with family",
    description: "Answer the warm questions that begin almost every visit.",
    openingCue:
      "We have just sat down together at a family visit. Begin in Telugu by warmly asking whether I have eaten, call present_turn first, speak only Telugu, then wait for my real answer.",
    openingCues: {
      close:
        "We have just sat down together at a casual family visit. Address me as someone close. Warmly ask whether I have eaten with the reviewed familiar cueId \"have-you-eaten__primary\" in present_turn, speak only that Telugu turn, then wait for my real answer.",
      respectful:
        "We have just sat down together at a family visit. Address me respectfully as an elder or someone new. Warmly ask whether I have eaten with the reviewed respectful cueId \"have-you-eaten__alt_0\" in present_turn, speak only that Telugu turn, then wait for my real answer.",
    },
    words: findPracticePack("family-check-in").words,
  },
  {
    id: "at-the-table",
    eyebrow: "AT A MEAL",
    pickerLabel: "At the table",
    title: "Sit down to eat",
    description: "React to the food and ask for what you need at the table.",
    openingCue:
      "We are sitting down at a casual family meal. Begin the role-play in Telugu as a family member serving food: invite me to eat and ask one short natural question about the meal. Call present_turn first, speak only Telugu, then wait for my answer.",
    words: findPracticePack("at-the-table").words,
  },
  {
    id: "when-stuck",
    eyebrow: "WHEN YOU’RE STUCK",
    pickerLabel: "When stuck",
    title: "Keep the conversation going",
    description: "Slow things down or ask for another try without switching off.",
    openingCue:
      "Begin a very simple everyday Telugu exchange with one short question. Call present_turn first, speak only Telugu, and wait. If I get stuck, stay in character and simplify your next Telugu reply so I can use a recovery phrase naturally.",
    words: findPracticeLesson("when-stuck").words,
  },
];

export function getLiveScenario(value: unknown) {
  return liveScenarios.find((scenario) => scenario.id === value);
}

export function getLiveOpeningGreeting(
  relationship: LiveListenerRelationship,
) {
  return relationship === "close"
    ? {
        telugu: "నమస్కారం. ఎలా ఉన్నావు?",
        roman: "namaskaaram. elaa unnaavu?",
        pronunciation: "nuh-muh-SKAA-rum. eh-LAA oon-NAA-voo?",
        english: "Hello. How are you?",
        audioSrc: "/audio/live/mayu-opening-close.pcm",
      }
    : {
        telugu: "నమస్కారం అండి. ఎలా ఉన్నారు?",
        roman: "namaskaaram andi. elaa unnaaru?",
        pronunciation:
          "nuh-muh-SKAA-rum UN-dee. eh-LAA oon-NAA-roo?",
        english: "Hello. How are you?",
        audioSrc: "/audio/live/mayu-opening-respectful.pcm",
      };
}

export function getLiveOpeningCue(
  _scenario: LiveScenario,
  relationship: LiveListenerRelationship,
) {
  const greeting = getLiveOpeningGreeting(relationship);

  return `Practice context: this is not learner speech; no learner has spoken yet. The app will present Mayu's entire first turn as exactly: mayuTeluguInternal "${greeting.telugu}", mayuRoman "${greeting.roman}", mayuPronunciation "${greeting.pronunciation}", and mayuEnglish "${greeting.english}". Do not repeat it or call present_turn until the learner replies. Treat the first microphone turn as the learner's answer to that greeting and check-in.`;
}
