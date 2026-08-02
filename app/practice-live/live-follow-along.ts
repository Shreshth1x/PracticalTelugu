import {
  resolveTeluguFormUsage,
  type TeluguAudience,
  type TeluguWord,
} from "../course-data.ts";

export type LivePhraseCue = {
  id: string;
  wordId: string;
  progressKey: string;
  english: string;
  roman: string;
  pronunciation: string;
  telugu: string;
  audience: TeluguAudience;
  contextLabel: string;
  contextGuidance: string;
  note?: string;
  variant: "primary" | "alternative";
};

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "am",
  "an",
  "are",
  "could",
  "did",
  "do",
  "does",
  "for",
  "have",
  "i",
  "is",
  "it",
  "me",
  "my",
  "not",
  "of",
  "please",
  "some",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "would",
  "you",
  "your",
]);

function normalizeExact(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getLivePhraseCues(words: TeluguWord[]): LivePhraseCue[] {
  return words.flatMap((word) => {
    const primaryUsage = resolveTeluguFormUsage(word.usage);
    const primary: LivePhraseCue = {
      id: `${word.id}__primary`,
      wordId: word.id,
      progressKey: word.progressKey,
      english: word.english,
      roman: word.roman,
      pronunciation: word.pronunciation,
      telugu: word.telugu,
      audience: primaryUsage.audience,
      contextLabel: primaryUsage.label,
      contextGuidance: primaryUsage.guidance,
      note: word.note,
      variant: "primary",
    };

    const alternatives = (word.alternatives ?? []).map(
      (alternative, index): LivePhraseCue => {
        const usage = resolveTeluguFormUsage(alternative.usage);

        return {
          id: `${word.id}__alt_${index}`,
          wordId: word.id,
          progressKey: word.progressKey,
          english: word.english,
          roman: alternative.roman,
          pronunciation: alternative.pronunciation,
          telugu: alternative.telugu,
          audience: usage.audience,
          contextLabel: usage.showContext ? usage.label : alternative.label,
          contextGuidance: usage.guidance,
          note: word.note,
          variant: "alternative",
        };
      },
    );

    return [primary, ...alternatives];
  });
}

export function findLivePhraseCue(words: TeluguWord[], cueId: string) {
  return getLivePhraseCues(words).find((cue) => cue.id === cueId) ?? null;
}

export function getRelatedLivePhraseCues(
  words: TeluguWord[],
  cueId: string,
) {
  const selected = findLivePhraseCue(words, cueId);
  if (!selected) return [];

  return getLivePhraseCues(words).filter(
    (cue) => cue.wordId === selected.wordId && cue.id !== selected.id,
  );
}

function uniqueMatch(
  cues: LivePhraseCue[],
  select: (cue: LivePhraseCue) => string,
  normalizedText: string,
) {
  const matches = cues.filter(
    (cue) => normalizeExact(select(cue)) === normalizedText,
  );

  return matches.length === 1 ? matches[0] : null;
}

function uniqueContainedMatch(
  cues: LivePhraseCue[],
  select: (cue: LivePhraseCue) => string,
  normalizedText: string,
) {
  const matches = cues.filter((cue) => {
    const candidate = normalizeExact(select(cue));
    return candidate.length >= 3 && normalizedText.includes(candidate);
  });

  return matches.length === 1 ? matches[0] : null;
}

function meaningfulEnglishTokens(value: string) {
  return normalizeExact(value)
    .split(" ")
    .filter(
      (token) =>
        /^[a-z]+$/.test(token) &&
        token.length > 1 &&
        !ENGLISH_STOP_WORDS.has(token),
    );
}

function conservativeEnglishOverlap(
  text: string,
  cues: LivePhraseCue[],
) {
  const inputTokens = new Set(meaningfulEnglishTokens(text));
  if (inputTokens.size < 2) return null;

  const scored = cues.flatMap((cue) => {
    const cueTokens = [...new Set(meaningfulEnglishTokens(cue.english))];
    if (cueTokens.length < 2) return [];

    const overlap = cueTokens.filter((token) => inputTokens.has(token)).length;
    const coverage = overlap / cueTokens.length;
    if (overlap < 2 || coverage < 0.8) return [];

    return [{ cue, overlap, coverage }];
  });

  if (!scored.length) return null;

  scored.sort(
    (left, right) =>
      right.coverage - left.coverage || right.overlap - left.overlap,
  );
  const best = scored[0];
  const tied = scored.filter(
    (candidate) =>
      candidate.coverage === best.coverage && candidate.overlap === best.overlap,
  );

  return tied.length === 1 ? best.cue : null;
}

export function resolveLivePhraseCue(
  text: string,
  words: TeluguWord[],
): LivePhraseCue | null {
  const normalizedText = normalizeExact(text);
  if (!normalizedText) return null;

  const cues = getLivePhraseCues(words);

  return (
    uniqueMatch(cues, (cue) => cue.telugu, normalizedText) ??
    uniqueMatch(cues, (cue) => cue.roman, normalizedText) ??
    uniqueMatch(cues, (cue) => cue.english, normalizedText) ??
    uniqueContainedMatch(cues, (cue) => cue.telugu, normalizedText) ??
    uniqueContainedMatch(cues, (cue) => cue.roman, normalizedText) ??
    conservativeEnglishOverlap(text, cues)
  );
}
