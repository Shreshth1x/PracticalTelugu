import {
  calibrateLiveLearnerAssessment,
  type CalibratedLiveLearnerAssessment,
  type LiveAssessmentConfidence,
  type LiveAssessmentSource,
} from "./live-assessment.ts";

export type LiveTranscriptSpeaker = "you" | "mayu";
export type LiveTranscriptSource = LiveAssessmentSource;

export type LiveLearnerAssessment = CalibratedLiveLearnerAssessment;

export type LiveTranscriptTurn = {
  id: string;
  speaker: LiveTranscriptSpeaker;
  roman: string;
  /**
   * Provider ASR shown only while this learner turn is pending. This is a
   * disposable Latin-script draft, never the authoritative caption used for
   * assessment, persistence, or session results.
   */
  provisionalRoman?: string;
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

export type ParsedLiveMayuTurnToolCall = Pick<
  ParsedLiveTurnToolCall,
  "mayu" | "replay"
>;

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
const LIVE_TURN_TOOL_FIELDS = new Set([
  "mayuTeluguInternal",
  "mayuRoman",
  "mayuPronunciation",
  "mayuEnglish",
  "cueId",
  "learnerTeluguInternal",
  "learnerRoman",
  "learnerPronunciation",
  "learnerEnglish",
  "learnerSourceLanguage",
  "learnerAssessmentConfidence",
  "learnerIntelligibilityRating",
  "learnerPronunciationRating",
  "learnerMeaningRating",
  "learnerFormRating",
  "learnerTeluguCoverageRating",
  "learnerFeedback",
  "replay",
]);
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

function assessmentConfidence(value: unknown): LiveAssessmentConfidence | null {
  return value === "high" || value === "medium" || value === "low"
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
 * Keeps Mayu's spoken turn independently recoverable from optional learner
 * coaching. A malformed score must never strand a blocking tool call, while
 * Mayu's own audible Telugu and learner-facing captions remain fail-closed.
 */
export function parseLiveMayuTurnToolCall(
  value: unknown,
): ParsedLiveMayuTurnToolCall | null {
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

  return {
    mayu: {
      teluguInternal: mayuTeluguInternal,
      roman: mayuRoman,
      pronunciation: mayuPronunciation,
      english: mayuEnglish,
      cueId: rawCueId,
      sourceLanguage: "telugu",
    },
    replay: args.replay === true,
  };
}

/**
 * Accepts only display-safe Latin Telugu and English. Gemini may use Telugu
 * script internally for speech accuracy, but it can never cross this boundary
 * into the learner-facing transcript.
 */
export function parseLiveTurnToolCall(
  value: unknown,
): ParsedLiveTurnToolCall | null {
  const mayuTurn = parseLiveMayuTurnToolCall(value);
  if (!mayuTurn || !value || typeof value !== "object") return null;
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some((field) => !LIVE_TURN_TOOL_FIELDS.has(field))) {
    return null;
  }

  const learnerRoman = cleanCaptionText(args.learnerRoman);
  const learnerPronunciation = cleanCaptionText(args.learnerPronunciation);
  const learnerEnglish = cleanCaptionText(args.learnerEnglish);
  const learnerTeluguInternal = cleanInternalTelugu(
    args.learnerTeluguInternal,
  );
  const learnerSourceLanguage = sourceLanguage(args.learnerSourceLanguage);
  const learnerAssessmentConfidence = assessmentConfidence(
    args.learnerAssessmentConfidence,
  );
  const learnerIntelligibilityRating = integerRating(
    args.learnerIntelligibilityRating,
  );
  const learnerPronunciationRating = integerRating(
    args.learnerPronunciationRating,
  );
  const learnerMeaningRating = integerRating(args.learnerMeaningRating);
  const learnerFormRating = integerRating(args.learnerFormRating);
  const learnerTeluguCoverageRating = integerRating(
    args.learnerTeluguCoverageRating,
  );
  const learnerFeedback = cleanLearnerFeedback(args.learnerFeedback);
  const learnerCaptionFields = [
    "learnerTeluguInternal",
    "learnerRoman",
    "learnerPronunciation",
    "learnerEnglish",
    "learnerSourceLanguage",
  ] as const;
  const learnerRatingFields = [
    "learnerIntelligibilityRating",
    "learnerPronunciationRating",
    "learnerMeaningRating",
    "learnerFormRating",
    "learnerTeluguCoverageRating",
  ] as const;
  const learnerFields = [
    ...learnerCaptionFields,
    "learnerAssessmentConfidence",
    ...learnerRatingFields,
    "learnerFeedback",
  ] as const;
  const hasAnyLearnerField = learnerFields.some((field) =>
    Object.hasOwn(args, field),
  );
  const hasAnyLearnerCaption = learnerCaptionFields.some((field) =>
    Object.hasOwn(args, field),
  );
  const hasAnyLearnerRating = learnerRatingFields.some((field) =>
    Object.hasOwn(args, field),
  );
  const hasInvalidRating = ([
    ["learnerIntelligibilityRating", learnerIntelligibilityRating],
    ["learnerPronunciationRating", learnerPronunciationRating],
    ["learnerMeaningRating", learnerMeaningRating],
    ["learnerFormRating", learnerFormRating],
    ["learnerTeluguCoverageRating", learnerTeluguCoverageRating],
  ] as const).some(
    ([field, rating]) => Object.hasOwn(args, field) && rating === null,
  );

  let learner: ParsedLiveTurnToolCall["learner"] = null;
  if (hasAnyLearnerField) {
    if (!learnerAssessmentConfidence || !learnerFeedback || hasInvalidRating) {
      return null;
    }

    if (learnerAssessmentConfidence === "low") {
      // A fair abstention must not force the model to invent words it could
      // not hear. Preserve the turn with an explicit local placeholder.
      if (hasAnyLearnerCaption || hasAnyLearnerRating) return null;

      learner = createUnscoredLiveLearnerCaption(learnerFeedback);
    } else {
      if (
        !learnerTeluguInternal ||
        !learnerRoman ||
        !learnerPronunciation ||
        !learnerEnglish ||
        !learnerSourceLanguage ||
        learnerMeaningRating === null
      ) {
        return null;
      }

      const hasTeluguQualityRatings =
        learnerIntelligibilityRating !== null &&
        learnerPronunciationRating !== null &&
        learnerFormRating !== null;
      const hasProhibitedEnglishRatings = [
        "learnerIntelligibilityRating",
        "learnerPronunciationRating",
        "learnerFormRating",
        "learnerTeluguCoverageRating",
      ].some((field) => Object.hasOwn(args, field));

      if (
        (learnerSourceLanguage === "english" && hasProhibitedEnglishRatings) ||
        (learnerSourceLanguage === "telugu" &&
          (!hasTeluguQualityRatings ||
            Object.hasOwn(args, "learnerTeluguCoverageRating"))) ||
        (learnerSourceLanguage === "mixed" &&
          (!hasTeluguQualityRatings ||
            learnerTeluguCoverageRating === null ||
            learnerTeluguCoverageRating === 0))
      ) {
        return null;
      }

      learner = {
        teluguInternal: learnerTeluguInternal,
        roman: learnerRoman,
        pronunciation: learnerPronunciation,
        english: learnerEnglish,
        sourceLanguage: learnerSourceLanguage,
        assessment: calibrateLiveLearnerAssessment({
          sourceLanguage: learnerSourceLanguage,
          confidence: learnerAssessmentConfidence,
          ratings: {
            intelligibility: learnerIntelligibilityRating,
            pronunciation: learnerPronunciationRating,
            meaning: learnerMeaningRating,
            form: learnerFormRating,
            teluguCoverage: learnerTeluguCoverageRating,
          },
          feedback: learnerFeedback,
        }),
      };
    }
  }

  return {
    ...mayuTurn,
    learner,
  };
}

export function createUnscoredLiveLearnerCaption(
  feedback: string,
  reason: "unclear" | "incomplete-assessment" = "unclear",
): ParsedLiveCaptionTurn & { assessment: LiveLearnerAssessment } {
  const safeFeedback =
    cleanLearnerFeedback(feedback) ||
    "Keep going and try the next reply at a comfortable volume.";

  return {
    teluguInternal: "",
    roman: reason === "unclear" ? "Audio unclear" : "Reply received",
    english:
      reason === "unclear"
        ? "This reply was not scored. Please try it once more."
        : "Your reply was heard, but this turn was not scored.",
    assessment: calibrateLiveLearnerAssessment({
      sourceLanguage: "telugu",
      confidence: "low",
      ratings: {
        intelligibility: null,
        pronunciation: null,
        meaning: null,
        form: null,
        teluguCoverage: null,
      },
      feedback: safeFeedback,
    }),
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

/**
 * Keeps an early provider transcript on the safe side of the same display
 * boundary as final captions. Mixed-script input is rejected in full so a
 * Telugu-script token can never leak beside an otherwise Latin draft.
 */
export function sanitizeLiveProvisionalTranscript(value: unknown) {
  return cleanCaptionText(value);
}

/**
 * Adds a disposable ASR preview to the latest pending learner row. Unsafe or
 * non-Latin input clears an older preview and leaves the immediate "heard"
 * state in place. It never creates a second row or changes a turn to final.
 */
export function applyProvisionalLearnerTranscript(
  turns: LiveTranscriptTurn[],
  value: unknown,
) {
  const pendingIndex = turns.findLastIndex(
    (turn) => turn.speaker === "you" && !turn.final,
  );
  if (pendingIndex < 0) return turns;

  const provisionalRoman = sanitizeLiveProvisionalTranscript(value);
  const current = turns[pendingIndex];
  if (current.provisionalRoman === provisionalRoman) return turns;

  const next = [...turns];
  if (provisionalRoman) {
    next[pendingIndex] = { ...current, provisionalRoman };
  } else {
    const withoutProvisional = { ...current };
    delete withoutProvisional.provisionalRoman;
    next[pendingIndex] = withoutProvisional;
  }

  return next;
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
