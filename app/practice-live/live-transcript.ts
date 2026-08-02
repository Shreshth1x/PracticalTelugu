export type LiveTranscriptSpeaker = "you" | "mayu";
export type LiveTranscriptSource = "telugu" | "english" | "mixed";

export type LiveLearnerAssessment = {
  /** Approximate intelligibility of the Telugu heard, not a phoneme-level grade. */
  pronunciationScore: number | null;
  /** How clearly and appropriately the spoken reply answered the active turn. */
  accuracyScore: number;
  /** One short, learner-facing improvement in English or English-letter Telugu. */
  feedback: string;
};

export type LiveTranscriptTurn = {
  id: string;
  speaker: LiveTranscriptSpeaker;
  roman: string;
  pronunciation?: string;
  english: string;
  final: boolean;
  cueId?: string;
  sourceLanguage?: LiveTranscriptSource;
  responseLatencyMs?: number;
  assessment?: LiveLearnerAssessment;
};

export type LiveCaptionTurn = {
  roman: string;
  pronunciation?: string;
  english: string;
  cueId?: string;
  sourceLanguage?: LiveTranscriptSource;
  responseLatencyMs?: number;
  assessment?: LiveLearnerAssessment;
};

export type ParsedLiveCaptionTurn = LiveCaptionTurn & {
  /** Internal validation field only. Never copy this into the visible transcript. */
  teluguInternal: string;
};

export type ParsedLiveTurnToolCall = {
  mayu: ParsedLiveCaptionTurn;
  learner:
    | (ParsedLiveCaptionTurn & { assessment: LiveLearnerAssessment })
    | null;
  replay: boolean;
};

type ReviewedLiveCueCaption = {
  telugu: string;
  roman: string;
  pronunciation: string;
  english: string;
};

const TELUGU_SCRIPT = /[\u0c00-\u0c7f]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{Letter}/u;
const MAX_CAPTION_LENGTH = 420;
const MAX_FEEDBACK_LENGTH = 180;
const FORBIDDEN_AUDIBLE_ENGLISH =
  /(?:^|[\s,.;:!?])(?:oh|okay|ok|yes|great|hello|hi|thanks|thank you|please|sorry|wow|cool|sure|bye)(?=$|[\s,.;:!?])/iu;
const FORBIDDEN_TELUGU_LOAN_INTERJECTIONS =
  /(?:^|[\s,.;:!?।])(?:ఓ|ఓహ్|ఓకే|యెస్|గ్రేట్|హలో|హాయ్|థ్యాంక్స్|థాంక్యూ|ప్లీజ్|సారీ|వావ్|కూల్|ష్యూర్|బై)(?=$|[\s,.;:!?।])/u;

function cleanCaptionText(value: unknown) {
  if (typeof value !== "string") return "";

  const cleaned = value.replace(/\s+/g, " ").trim();
  if (
    !cleaned ||
    cleaned.length > MAX_CAPTION_LENGTH ||
    TELUGU_SCRIPT.test(cleaned) ||
    NON_LATIN_LETTER.test(cleaned) ||
    !LATIN_LETTER.test(cleaned)
  ) {
    return "";
  }

  return cleaned;
}

function cleanInternalTelugu(value: unknown) {
  if (typeof value !== "string") return "";

  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned &&
    cleaned.length <= MAX_CAPTION_LENGTH &&
    TELUGU_SCRIPT.test(cleaned)
    ? cleaned
    : "";
}

function sourceLanguage(value: unknown): LiveTranscriptSource | null {
  return value === "telugu" || value === "english" || value === "mixed"
    ? value
    : null;
}

function integerRating(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 4
    ? value
    : null;
}

function cleanLearnerFeedback(value: unknown) {
  const cleaned = cleanCaptionText(value);
  return cleaned.length <= MAX_FEEDBACK_LENGTH ? cleaned : "";
}

function normalizeReviewedCaption(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A cueId is a claim that the complete turn is one reviewed course phrase.
 * Permit harmless case, spacing, and punctuation differences, but no added,
 * removed, or substituted words in any of the four cross-check fields.
 */
export function matchesReviewedLiveCue(
  turn: ParsedLiveCaptionTurn,
  cue: ReviewedLiveCueCaption,
) {
  return (
    normalizeReviewedCaption(turn.teluguInternal) ===
      normalizeReviewedCaption(cue.telugu) &&
    normalizeReviewedCaption(turn.roman) ===
      normalizeReviewedCaption(cue.roman) &&
    normalizeReviewedCaption(turn.pronunciation ?? "") ===
      normalizeReviewedCaption(cue.pronunciation) &&
    normalizeReviewedCaption(turn.english) ===
      normalizeReviewedCaption(cue.english)
  );
}

/** Blocks the copied-English fillers Mayu is explicitly told not to speak. */
export function hasForbiddenAudibleEnglish(
  turn: Pick<ParsedLiveCaptionTurn, "teluguInternal" | "roman">,
) {
  return (
    FORBIDDEN_AUDIBLE_ENGLISH.test(turn.roman) ||
    FORBIDDEN_TELUGU_LOAN_INTERJECTIONS.test(turn.teluguInternal)
  );
}

/** Protects a small set of high-confidence meanings from known bad captions. */
export function hasKnownLearnerMeaningMismatch(
  turn: ParsedLiveCaptionTurn,
) {
  if (/\bhungr(?:y|ier|iest)\b/iu.test(turn.english)) {
    return (
      !/\baakali(?:gaa)?\b/iu.test(turn.roman) ||
      !turn.teluguInternal.includes("ఆకలి")
    );
  }

  return false;
}

/** Rejects two provider mistakes observed in the reviewed family dialogue. */
export function hasKnownMayuMeaningMismatch(turn: ParsedLiveCaptionTurn) {
  if (/\bavunnaa\b/iu.test(turn.roman)) return true;

  return (
    /\bwhat would you like to eat\b/iu.test(turn.english) &&
    /\bemee\s+tint/iu.test(turn.roman)
  );
}

export function hasKnownMayuRelationshipMismatch(
  turn: ParsedLiveCaptionTurn,
  relationship: "close" | "respectful",
) {
  if (!/\binkaa\s+emainaa\s+tint/iu.test(turn.roman)) return false;

  return relationship === "close"
    ? !/\btintaavaa\b/iu.test(turn.roman) ||
        !turn.teluguInternal.includes("తింటావా")
    : !/\btintaaraa\b/iu.test(turn.roman) ||
        !turn.teluguInternal.includes("తింటారా");
}

/**
 * Accepts only display-safe Latin Telugu and English. Gemini may use Telugu
 * script internally for speech accuracy, but it can never cross this boundary
 * into the learner-facing transcript.
 */
export function parseLiveTurnToolCall(
  value: unknown,
): ParsedLiveTurnToolCall | null {
  if (!value || typeof value !== "object") return null;
  const args = value as Record<string, unknown>;

  const mayuTeluguInternal = cleanInternalTelugu(args.mayuTeluguInternal);
  const mayuRoman = cleanCaptionText(args.mayuRoman);
  const mayuPronunciation = cleanCaptionText(args.mayuPronunciation);
  const mayuEnglish = cleanCaptionText(args.mayuEnglish);
  if (
    !mayuTeluguInternal ||
    !mayuRoman ||
    !mayuPronunciation ||
    !mayuEnglish
  ) {
    return null;
  }

  const hasCueId = Object.hasOwn(args, "cueId");
  const rawCueId =
    typeof args.cueId === "string" && args.cueId.trim()
      ? args.cueId.trim()
      : undefined;
  if (hasCueId && !rawCueId) return null;
  const learnerRoman = cleanCaptionText(args.learnerRoman);
  const learnerPronunciation = cleanCaptionText(args.learnerPronunciation);
  const learnerEnglish = cleanCaptionText(args.learnerEnglish);
  const learnerTeluguInternal = cleanInternalTelugu(
    args.learnerTeluguInternal,
  );
  const learnerSourceLanguage = sourceLanguage(args.learnerSourceLanguage);
  const learnerPronunciationRating = integerRating(
    args.learnerPronunciationRating,
  );
  const learnerAccuracyRating = integerRating(args.learnerAccuracyRating);
  const learnerFeedback = cleanLearnerFeedback(args.learnerFeedback);
  const hasLearnerPronunciationRating = Object.hasOwn(
    args,
    "learnerPronunciationRating",
  );
  const hasAnyLearnerField = [
    "learnerTeluguInternal",
    "learnerRoman",
    "learnerPronunciation",
    "learnerEnglish",
    "learnerSourceLanguage",
    "learnerPronunciationRating",
    "learnerAccuracyRating",
    "learnerFeedback",
  ].some((field) => Object.hasOwn(args, field));

  if (
    hasAnyLearnerField &&
    (!learnerTeluguInternal ||
      !learnerRoman ||
      !learnerPronunciation ||
      !learnerEnglish ||
      !learnerSourceLanguage ||
      learnerAccuracyRating === null ||
      !learnerFeedback ||
      (learnerSourceLanguage !== "english" &&
        learnerPronunciationRating === null) ||
      (hasLearnerPronunciationRating && learnerPronunciationRating === null))
  ) {
    return null;
  }

  return {
    mayu: {
      teluguInternal: mayuTeluguInternal,
      roman: mayuRoman,
      pronunciation: mayuPronunciation,
      english: mayuEnglish,
      cueId: rawCueId,
      sourceLanguage: "telugu",
    },
    learner: hasAnyLearnerField
      ? {
          teluguInternal: learnerTeluguInternal,
          roman: learnerRoman,
          pronunciation: learnerPronunciation,
          english: learnerEnglish,
          sourceLanguage: learnerSourceLanguage!,
          assessment: {
            pronunciationScore:
              learnerPronunciationRating === null
                ? null
                : learnerPronunciationRating * 25,
            accuracyScore: learnerAccuracyRating! * 25,
            feedback: learnerFeedback,
          },
        }
      : null,
    replay: args.replay === true,
  };
}

export function beginPendingLearnerTurn(
  turns: LiveTranscriptTurn[],
  id: string,
) {
  const latest = turns.at(-1);
  if (latest?.speaker === "you" && !latest.final) return turns;

  return [
    ...turns,
    {
      id,
      speaker: "you" as const,
      roman: "",
      english: "",
      final: false,
    },
  ];
}

export function applyLiveCaptionTurn(
  turns: LiveTranscriptTurn[],
  update: LiveCaptionTurn & {
    id: string;
    speaker: LiveTranscriptSpeaker;
  },
) {
  const next = [...turns];
  const exactIndex = next.findIndex((turn) => turn.id === update.id);
  const pendingLearnerIndex =
    update.speaker === "you"
      ? next.findLastIndex(
          (turn) => turn.speaker === "you" && !turn.final,
        )
      : -1;
  const index = exactIndex >= 0 ? exactIndex : pendingLearnerIndex;
  const turn: LiveTranscriptTurn = {
    id: index >= 0 ? next[index].id : update.id,
    speaker: update.speaker,
    roman: update.roman,
    pronunciation: update.pronunciation,
    english: update.english,
    final: true,
    cueId: update.cueId,
    sourceLanguage: update.sourceLanguage,
    ...(update.responseLatencyMs === undefined
      ? {}
      : { responseLatencyMs: update.responseLatencyMs }),
    ...(update.assessment ? { assessment: update.assessment } : {}),
  };

  if (index >= 0) {
    next[index] = turn;
  } else {
    next.push(turn);
  }

  return next;
}

export function removePendingLiveTurns(turns: LiveTranscriptTurn[]) {
  return turns.filter((turn) => turn.final);
}
