import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLiveLearnerAssessment,
  createLiveLearnerTranscriptFallback,
  createUnscoredLiveLearnerCaption,
  finalizeLiveTranscriptForEnd,
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesReviewedLiveCue,
  parseLiveLearnerAssessment,
  parseLiveLearnerCaption,
  parseLiveMayuTurnToolCall,
  parseLivePresentedTurnToolCall,
} from "../app/practice-live/live-transcript.ts";

const reviewedCue = {
  telugu: "తిన్నావా?",
  roman: "tinnaavaa?",
  pronunciation: "tin-NAA-vaa?",
  english: "have you eaten?",
};

const completePresentedTurnCall = {
  mayuTeluguInternal: "తిన్నావా?",
  mayuRoman: "tinnaavaa?",
  mayuPronunciation: "tin-NAA-vaa?",
  mayuEnglish: "Have you eaten?",
  cueId: "have-you-eaten__primary",
  learnerTeluguInternal: "తిన్నాను.",
  learnerRoman: "tinnaanu.",
  learnerPronunciation: "tin-NAA-noo.",
  learnerEnglish: "I ate.",
  learnerSourceLanguage: "telugu",
};

const completeAssessmentCall = {
  learnerSourceLanguage: "telugu",
  learnerAssessmentConfidence: "high",
  learnerIntelligibilityRating: 4,
  learnerPronunciationRating: 3,
  learnerMeaningRating: 4,
  learnerFormRating: 4,
  learnerFeedback: "Hold the long aa sound in tinnaanu.",
};

const nullLearnerCaptionFields = {
  learnerTeluguInternal: null,
  learnerRoman: null,
  learnerPronunciation: null,
  learnerEnglish: null,
  learnerSourceLanguage: null,
};

const nullAssessmentFields = {
  learnerSourceLanguage: null,
  learnerAssessmentConfidence: null,
  learnerIntelligibilityRating: null,
  learnerPronunciationRating: null,
  learnerMeaningRating: null,
  learnerFormRating: null,
  learnerTeluguCoverageRating: null,
  learnerFeedback: null,
};

test("retains native Telugu for internal validation without adding it to visible captions", () => {
  const presented = parseLivePresentedTurnToolCall(
    completePresentedTurnCall,
  );
  const assessment = parseLiveLearnerAssessment(completeAssessmentCall);

  assert.equal(presented?.mayu.teluguInternal, "తిన్నావా?");
  assert.equal(presented?.learner?.teluguInternal, "తిన్నాను.");
  assert.equal(presented?.learner?.sourceLanguage, "telugu");
  assert.equal(Object.hasOwn(presented?.learner ?? {}, "assessment"), false);
  assert.deepEqual(assessment, {
    pronunciationScore: 94,
    accuracyScore: 100,
    languageScore: 97,
    confidence: "high",
    ratings: {
      intelligibility: 4,
      pronunciation: 3,
      meaning: 4,
      form: 4,
      teluguCoverage: null,
    },
    feedback: "Hold the long aa sound in tinnaanu.",
  });
});

test("treats the required all-null learner contract as an opening turn", () => {
  const parsed = parseLivePresentedTurnToolCall({
    mayuTeluguInternal: completePresentedTurnCall.mayuTeluguInternal,
    mayuRoman: completePresentedTurnCall.mayuRoman,
    mayuPronunciation: completePresentedTurnCall.mayuPronunciation,
    mayuEnglish: completePresentedTurnCall.mayuEnglish,
    ...nullLearnerCaptionFields,
  });

  assert.equal(parsed?.learner, null);
});

test("keeps split caption and assessment validation independent", () => {
  const learnerCaptionFields = [
    "learnerTeluguInternal",
    "learnerRoman",
    "learnerEnglish",
    "learnerSourceLanguage",
  ];

  for (const missingField of learnerCaptionFields) {
    const adversarial = { ...completePresentedTurnCall };
    delete adversarial[missingField];
    assert.equal(
      parseLivePresentedTurnToolCall(adversarial),
      null,
      `accepted learner caption without ${missingField}`,
    );
  }

  for (const [missingField, missingMetric, preservedMetric] of [
    ["learnerIntelligibilityRating", "pronunciationScore", "accuracyScore"],
    ["learnerPronunciationRating", "pronunciationScore", "accuracyScore"],
    ["learnerMeaningRating", "accuracyScore", "pronunciationScore"],
    ["learnerFormRating", "accuracyScore", "pronunciationScore"],
  ]) {
    const partial = { ...completeAssessmentCall };
    delete partial[missingField];
    const parsed = parseLiveLearnerAssessment(partial);
    assert.equal(parsed?.[missingMetric], null);
    assert.notEqual(parsed?.[preservedMetric], null);
  }

  assert.equal(
    parseLivePresentedTurnToolCall({
      mayuTeluguInternal: completePresentedTurnCall.mayuTeluguInternal,
      mayuRoman: completePresentedTurnCall.mayuRoman,
      mayuPronunciation: completePresentedTurnCall.mayuPronunciation,
      mayuEnglish: completePresentedTurnCall.mayuEnglish,
      learnerSourceLanguage: "telugu",
    }),
    null,
  );
  assert.equal(
    parseLivePresentedTurnToolCall({
      ...completePresentedTurnCall,
      learnerSourceLanguage: "unknown",
    }),
    null,
  );
  assert.equal(
    parseLivePresentedTurnToolCall({
      ...completePresentedTurnCall,
      learnerSourceLanguage: " TELUGU ",
    })?.learner?.sourceLanguage,
    "telugu",
    "provider enum casing must not strand an otherwise valid live turn",
  );
  assert.equal(
    parseLiveLearnerAssessment({
      ...completeAssessmentCall,
      learnerSourceLanguage: "TELUGU",
    })?.pronunciationScore,
    94,
  );
  for (const learnerAssessmentConfidence of [undefined, "uncertain", 1]) {
    assert.equal(
      parseLiveLearnerAssessment({
        ...completeAssessmentCall,
        learnerAssessmentConfidence,
      }),
      null,
      `accepted confidence ${String(learnerAssessmentConfidence)}`,
    );
  }

  const ratingFields = [
    "learnerIntelligibilityRating",
    "learnerPronunciationRating",
    "learnerMeaningRating",
    "learnerFormRating",
  ];
  for (const ratingField of ratingFields) {
    for (const invalidRating of [-1, 5, 2.5, "4", Number.NaN]) {
      assert.equal(
        parseLiveLearnerAssessment({
          ...completeAssessmentCall,
          [ratingField]: invalidRating,
        }),
        null,
        `accepted ${ratingField}=${String(invalidRating)}`,
      );
    }
  }
  assert.equal(
    parseLiveLearnerAssessment({
      ...completeAssessmentCall,
      learnerTeluguCoverageRating: 4,
    }),
    null,
    "an entirely Telugu reply must not include a mixed-language coverage rating",
  );
  for (const deprecatedOrUnknownField of [
    "learnerAccuracyRating",
    "learnerAccentRating",
    "unexpectedField",
  ]) {
    assert.equal(
      parseLiveLearnerAssessment({
        ...completeAssessmentCall,
        [deprecatedOrUnknownField]: 4,
      }),
      null,
      `accepted unknown field ${deprecatedOrUnknownField}`,
    );
  }

  assert.equal(
    parseLivePresentedTurnToolCall({
      ...completePresentedTurnCall,
      learnerAssessmentConfidence: "high",
    }),
    null,
    "present_turn must reject assess_learner fields",
  );
  assert.equal(
    parseLiveLearnerAssessment({
      ...completeAssessmentCall,
      learnerRoman: "tinnaanu.",
    }),
    null,
    "assess_learner must reject present_turn caption fields",
  );
  assert.ok(parseLivePresentedTurnToolCall(completePresentedTurnCall));
  assert.equal(
    parseLiveLearnerAssessment({
      ...completeAssessmentCall,
      learnerPronunciationRating: 8,
    }),
    null,
    "a bad assessment must not invalidate the separately parsed caption",
  );
  assert.equal(
    parseLiveLearnerAssessment({
      ...completeAssessmentCall,
      learnerFeedback: "తెలుగు script must stay private.",
    })?.feedback,
    "Keep the conversation going and try the next reply naturally.",
    "unsafe optional coaching is replaced locally instead of erasing scores",
  );
});

test("keeps transcript and scores when the optional pronunciation guide is missing", () => {
  const missingLearnerPronunciation = { ...completePresentedTurnCall };
  delete missingLearnerPronunciation.learnerPronunciation;

  const recovered = parseLivePresentedTurnToolCall(
    missingLearnerPronunciation,
  );
  assert.equal(recovered?.learner?.roman, "tinnaanu.");
  assert.equal(recovered?.learner?.pronunciation, undefined);
  assert.equal(Object.hasOwn(recovered?.learner ?? {}, "assessment"), false);
  assert.equal(
    parseLiveLearnerCaption(missingLearnerPronunciation)?.roman,
    "tinnaanu.",
  );
  assert.equal(
    parseLiveLearnerAssessment(completeAssessmentCall)?.languageScore,
    97,
  );

  const mayuTurn = parseLiveMayuTurnToolCall({
    ...missingLearnerPronunciation,
    unexpectedLearnerMetadata: "ignored",
  });
  assert.deepEqual(mayuTurn, {
    mayu: {
      teluguInternal: "తిన్నావా?",
      roman: "tinnaavaa?",
      pronunciation: "tin-NAA-vaa?",
      english: "Have you eaten?",
      cueId: "have-you-eaten__primary",
      sourceLanguage: "telugu",
    },
    replay: false,
  });

  assert.deepEqual(
    createUnscoredLiveLearnerCaption(
      "Keep the conversation going and try the next reply naturally.",
      "incomplete-assessment",
    ),
    {
      teluguInternal: "",
      roman: "Reply received",
      english: "Your reply was heard, but this turn was not scored.",
      assessment: {
        pronunciationScore: null,
        accuracyScore: null,
        languageScore: null,
        confidence: "low",
        ratings: {
          intelligibility: null,
          pronunciation: null,
          meaning: null,
          form: null,
          teluguCoverage: null,
        },
        feedback:
          "Keep the conversation going and try the next reply naturally.",
      },
    },
  );

  assert.deepEqual(
    createLiveLearnerTranscriptFallback("నీళ్లు ఇస్తారా?"),
    {
      teluguInternal: "",
      roman: "neellu istaaraa?",
      english:
        "Automatic microphone transcript; it may be inaccurate and is unverified. English meaning unavailable.",
    },
  );
});

test("preserves the exact natural Telugu payload observed in live audio", () => {
  const presented = parseLivePresentedTurnToolCall({
    mayuTeluguInternal: "ఇగోండి నీళ్లు. ఇంకేమైనా కావాలా?",
    mayuRoman: "eegodee neellu. inkaymainaa kaavaalaa?",
    mayuPronunciation: "EE-go-DEE NEEL-loo. in-KAY-my-NAA KAA-vaa-LAA?",
    mayuEnglish: "Here is water. Do you want anything else?",
    learnerTeluguInternal: "నీళ్లు ఇస్తారా?",
    learnerRoman: "neellu istaaraa?",
    learnerPronunciation: null,
    learnerEnglish: "Will you give water?",
    learnerSourceLanguage: "telugu",
  });
  const assessment = parseLiveLearnerAssessment({
    learnerSourceLanguage: "telugu",
    learnerAssessmentConfidence: "high",
    learnerIntelligibilityRating: 4,
    learnerPronunciationRating: 4,
    learnerMeaningRating: 4,
    learnerFormRating: 4,
    learnerTeluguCoverageRating: null,
    learnerFeedback:
      "Good question! Try asking for water with neellu kaavaali next time.",
  });

  assert.equal(presented?.learner?.roman, "neellu istaaraa?");
  assert.equal(presented?.learner?.pronunciation, undefined);
  assert.equal(assessment?.pronunciationScore, 100);
  assert.equal(assessment?.accuracyScore, 100);
  assert.equal(assessment?.languageScore, 100);
});

test("accepts all four ratings with medium-confidence Telugu audio", () => {
  const parsed = parseLiveLearnerAssessment({
    ...completeAssessmentCall,
    learnerAssessmentConfidence: "medium",
  });

  assert.equal(parsed?.confidence, "medium");
  assert.equal(parsed?.pronunciationScore, 94);
  assert.equal(parsed?.accuracyScore, 100);
  assert.equal(parsed?.languageScore, 97);
});

test("keeps valid ratings scored when learner feedback is explicitly null", () => {
  const parsed = parseLiveLearnerAssessment({
    ...completeAssessmentCall,
    learnerFeedback: null,
  });

  assert.equal(parsed?.pronunciationScore, 94);
  assert.equal(parsed?.accuracyScore, 100);
  assert.equal(parsed?.languageScore, 97);
  assert.equal(
    parsed?.feedback,
    "Keep the conversation going and try the next reply naturally.",
    "nullable optional coaching must use the deterministic local fallback",
  );
});

test("finalizes pending ASR as a visible unscored learner row at session end", () => {
  const finalized = finalizeLiveTranscriptForEnd([
    {
      id: "you-pending",
      speaker: "you",
      roman: "",
      provisionalRoman: "nenu baagunnaanu",
      english: "",
      final: false,
    },
  ]);

  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].id, "you-pending");
  assert.equal(finalized[0].speaker, "you");
  assert.equal(finalized[0].final, true);
  assert.equal(finalized[0].roman, "nenu baagunnaanu");
  assert.equal(
    finalized[0].english,
    "Automatic microphone transcript; it may be inaccurate and is unverified. English meaning unavailable.",
  );
  assert.equal(finalized[0].provisionalRoman, undefined);
  assert.deepEqual(finalized[0].assessment, {
    pronunciationScore: null,
    accuracyScore: null,
    languageScore: null,
    confidence: "low",
    ratings: {
      intelligibility: null,
      pronunciation: null,
      meaning: null,
      form: null,
      teluguCoverage: null,
    },
    feedback: "The session ended before this reply could be assessed.",
  });

  assert.deepEqual(
    finalizeLiveTranscriptForEnd([
      {
        id: "you-empty",
        speaker: "you",
        roman: "",
        english: "",
        final: false,
      },
    ]),
    [],
    "an empty pending placeholder still disappears at session end",
  );
});

test("attaches or replaces one final learner assessment without reordering rows", () => {
  const assessment = parseLiveLearnerAssessment(completeAssessmentCall);
  const replacement = parseLiveLearnerAssessment({
    ...completeAssessmentCall,
    learnerAssessmentConfidence: "medium",
    learnerFeedback: "Keep the long aa steady.",
  });
  assert.ok(assessment);
  assert.ok(replacement);

  const turns = [
    {
      id: "mayu-1",
      speaker: "mayu",
      roman: "tinnaavaa?",
      english: "Have you eaten?",
      final: true,
    },
    {
      id: "learner-pending",
      speaker: "you",
      roman: "",
      provisionalRoman: "inka",
      english: "",
      final: false,
    },
    {
      id: "learner-final",
      speaker: "you",
      roman: "tinnaanu.",
      english: "I ate.",
      final: true,
    },
    {
      id: "learner-other",
      speaker: "you",
      roman: "baagunnaanu.",
      english: "I am well.",
      final: true,
    },
  ];

  const attached = applyLiveLearnerAssessment(
    turns,
    "learner-final",
    assessment,
  );
  assert.notEqual(attached, turns);
  assert.deepEqual(
    attached.map((turn) => turn.id),
    turns.map((turn) => turn.id),
  );
  assert.equal(turns[2].assessment, undefined, "input remains untouched");
  assert.equal(attached[2].assessment, assessment);
  assert.equal(attached[0], turns[0]);
  assert.equal(attached[1], turns[1]);
  assert.equal(attached[3], turns[3]);

  const replaced = applyLiveLearnerAssessment(
    attached,
    "learner-final",
    replacement,
  );
  assert.equal(replaced[2].assessment, replacement);
  assert.equal(replaced[0], attached[0]);
  assert.equal(replaced[1], attached[1]);
  assert.equal(replaced[3], attached[3]);
  assert.equal(
    applyLiveLearnerAssessment(turns, "learner-pending", assessment),
    turns,
    "pending ASR cannot receive an authoritative assessment",
  );
  assert.equal(
    applyLiveLearnerAssessment(turns, "mayu-1", assessment),
    turns,
    "a Mayu row cannot receive a learner assessment",
  );
  assert.equal(
    applyLiveLearnerAssessment(turns, "missing", assessment),
    turns,
  );
});

test("marks a final learner caption unscored when its async assessment never arrives", () => {
  const existingAssessment = parseLiveLearnerAssessment(
    completeAssessmentCall,
  );
  assert.ok(existingAssessment);
  const turns = [
    {
      id: "mayu",
      speaker: "mayu",
      roman: "tinnaavaa?",
      english: "Have you eaten?",
      final: true,
    },
    {
      id: "learner-unassessed",
      speaker: "you",
      roman: "tinnaanu.",
      english: "I ate.",
      final: true,
    },
    {
      id: "learner-assessed",
      speaker: "you",
      roman: "baagunnaanu.",
      english: "I am well.",
      final: true,
      assessment: existingAssessment,
    },
  ];

  const finalized = finalizeLiveTranscriptForEnd(turns);
  assert.deepEqual(
    finalized.map((turn) => turn.id),
    ["mayu", "learner-unassessed", "learner-assessed"],
  );
  assert.equal(finalized[0], turns[0]);
  assert.equal(finalized[2], turns[2]);
  assert.equal(finalized[1].roman, "tinnaanu.");
  assert.equal(finalized[1].english, "I ate.");
  assert.equal(finalized[1].assessment.confidence, "low");
  assert.equal(finalized[1].assessment.languageScore, null);
  assert.equal(
    finalized[1].assessment.feedback,
    "The session ended before this reply could be assessed.",
  );
});

test("requires only meaning and locally caps an entirely English reply", () => {
  const englishReply = { ...completeAssessmentCall };
  delete englishReply.learnerIntelligibilityRating;
  delete englishReply.learnerPronunciationRating;
  delete englishReply.learnerFormRating;
  englishReply.learnerSourceLanguage = "english";
  englishReply.learnerMeaningRating = 4;

  const parsed = parseLiveLearnerAssessment(englishReply);
  assert.equal(parsed?.pronunciationScore, null);
  assert.equal(parsed?.accuracyScore, 50);
  assert.equal(parsed?.languageScore, 50);
  assert.deepEqual(parsed?.ratings, {
    intelligibility: null,
    pronunciation: null,
    meaning: 4,
    form: null,
    teluguCoverage: null,
  });

  for (const requiredField of [
    "learnerSourceLanguage",
    "learnerAssessmentConfidence",
    "learnerMeaningRating",
  ]) {
    const missingField = { ...englishReply };
    delete missingField[requiredField];
    assert.equal(
      parseLiveLearnerAssessment(missingField),
      null,
      `an English reply must require ${requiredField}`,
    );
  }

  for (const prohibitedRating of [
    "learnerIntelligibilityRating",
    "learnerPronunciationRating",
    "learnerFormRating",
    "learnerTeluguCoverageRating",
  ]) {
    assert.equal(
      parseLiveLearnerAssessment({
        ...englishReply,
        [prohibitedRating]: 4,
      }),
      null,
      `an English reply must reject ${prohibitedRating}`,
    );
  }

  delete englishReply.learnerMeaningRating;
  assert.equal(parseLiveLearnerAssessment(englishReply), null);
});

test("keeps safe partial mixed scores and requires coverage for accuracy", () => {
  const mixedReply = {
    ...completeAssessmentCall,
    learnerSourceLanguage: "mixed",
    learnerTeluguCoverageRating: 2,
  };
  const parsed = parseLiveLearnerAssessment(mixedReply);

  assert.equal(parsed?.pronunciationScore, 94);
  assert.equal(parsed?.accuracyScore, 70);
  assert.equal(parsed?.languageScore, 70);
  assert.equal(parsed?.ratings.teluguCoverage, 2);

  const missingPronunciationRating = { ...mixedReply };
  delete missingPronunciationRating.learnerPronunciationRating;
  assert.equal(
    parseLiveLearnerAssessment(missingPronunciationRating)?.pronunciationScore,
    null,
  );
  assert.equal(
    parseLiveLearnerAssessment(missingPronunciationRating)?.accuracyScore,
    70,
  );

  const missingMeaningRating = { ...mixedReply };
  delete missingMeaningRating.learnerMeaningRating;
  assert.equal(
    parseLiveLearnerAssessment(missingMeaningRating)?.pronunciationScore,
    94,
  );
  assert.equal(
    parseLiveLearnerAssessment(missingMeaningRating)?.accuracyScore,
    null,
  );

  delete mixedReply.learnerTeluguCoverageRating;
  const withoutCoverage = parseLiveLearnerAssessment(mixedReply);
  assert.equal(withoutCoverage?.pronunciationScore, 94);
  assert.equal(withoutCoverage?.accuracyScore, null);
  assert.equal(withoutCoverage?.languageScore, null);

  assert.equal(
    parseLiveLearnerAssessment({
      ...mixedReply,
      learnerTeluguCoverageRating: 0,
    }),
    null,
    "zero Telugu coverage must use the English source contract",
  );

  for (const invalidRating of [-1, 5, 2.5, "2", Number.NaN]) {
    assert.equal(
      parseLiveLearnerAssessment({
        ...mixedReply,
        learnerTeluguCoverageRating: invalidRating,
      }),
      null,
      `accepted learnerTeluguCoverageRating=${String(invalidRating)}`,
    );
  }
});

test("accepts only a captionless abstention when audio confidence is low", () => {
  const lowConfidenceAssessment = {
    ...nullAssessmentFields,
    learnerAssessmentConfidence: "low",
    learnerFeedback: "Please repeat once at a comfortable volume.",
  };

  const parsed = parseLiveLearnerAssessment(lowConfidenceAssessment);
  assert.deepEqual(parsed, {
    pronunciationScore: null,
    accuracyScore: null,
    languageScore: null,
    confidence: "low",
    ratings: {
      intelligibility: null,
      pronunciation: null,
      meaning: null,
      form: null,
      teluguCoverage: null,
    },
    feedback: "Please repeat once at a comfortable volume.",
  });

  const forbiddenLowConfidenceFields = {
    learnerTeluguInternal: "తిన్నాను.",
    learnerRoman: "tinnaanu.",
    learnerPronunciation: "tin-NAA-noo.",
    learnerEnglish: "I ate.",
    learnerSourceLanguage: "telugu",
    learnerIntelligibilityRating: 4,
    learnerPronunciationRating: 4,
    learnerMeaningRating: 4,
    learnerFormRating: 4,
    learnerTeluguCoverageRating: 4,
  };
  for (const [field, value] of Object.entries(forbiddenLowConfidenceFields)) {
    assert.equal(
      parseLiveLearnerAssessment({
        ...lowConfidenceAssessment,
        [field]: value,
      }),
      null,
      `a low-confidence reply must reject ${field}`,
    );
  }
  assert.equal(
    parseLiveLearnerAssessment({
      ...lowConfidenceAssessment,
      learnerSourceLanguage: "unknown",
    }),
    null,
    "a low-confidence abstention must reject an invalid source claim",
  );
  assert.equal(
    parseLiveLearnerAssessment({
      ...lowConfidenceAssessment,
      learnerAccuracyRating: 4,
    }),
    null,
    "a low-confidence reply must reject deprecated learner ratings",
  );

  const missingFeedback = { ...lowConfidenceAssessment };
  delete missingFeedback.learnerFeedback;
  assert.equal(
    parseLiveLearnerAssessment(missingFeedback)?.feedback,
    "Please try that reply once more at a comfortable pace.",
    "missing optional coaching uses the safe low-confidence fallback",
  );
});

test("rejects a malformed cueId instead of silently treating it as omitted", () => {
  const mayuOnly = {
    mayuTeluguInternal: completePresentedTurnCall.mayuTeluguInternal,
    mayuRoman: completePresentedTurnCall.mayuRoman,
    mayuPronunciation: completePresentedTurnCall.mayuPronunciation,
    mayuEnglish: completePresentedTurnCall.mayuEnglish,
  };
  assert.equal(
    parseLivePresentedTurnToolCall({
      ...mayuOnly,
      cueId: 17,
    }),
    null,
  );
  assert.equal(
    parseLivePresentedTurnToolCall({
      ...mayuOnly,
      reviewedCueId: "have-you-eaten__primary",
    })?.mayu.cueId,
    "have-you-eaten__primary",
    "the provider's bounded cue alias is normalized before validation",
  );
  assert.equal(
    parseLivePresentedTurnToolCall({
      ...mayuOnly,
      cueId: "have-you-eaten__primary",
      reviewedCueId: "have-you-eaten__alt_0",
    }),
    null,
    "conflicting cue aliases fail closed",
  );
});

test("accepts a cueId only when all four normalized reviewed fields match exactly", () => {
  const parsed = parseLivePresentedTurnToolCall(completePresentedTurnCall);
  assert.ok(parsed);
  assert.equal(matchesReviewedLiveCue(parsed.mayu, reviewedCue), true);

  const adversarialSubstitutions = {
    teluguInternal: "తిన్నారా?",
    roman: "tinnaaraa?",
    pronunciation: "tin-NAA-raa?",
    english: "Did you eat already?",
  };

  for (const [field, value] of Object.entries(adversarialSubstitutions)) {
    assert.equal(
      matchesReviewedLiveCue({ ...parsed.mayu, [field]: value }, reviewedCue),
      false,
      `accepted a cue whose ${field} did not match`,
    );
  }

  assert.equal(
    matchesReviewedLiveCue(
      {
        ...parsed.mayu,
        roman: "  TINNAAVAA!  ",
        pronunciation: "tin NAA vaa",
        english: "HAVE YOU EATEN!",
      },
      reviewedCue,
    ),
    true,
  );
  assert.equal(
    matchesReviewedLiveCue(
      { ...parsed.mayu, roman: "tinnaavaa ippudu?" },
      reviewedCue,
    ),
    false,
  );
});

test("blocks copied-English fillers from Mayu's audible Telugu", () => {
  const parsed = parseLivePresentedTurnToolCall(completePresentedTurnCall);
  assert.ok(parsed);
  assert.equal(hasForbiddenAudibleEnglish(parsed.mayu), false);

  for (const turn of [
    { teluguInternal: "ఓ, అవునా?", roman: "oh, avunnaa?" },
    { teluguInternal: "ఓకే, చెప్తాను.", roman: "okay, cheptaanu." },
    { teluguInternal: "సారీ, మళ్లీ చెప్పండి.", roman: "sorry, malli cheppandi." },
  ]) {
    assert.equal(hasForbiddenAudibleEnglish(turn), true);
  }
});

test("rejects the known pasi-for-hunger learner caption mistake", () => {
  const parsed = parseLivePresentedTurnToolCall(completePresentedTurnCall);
  assert.ok(parsed?.learner);
  assert.equal(hasKnownLearnerMeaningMismatch(parsed.learner), false);

  assert.equal(
    hasKnownLearnerMeaningMismatch({
      ...parsed.learner,
      teluguInternal: "నాకు ఇంకా కొంచెం పసిగా ఉంది.",
      roman: "naaku inkaa koncham pasigaa undi.",
      english: "I am still a little hungry.",
    }),
    true,
  );
  assert.equal(
    hasKnownLearnerMeaningMismatch({
      ...parsed.learner,
      teluguInternal: "నాకు ఇంకా ఆకలిగా ఉంది.",
      roman: "naaku inkaa aakaligaa undi.",
      english: "I am still hungry.",
    }),
    false,
  );
});

test("rejects provider mistakes in the high-confidence hunger follow-up", () => {
  const parsed = parseLivePresentedTurnToolCall(completePresentedTurnCall);
  assert.ok(parsed);

  assert.equal(
    hasKnownMayuMeaningMismatch({
      ...parsed.mayu,
      teluguInternal: "అవున్నా? మీరు ఏమీ తింటారా?",
      roman: "avunnaa? meeru emee tintaaraa?",
      english: "What would you like to eat?",
    }),
    true,
  );
  assert.equal(
    hasKnownMayuMeaningMismatch({
      ...parsed.mayu,
      teluguInternal: "అవునా? ఇంకా ఏమైనా తింటారా?",
      roman: "avunaa? inkaa emainaa tintaaraa?",
      english: "Would you like to eat anything else?",
    }),
    false,
  );
});

test("rejects the observed unnatural water handoff", () => {
  const parsed = parseLivePresentedTurnToolCall(completePresentedTurnCall);
  assert.ok(parsed);

  assert.equal(
    hasKnownMayuMeaningMismatch({
      ...parsed.mayu,
      teluguInternal: "దీనిగా, ఇగో నీళ్ళు.",
      roman: "deenigaa, igo neellu.",
      english: "Sure, here is the water.",
    }),
    true,
  );
});

test("keeps the hunger follow-up in the locked listener relationship", () => {
  const parsed = parseLivePresentedTurnToolCall(completePresentedTurnCall);
  assert.ok(parsed);
  const closeTurn = {
    ...parsed.mayu,
    teluguInternal: "అవునా? ఇంకా ఏమైనా తింటావా?",
    roman: "avunaa? inkaa emainaa tintaavaa?",
    english: "Would you like to eat anything else?",
  };
  const respectfulTurn = {
    ...parsed.mayu,
    teluguInternal: "అవునా? ఇంకా ఏమైనా తింటారా?",
    roman: "avunaa? inkaa emainaa tintaaraa?",
    english: "Would you like to eat anything else?",
  };

  assert.equal(hasKnownMayuRelationshipMismatch(closeTurn, "close"), false);
  assert.equal(
    hasKnownMayuRelationshipMismatch(closeTurn, "respectful"),
    true,
  );
  assert.equal(
    hasKnownMayuRelationshipMismatch(respectfulTurn, "respectful"),
    false,
  );
  assert.equal(hasKnownMayuRelationshipMismatch(respectfulTurn, "close"), true);
});
