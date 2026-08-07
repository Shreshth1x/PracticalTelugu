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

export type ParsedLivePresentedTurnToolCall = {
  mayu: ParsedLiveCaptionTurn;
  learner: ParsedLiveCaptionTurn | null;
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
const DEFAULT_LEARNER_FEEDBACK =
  "Keep the conversation going and try the next reply naturally.";
const DEFAULT_LOW_CONFIDENCE_FEEDBACK =
  "Please try that reply once more at a comfortable pace.";
const PRESENTED_TURN_TOOL_FIELDS = new Set([
  "mayuTeluguInternal",
  "mayuRoman",
  "mayuPronunciation",
  "mayuEnglish",
  "cueId",
  "reviewedCueId",
  "learnerTeluguInternal",
  "learnerRoman",
  "learnerPronunciation",
  "learnerEnglish",
  "learnerSourceLanguage",
  "replay",
]);
const ASSESS_LEARNER_TOOL_FIELDS = new Set([
  "learnerSourceLanguage",
  "learnerAssessmentConfidence",
  "learnerIntelligibilityRating",
  "learnerPronunciationRating",
  "learnerMeaningRating",
  "learnerFormRating",
  "learnerTeluguCoverageRating",
  "learnerFeedback",
]);
const LIVE_TURN_TOOL_FIELDS = new Set([
  ...PRESENTED_TURN_TOOL_FIELDS,
  ...ASSESS_LEARNER_TOOL_FIELDS,
]);
const LEARNER_CAPTION_FIELDS = [
  "learnerTeluguInternal",
  "learnerRoman",
  "learnerPronunciation",
  "learnerEnglish",
  "learnerSourceLanguage",
] as const;
const LEARNER_RATING_FIELDS = [
  "learnerIntelligibilityRating",
  "learnerPronunciationRating",
  "learnerMeaningRating",
  "learnerFormRating",
  "learnerTeluguCoverageRating",
] as const;
const LEARNER_ASSESSMENT_FIELDS = [
  "learnerSourceLanguage",
  "learnerAssessmentConfidence",
  ...LEARNER_RATING_FIELDS,
  "learnerFeedback",
] as const;
const LEARNER_FIELDS = [
  ...LEARNER_CAPTION_FIELDS,
  ...LEARNER_ASSESSMENT_FIELDS,
] as const;
const TELUGU_INDEPENDENT_VOWELS: Record<string, string> = {
  "అ": "a",
  "ఆ": "aa",
  "ఇ": "i",
  "ఈ": "ee",
  "ఉ": "u",
  "ఊ": "oo",
  "ఋ": "ru",
  "ౠ": "roo",
  "ఌ": "lu",
  "ౡ": "loo",
  "ఎ": "e",
  "ఏ": "ee",
  "ఐ": "ai",
  "ఒ": "o",
  "ఓ": "oo",
  "ఔ": "au",
};
const TELUGU_CONSONANTS: Record<string, string> = {
  "క": "k",
  "ఖ": "kh",
  "గ": "g",
  "ఘ": "gh",
  "ఙ": "ng",
  "చ": "ch",
  "ఛ": "chh",
  "జ": "j",
  "ఝ": "jh",
  "ఞ": "ny",
  "ట": "t",
  "ఠ": "th",
  "డ": "d",
  "ఢ": "dh",
  "ణ": "n",
  "త": "t",
  "థ": "th",
  "ద": "d",
  "ధ": "dh",
  "న": "n",
  "ప": "p",
  "ఫ": "ph",
  "బ": "b",
  "భ": "bh",
  "మ": "m",
  "య": "y",
  "ర": "r",
  "ఱ": "r",
  "ల": "l",
  "ళ": "l",
  "వ": "v",
  "శ": "sh",
  "ష": "sh",
  "స": "s",
  "హ": "h",
  "ౘ": "ts",
  "ౙ": "dz",
};
const TELUGU_VOWEL_SIGNS: Record<string, string> = {
  "ా": "aa",
  "ి": "i",
  "ీ": "ee",
  "ు": "u",
  "ూ": "oo",
  "ృ": "ru",
  "ౄ": "roo",
  "ౢ": "lu",
  "ౣ": "loo",
  "ె": "e",
  "ే": "ee",
  "ై": "ai",
  "ొ": "o",
  "ో": "oo",
  "ౌ": "au",
};
const TELUGU_DIACRITICS: Record<string, string> = {
  "ఀ": "m",
  "ఁ": "m",
  "ం": "m",
  "ః": "h",
};
const TELUGU_DIGITS: Record<string, string> = {
  "౦": "0",
  "౧": "1",
  "౨": "2",
  "౩": "3",
  "౪": "4",
  "౫": "5",
  "౬": "6",
  "౭": "7",
  "౮": "8",
  "౯": "9",
};
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

function hasMeaningfulField(
  args: Record<string, unknown>,
  field: string,
) {
  return args[field] !== undefined && args[field] !== null;
}

function selectToolFields(
  args: Record<string, unknown>,
  fields: readonly string[],
) {
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(args, field)) selected[field] = args[field];
  }
  return selected;
}

/**
 * Converts provider Telugu-script ASR into the same simple English-letter
 * spelling used throughout Practice Live. This is a mechanical script
 * conversion only; authoritative meaning and coaching still come from the
 * model's validated learner fields.
 */
export function transliterateLiveTeluguTranscript(value: unknown) {
  if (typeof value !== "string") return "";
  const input = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!input || input.length > MAX_CAPTION_LENGTH) return "";
  if (!TELUGU_SCRIPT.test(input)) return cleanCaptionText(input);

  const characters = Array.from(input);
  let transliterated = "";

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const consonant = TELUGU_CONSONANTS[character];
    if (consonant !== undefined) {
      transliterated += consonant;
      const next = characters[index + 1];
      if (next === "్") {
        index += 1;
      } else if (TELUGU_VOWEL_SIGNS[next] !== undefined) {
        transliterated += TELUGU_VOWEL_SIGNS[next];
        index += 1;
      } else {
        transliterated += "a";
      }
      continue;
    }

    if (TELUGU_INDEPENDENT_VOWELS[character] !== undefined) {
      transliterated += TELUGU_INDEPENDENT_VOWELS[character];
      continue;
    }
    if (TELUGU_DIACRITICS[character] !== undefined) {
      transliterated += TELUGU_DIACRITICS[character];
      continue;
    }
    if (TELUGU_DIGITS[character] !== undefined) {
      transliterated += TELUGU_DIGITS[character];
      continue;
    }
    if (
      character === "\u200c" ||
      character === "\u200d" ||
      character === "఼" ||
      character === "ౕ" ||
      character === "ౖ"
    ) {
      continue;
    }

    transliterated += character;
  }

  return cleanCaptionText(transliterated);
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
  const normalized =
    typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
  return normalized === "telugu" ||
    normalized === "english" ||
    normalized === "mixed"
    ? normalized
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
  if (/\b(?:avunnaa|deenigaa)\b/iu.test(turn.roman)) return true;

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

  const hasCueId =
    hasMeaningfulField(args, "cueId") ||
    hasMeaningfulField(args, "reviewedCueId");
  if (
    hasMeaningfulField(args, "cueId") &&
    hasMeaningfulField(args, "reviewedCueId") &&
    args.cueId !== args.reviewedCueId
  ) {
    return null;
  }
  const cueIdValue = args.cueId ?? args.reviewedCueId;
  const rawCueId =
    typeof cueIdValue === "string" && cueIdValue.trim()
      ? cueIdValue.trim()
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

export function parseLiveLearnerCaption(
  value: unknown,
): ParsedLiveCaptionTurn | null {
  if (!value || typeof value !== "object") return null;
  const args = value as Record<string, unknown>;
  const learnerRoman = cleanCaptionText(args.learnerRoman);
  const learnerPronunciation = cleanCaptionText(args.learnerPronunciation);
  const learnerEnglish = cleanCaptionText(args.learnerEnglish);
  const learnerTeluguInternal = cleanInternalTelugu(
    args.learnerTeluguInternal,
  );
  const learnerSourceLanguage = sourceLanguage(args.learnerSourceLanguage);

  if (
    !learnerTeluguInternal ||
    !learnerRoman ||
    !learnerEnglish ||
    !learnerSourceLanguage
  ) {
    return null;
  }

  return {
    teluguInternal: learnerTeluguInternal,
    roman: learnerRoman,
    ...(learnerPronunciation
      ? { pronunciation: learnerPronunciation }
      : {}),
    english: learnerEnglish,
    sourceLanguage: learnerSourceLanguage,
  };
}

/**
 * Parses the split present_turn payload. Mayu's complete turn is required,
 * while a learner caption is independently optional. Assessment fields belong
 * to the independent audio-assessment request and are rejected here so missing
 * or late scoring can never invalidate an otherwise safe visible caption.
 */
export function parseLivePresentedTurnToolCall(
  value: unknown,
): ParsedLivePresentedTurnToolCall | null {
  const mayuTurn = parseLiveMayuTurnToolCall(value);
  if (!mayuTurn || !value || typeof value !== "object") return null;
  const args = value as Record<string, unknown>;
  if (
    Object.keys(args).some((field) => !PRESENTED_TURN_TOOL_FIELDS.has(field))
  ) {
    return null;
  }

  const hasAnyLearnerCaption = LEARNER_CAPTION_FIELDS.some((field) =>
    hasMeaningfulField(args, field),
  );
  if (!hasAnyLearnerCaption) return { ...mayuTurn, learner: null };

  const learner = parseLiveLearnerCaption(args);
  return learner ? { ...mayuTurn, learner } : null;
}

/**
 * Parses only audio-derived scoring evidence. Display enrichment is kept
 * independent so an omitted pronunciation guide or caption cannot erase
 * otherwise valid pronunciation and accuracy ratings.
 */
export function parseLiveLearnerAssessment(
  value: unknown,
): LiveLearnerAssessment | null {
  if (!value || typeof value !== "object") return null;
  const args = value as Record<string, unknown>;
  if (
    Object.keys(args).some((field) => !ASSESS_LEARNER_TOOL_FIELDS.has(field))
  ) {
    return null;
  }
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
  const hasAnyLearnerField = LEARNER_ASSESSMENT_FIELDS.some((field) =>
    hasMeaningfulField(args, field),
  );
  const hasAnyLearnerRating = LEARNER_RATING_FIELDS.some((field) =>
    hasMeaningfulField(args, field),
  );
  const hasInvalidRating = ([
    ["learnerIntelligibilityRating", learnerIntelligibilityRating],
    ["learnerPronunciationRating", learnerPronunciationRating],
    ["learnerMeaningRating", learnerMeaningRating],
    ["learnerFormRating", learnerFormRating],
    ["learnerTeluguCoverageRating", learnerTeluguCoverageRating],
  ] as const).some(
    ([field, rating]) => hasMeaningfulField(args, field) && rating === null,
  );

  if (!hasAnyLearnerField) return null;
  if (!learnerAssessmentConfidence || hasInvalidRating) {
    return null;
  }

  if (learnerAssessmentConfidence === "low") {
    if (
      hasMeaningfulField(args, "learnerSourceLanguage") ||
      hasAnyLearnerRating
    ) {
      return null;
    }

    return calibrateLiveLearnerAssessment({
      sourceLanguage: "telugu",
      confidence: "low",
      ratings: {
        intelligibility: null,
        pronunciation: null,
        meaning: null,
        form: null,
        teluguCoverage: null,
      },
      feedback: learnerFeedback || DEFAULT_LOW_CONFIDENCE_FEEDBACK,
    });
  }

  if (!learnerSourceLanguage) return null;
  const hasPronunciationPair =
    learnerIntelligibilityRating !== null &&
    learnerPronunciationRating !== null;
  const hasAccuracyPair =
    learnerMeaningRating !== null && learnerFormRating !== null;
  const hasProhibitedEnglishRatings = [
    "learnerIntelligibilityRating",
    "learnerPronunciationRating",
    "learnerFormRating",
    "learnerTeluguCoverageRating",
  ].some((field) => hasMeaningfulField(args, field));

  if (learnerSourceLanguage === "english") {
    if (hasProhibitedEnglishRatings || learnerMeaningRating === null) {
      return null;
    }
  } else if (learnerSourceLanguage === "telugu") {
    if (
      learnerTeluguCoverageRating !== null ||
      (!hasPronunciationPair && !hasAccuracyPair)
    ) {
      return null;
    }
  } else if (
    learnerTeluguCoverageRating === 0 ||
    (!hasPronunciationPair &&
      !(hasAccuracyPair && learnerTeluguCoverageRating !== null))
  ) {
    return null;
  }

  const mayUseMixedAccuracy =
    learnerSourceLanguage !== "mixed" ||
    learnerTeluguCoverageRating !== null;

  return calibrateLiveLearnerAssessment({
    sourceLanguage: learnerSourceLanguage,
    confidence: learnerAssessmentConfidence,
    ratings: {
      intelligibility: learnerIntelligibilityRating,
      pronunciation: learnerPronunciationRating,
      meaning: mayUseMixedAccuracy ? learnerMeaningRating : null,
      form: mayUseMixedAccuracy ? learnerFormRating : null,
      teluguCoverage: learnerTeluguCoverageRating,
    },
    feedback: learnerFeedback || DEFAULT_LEARNER_FEEDBACK,
  });
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

  const hasAnyLearnerField = LEARNER_FIELDS.some((field) =>
    hasMeaningfulField(args, field),
  );
  if (!hasAnyLearnerField) return { ...mayuTurn, learner: null };

  const assessment = parseLiveLearnerAssessment(
    selectToolFields(args, LEARNER_ASSESSMENT_FIELDS),
  );
  if (!assessment) return null;
  if (assessment.confidence === "low") {
    return {
      ...mayuTurn,
      learner: createUnscoredLiveLearnerCaption(assessment.feedback),
    };
  }

  const caption = parseLiveLearnerCaption(args);
  if (!caption) return null;

  return {
    ...mayuTurn,
    learner: { ...caption, assessment },
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

export function createLiveLearnerTranscriptFallback(
  providerTranscript: unknown,
): ParsedLiveCaptionTurn {
  const roman = sanitizeLiveProvisionalTranscript(providerTranscript);

  return {
    teluguInternal: "",
    roman: roman || "Reply received",
    english: roman
      ? "Automatic microphone transcript; it may be inaccurate and is unverified. English meaning unavailable."
      : "Your reply was heard, but a readable transcript was unavailable.",
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

/** Keeps provider ASR readable without exposing Telugu script in the UI. */
export function sanitizeLiveProvisionalTranscript(value: unknown) {
  return transliterateLiveTeluguTranscript(value);
}

/**
 * Adds a provider ASR preview to the latest pending learner row. Telugu script
 * is mechanically transliterated; other unsafe scripts clear an older preview.
 * It never creates a second row or changes a turn to final.
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

/**
 * Attaches an asynchronous audio-assessment result to exactly one completed
 * learner row. Pending provider ASR and Mayu rows are never made authoritative
 * by an assessment response, and every unrelated row keeps its position and
 * object identity.
 */
export function applyLiveLearnerAssessment(
  turns: LiveTranscriptTurn[],
  learnerTurnId: string,
  assessment: LiveLearnerAssessment,
) {
  const index = turns.findIndex(
    (turn) =>
      turn.id === learnerTurnId && turn.speaker === "you" && turn.final,
  );
  if (index < 0 || turns[index].assessment === assessment) return turns;

  const next = [...turns];
  next[index] = { ...turns[index], assessment };
  return next;
}

export function removePendingLiveTurns(turns: LiveTranscriptTurn[]) {
  return turns.filter((turn) => turn.final);
}

/**
 * Preserves a provider transcript only when a session ends, and marks every
 * completed learner caption whose asynchronous assessment is still missing as
 * explicitly unscored. Provider ASR remains provisional during the session.
 */
export function finalizeLiveTranscriptForEnd(
  turns: LiveTranscriptTurn[],
) {
  return turns.flatMap((turn) => {
    if (turn.final) {
      if (turn.speaker !== "you" || turn.assessment) return [turn];

      return [
        {
          ...turn,
          assessment: createUnscoredLiveLearnerCaption(
            "The session ended before this reply could be assessed.",
            "incomplete-assessment",
          ).assessment,
        },
      ];
    }
    if (turn.speaker !== "you" || !turn.provisionalRoman) return [];

    const fallback = createLiveLearnerTranscriptFallback(
      turn.provisionalRoman,
    );
    if (fallback.roman === "Reply received") return [];

    return [
      {
        ...turn,
        roman: fallback.roman,
        english: fallback.english,
        final: true,
        assessment: createUnscoredLiveLearnerCaption(
          "The session ended before this reply could be assessed.",
          "incomplete-assessment",
        ).assessment,
        provisionalRoman: undefined,
      },
    ];
  });
}
