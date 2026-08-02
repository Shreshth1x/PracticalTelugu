import {
  findLesson,
  practicePacks,
  type TeluguWord,
} from "../course-data.ts";

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
    description: "Answer the familiar questions that begin almost every visit.",
    openingCue:
      "We have just sat down together at a casual family visit. Begin the role-play in Telugu by warmly asking whether I have eaten. Use cueId \"have-you-eaten__primary\" in present_turn, speak only the Telugu turn, then wait for my real answer.",
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
