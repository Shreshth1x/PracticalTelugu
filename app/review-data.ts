import { allLessons, practicePacks, resolveTeluguFormUsage, type TeluguWord } from "./course-data.ts";
import { phraseKey } from "./practice-path.mjs";
import type { SavedState } from "./learning-state.ts";

export type VocabularyEntry = TeluguWord & {
  key: string;
  topicId: string;
  topicTitle: string;
  lessonIds: string[];
};

export const vocabularyTopics = allLessons.map(({ id, title }) => ({ id, title }));
export const vocabularyEntries: VocabularyEntry[] = (() => {
  const entries = new Map<string, VocabularyEntry>();
  for (const lesson of allLessons) {
    for (const word of lesson.words) {
      const key = phraseKey(word);
      const existing = entries.get(key);
      if (existing) existing.lessonIds.push(lesson.id);
      else entries.set(key, { ...word, key, topicId: lesson.id, topicTitle: lesson.title, lessonIds: [lesson.id] });
    }
  }
  return [...entries.values()];
})();

export const sentenceEntries = vocabularyEntries.filter((word) =>
  word.roman.trim().split(/\s+/).length > 1 && !/[….]{3}|…/.test(word.roman),
);

export function normalizeAnswer(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase().trim()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\bi'm\b/g, "i am")
    .replace(/\bi'll\b/g, "i will")
    .replace(/\bit's\b/g, "it is")
    .replace(/\bthat's\b/g, "that is")
    .replace(/\bdon't\b/g, "do not")
    .replace(/\bdidn't\b/g, "did not")
    .replace(/[.,!?;:'"()…।]/g, "")
    .replace(/\s+/g, " ");
}

export function sentenceMatches(word: TeluguWord, value: string, direction: "to-telugu" | "to-english"): boolean {
  const accepted = direction === "to-english"
    ? word.english.split(/\s*\/\s*/)
    : [word.roman, word.telugu, ...(word.alternatives ?? []).flatMap((form) => [form.roman, form.telugu])];
  const answer = normalizeAnswer(value);
  return Boolean(answer) && accepted.some((candidate) => normalizeAnswer(candidate) === answer);
}

function randomFor(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function shuffledTokens(text: string, seed: string): string[] {
  const tokens = text.trim().split(/\s+/);
  const shuffled = shuffle(tokens, randomFor(seed));
  return shuffled.length > 1 && shuffled.join(" ") === tokens.join(" ")
    ? [...shuffled.slice(1), shuffled[0]] : shuffled;
}

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function streakForDays(reviewDays: SavedState["reviewDays"], today = localDay()): number {
  let day = reviewDays?.[today] ? today : previousDay(today);
  let count = 0;
  while (reviewDays?.[day]) {
    count++;
    day = previousDay(day);
  }
  return count;
}

export type QuizQuestion = {
  id: string;
  kind: "meaning" | "translation" | "listening" | "usage";
  wordKey: string;
  prompt: string;
  options: { id: string; label: string }[];
  answerId: string;
  audioSrc?: string;
  explanation: string;
};

export function buildDailyQuiz(day: string, state: SavedState, savedWords: string[] = []): QuizQuestion[] {
  const random = randomFor(`daily-review-v1:${day}`);
  const completed = new Set(state.completed);
  const learned = vocabularyEntries.filter((word) => Boolean(state.confidence[word.key]) || savedWords.includes(word.key) || word.lessonIds.some((id) => completed.has(id)));
  const starterKeys = new Set(practicePacks.slice(0, 2).flatMap((pack) => pack.words.map(phraseKey)));
  const starter = vocabularyEntries.filter((word) => starterKeys.has(word.key));
  const prioritized = shuffle(learned.length ? learned : starter, random);
  const seen = new Set(prioritized.map((word) => word.key));
  const selected = [...prioritized, ...shuffle(vocabularyEntries.filter((word) => !seen.has(word.key)), random)].slice(0, 10);
  const usageWord = vocabularyEntries.find((word) =>
    word.usage?.kind === "relationship" && word.alternatives?.some((form) => form.usage?.kind === "relationship" && form.usage.audience !== word.usage?.audience),
  );
  // One explicit listener comparison; never infer register from a spelling.
  if (usageWord) {
    const currentIndex = selected.findIndex((word) => word.key === usageWord.key);
    if (currentIndex >= 0) [selected[3], selected[currentIndex]] = [selected[currentIndex], selected[3]];
    else {
      // Replace a fallback item, keeping the earlier learned phrases in the quiz.
      selected[9] = selected[3];
      selected[3] = usageWord;
    }
  }
  return selected.map((word, index) => {
    const forms = [{ roman: word.roman, usage: word.usage }, ...(word.alternatives ?? [])].filter((form) => form.usage?.kind === "relationship");
    const usage = forms.some((form) => form.usage?.audience === "familiar") && forms.some((form) => form.usage?.audience === "respectful");
    const requestedKind = ["meaning", "translation", "listening", "usage", "translation", "meaning", "listening", "translation", "meaning", "listening"][index] as QuizQuestion["kind"];
    const kind = requestedKind === "usage" && !usage ? "meaning"
      : requestedKind === "listening" && !word.audioSrc ? "meaning" : requestedKind;
    const base = { id: `review-v1:${day}:${index}:${word.key}`, kind, wordKey: word.key, explanation: `${word.roman} means “${word.english}”. ${word.note ?? resolveTeluguFormUsage(word.usage).guidance}` };
    if (kind === "usage") {
      const audience = random() < 0.5 ? "familiar" : "respectful";
      const uniqueForms = Array.from(new Map(forms.map((form) => [form.roman, form])).values());
      const answer = uniqueForms.find((form) => form.usage?.audience === audience)!;
      return { ...base, prompt: `How would you say “${word.english}” to ${audience === "familiar" ? "a close friend you know well" : "an elder or someone you have just met"}?`, options: shuffle(uniqueForms.map((form) => ({ id: form.roman, label: form.roman })), random), answerId: answer.roman, explanation: resolveTeluguFormUsage(answer.usage).guidance };
    }
    const labelFor = (entry: VocabularyEntry) => kind === "translation" ? entry.roman : entry.english;
    const labels = new Set([normalizeAnswer(labelFor(word))]);
    const distractors = shuffle(vocabularyEntries.filter((entry) => entry.key !== word.key), random).filter((entry) => {
      const label = normalizeAnswer(labelFor(entry));
      if (labels.has(label)) return false;
      labels.add(label);
      return true;
    }).slice(0, 3);
    return { ...base, prompt: kind === "translation" ? `How do you say “${word.english}” in Telugu?` : kind === "listening" ? "Listen to the phrase. What does it mean?" : `What does “${word.roman}” mean?`, options: shuffle([word, ...distractors].map((entry) => ({ id: entry.key, label: labelFor(entry) })), random), answerId: word.key, ...(kind === "listening" ? { audioSrc: word.audioSrc } : {}) };
  });
}

export function recordQuizDay(state: SavedState, day: string, score: number): SavedState {
  if (state.reviewDays?.[day]) return state;
  return { ...state, reviewDays: { ...state.reviewDays, [day]: { score: Math.max(0, Math.min(10, Math.round(score))), total: 10 } } };
}

export function validateQuizQuestions(day: string, value: unknown): QuizQuestion[] | null {
  if (!Array.isArray(value) || value.length !== 10) return null;
  const keys = new Set<string>();
  const questions: QuizQuestion[] = [];
  for (let index = 0; index < value.length; index++) {
    const candidate = value[index];
    if (!candidate || typeof candidate !== "object") return null;
    const word = vocabularyEntries.find((entry) => entry.key === candidate.wordKey);
    if (!word || keys.has(word.key) || candidate.id !== `review-v1:${day}:${index}:${word.key}`) return null;
    keys.add(word.key);
    if (!["meaning", "translation", "listening", "usage"].includes(candidate.kind) || !Array.isArray(candidate.options)) return null;
    if (typeof candidate.prompt !== "string" || typeof candidate.explanation !== "string" || typeof candidate.answerId !== "string") return null;
    const optionIds = new Set<string>();
    for (const option of candidate.options) {
      if (!option || typeof option.id !== "string" || typeof option.label !== "string" || optionIds.has(option.id)) return null;
      optionIds.add(option.id);
      if (candidate.kind === "usage") {
        const form = [{ roman: word.roman, usage: word.usage }, ...(word.alternatives ?? [])].find((entry) => entry.roman === option.id && entry.usage?.kind === "relationship");
        if (!form || option.label !== form.roman) return null;
      } else {
        const entry = vocabularyEntries.find((item) => item.key === option.id);
        if (!entry || option.label !== (candidate.kind === "translation" ? entry.roman : entry.english)) return null;
      }
    }
    if (!optionIds.has(candidate.answerId)) return null;
    if (candidate.kind === "usage") {
      if (candidate.options.length < 2 || candidate.options.length > 4) return null;
      const forms = [{ roman: word.roman, usage: word.usage }, ...(word.alternatives ?? [])];
      const answer = forms.find((form) => form.roman === candidate.answerId);
      const audience = candidate.prompt.includes("a close friend you know well") ? "familiar" : candidate.prompt.includes("an elder or someone you have just met") ? "respectful" : null;
      if (!audience || answer?.usage?.audience !== audience) return null;
      const prompt = `How would you say “${word.english}” to ${audience === "familiar" ? "a close friend you know well" : "an elder or someone you have just met"}?`;
      if (candidate.prompt !== prompt || candidate.explanation !== resolveTeluguFormUsage(answer.usage).guidance) return null;
    } else if (candidate.options.length !== 4 || candidate.answerId !== word.key) return null;
    if (candidate.kind !== "usage") {
      const prompt = candidate.kind === "translation" ? `How do you say “${word.english}” in Telugu?` : candidate.kind === "listening" ? "Listen to the phrase. What does it mean?" : `What does “${word.roman}” mean?`;
      const explanation = `${word.roman} means “${word.english}”. ${word.note ?? resolveTeluguFormUsage(word.usage).guidance}`;
      if (candidate.prompt !== prompt || candidate.explanation !== explanation) return null;
    }
    if (candidate.kind === "listening" && (!word.audioSrc || candidate.audioSrc !== word.audioSrc)) return null;
    if (candidate.kind !== "listening" && candidate.audioSrc !== undefined) return null;
    questions.push(candidate as QuizQuestion);
  }
  return questions;
}
