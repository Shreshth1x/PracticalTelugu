export const LIVE_ASSESSMENT_CONFIDENCES = [
  "high",
  "medium",
  "low",
] as const;

export type LiveAssessmentConfidence =
  (typeof LIVE_ASSESSMENT_CONFIDENCES)[number];

export type LiveAssessmentSource = "telugu" | "english" | "mixed";

export type LiveLearnerRubricRatings = {
  intelligibility: number | null;
  pronunciation: number | null;
  meaning: number | null;
  form: number | null;
  teluguCoverage: number | null;
};

export type CalibratedLiveLearnerAssessment = {
  pronunciationScore: number | null;
  accuracyScore: number | null;
  languageScore: number | null;
  confidence: LiveAssessmentConfidence;
  ratings: LiveLearnerRubricRatings;
  feedback: string;
};

function isNullableScore(value: unknown) {
  return (
    value === null ||
    (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100)
  );
}

function isNullableRating(value: unknown) {
  return (
    value === null ||
    (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4)
  );
}

/** Strictly validates the calibrated assessment returned by the server. */
export function isCalibratedLiveLearnerAssessment(
  value: unknown,
): value is CalibratedLiveLearnerAssessment {
  if (!value || typeof value !== "object") return false;
  const assessment = value as Record<string, unknown>;
  if (
    !isNullableScore(assessment.pronunciationScore) ||
    !isNullableScore(assessment.accuracyScore) ||
    !isNullableScore(assessment.languageScore) ||
    !LIVE_ASSESSMENT_CONFIDENCES.includes(
      assessment.confidence as LiveAssessmentConfidence,
    ) ||
    typeof assessment.feedback !== "string" ||
    !assessment.feedback.trim() ||
    assessment.feedback.length > 180 ||
    !assessment.ratings ||
    typeof assessment.ratings !== "object"
  ) {
    return false;
  }

  const ratings = assessment.ratings as Record<string, unknown>;
  return (
    isNullableRating(ratings.intelligibility) &&
    isNullableRating(ratings.pronunciation) &&
    isNullableRating(ratings.meaning) &&
    isNullableRating(ratings.form) &&
    isNullableRating(ratings.teluguCoverage)
  );
}

// These are intentionally broad, learner-friendly bands. Asking the model for
// four independent ordinal judgments is more repeatable than asking it to
// invent a precise percentage directly; the app owns the percentage mapping.
const RATING_SCORES = [0, 40, 65, 84, 100] as const;
// These ceilings keep a severe sound or form problem from being washed out by
// an otherwise strong paired dimension, while leaving a localized issue high.
const MEANING_CAPS = [0, 45, 72, 90, 100] as const;
const PRONUNCIATION_CAPS = [40, 70, 84, 94, 100] as const;
const FORM_CAPS = [40, 65, 82, 94, 100] as const;
const TELUGU_COVERAGE_CAPS = [0, 50, 70, 85, 100] as const;

function scoreForRating(rating: number | null) {
  return rating === null || !Number.isInteger(rating) || rating < 0 || rating > 4
    ? null
    : RATING_SCORES[rating];
}

function weightedScore(
  primary: number | null,
  secondary: number | null,
  primaryWeight: number,
) {
  if (primary === null || secondary === null) return null;
  return Math.round(primary * primaryWeight + secondary * (1 - primaryWeight));
}

function capForRating(rating: number | null, caps: readonly number[]) {
  return rating === null || !Number.isInteger(rating) || rating < 0 || rating > 4
    ? null
    : caps[rating];
}

/**
 * Converts Gemini's evidence-level rubric into stable product scores.
 *
 * Low-confidence audio is deliberately left unscored. English can still earn
 * limited conversational credit, but it can never masquerade as accurate
 * spoken Telugu. For Telugu and mixed replies, meaning matters most while
 * broken grammar, word choice, or register still lowers the accuracy result.
 */
export function calibrateLiveLearnerAssessment({
  sourceLanguage,
  confidence,
  ratings,
  feedback,
}: {
  sourceLanguage: LiveAssessmentSource;
  confidence: LiveAssessmentConfidence;
  ratings: LiveLearnerRubricRatings;
  feedback: string;
}): CalibratedLiveLearnerAssessment {
  if (confidence === "low") {
    return {
      pronunciationScore: null,
      accuracyScore: null,
      languageScore: null,
      confidence,
      ratings: {
        intelligibility: null,
        pronunciation: null,
        meaning: null,
        form: null,
        teluguCoverage: null,
      },
      feedback,
    };
  }

  const intelligibility = scoreForRating(ratings.intelligibility);
  const pronunciation = scoreForRating(ratings.pronunciation);
  const meaning = scoreForRating(ratings.meaning);
  const form = scoreForRating(ratings.form);

  const rawPronunciationScore =
    sourceLanguage === "english"
      ? null
      : weightedScore(intelligibility, pronunciation, 0.65);
  const pronunciationCap = capForRating(
    ratings.pronunciation,
    PRONUNCIATION_CAPS,
  );
  const pronunciationScore =
    rawPronunciationScore === null || pronunciationCap === null
      ? null
      : Math.min(rawPronunciationScore, pronunciationCap);
  const coverageCap =
    sourceLanguage === "english"
      ? 50
      : sourceLanguage === "telugu"
        ? 100
        : capForRating(ratings.teluguCoverage, TELUGU_COVERAGE_CAPS);

  let accuracyScore: number | null;
  if (sourceLanguage === "english") {
    // English may answer the conversation correctly, but this is Telugu
    // practice. Enforce the ceiling locally instead of trusting a prompt.
    accuracyScore = meaning === null ? null : Math.min(50, meaning);
  } else {
    const combined = weightedScore(meaning, form, 0.65);
    const meaningCap = capForRating(ratings.meaning, MEANING_CAPS);
    const formCap = capForRating(ratings.form, FORM_CAPS);
    accuracyScore =
      combined === null || meaningCap === null || formCap === null
        ? null
        : Math.min(combined, meaningCap, formCap);
  }

  if (
    sourceLanguage === "mixed" &&
    accuracyScore !== null &&
    coverageCap !== null
  ) {
    accuracyScore = Math.min(accuracyScore, coverageCap);
  }

  const rawLanguageScore = weightedScore(
    pronunciationScore,
    accuracyScore,
    0.5,
  );
  const languageScore =
    sourceLanguage === "english"
      ? accuracyScore
      : rawLanguageScore === null || coverageCap === null
        ? null
        : Math.min(rawLanguageScore, coverageCap);

  return {
    pronunciationScore,
    accuracyScore,
    languageScore,
    confidence,
    ratings: {
      intelligibility:
        sourceLanguage === "english" ? null : ratings.intelligibility,
      pronunciation:
        sourceLanguage === "english" ? null : ratings.pronunciation,
      meaning: ratings.meaning,
      form: sourceLanguage === "english" ? null : ratings.form,
      teluguCoverage:
        sourceLanguage === "mixed" ? ratings.teluguCoverage : null,
    },
    feedback,
  };
}
