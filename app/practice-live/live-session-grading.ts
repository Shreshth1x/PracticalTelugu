import type { LiveTranscriptTurn } from "./live-transcript";

export type LiveScoreMetric = "pronunciation" | "accuracy" | "response";

export type LiveSessionGrade = {
  rubricVersion?: 2;
  averageResponseMs: number | null;
  assessedTurns: number;
  /** Completed learner turns that produced no usable language score. */
  unscoredTurns?: number;
  overallScore: number | null;
  pronunciationScore: number | null;
  accuracyScore: number | null;
  responseScore: number | null;
  strongestMetric: LiveScoreMetric | null;
  summary: string;
  nextStep: string;
};

type LiveTurnAssessment = {
  pronunciationScore: number | null;
  accuracyScore: number | null;
  languageScore?: number | null;
  feedback: string;
};

type GradableLiveTranscriptTurn = LiveTranscriptTurn & {
  responseLatencyMs?: number;
  assessment?: LiveTurnAssessment;
};

// Latencies past this are step-away pauses or measurement glitches, not a
// timing signal about the learner's recall.
const MAX_RESPONSE_LATENCY_MS = 30_000;

const EMPTY_NEXT_STEP =
  "Complete a learner response in Practice Live to get a focused next step.";

const UNSCORED_NEXT_STEP =
  "Your replies could not be scored reliably. Try a quieter spot and speak close to the microphone.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableScore(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 100)
  );
}

function isMetric(value: unknown): value is LiveScoreMetric {
  return (
    value === "pronunciation" || value === "accuracy" || value === "response"
  );
}

export function isLiveSessionGrade(value: unknown): value is LiveSessionGrade {
  if (!isRecord(value)) return false;

  const {
    averageResponseMs,
    assessedTurns,
    unscoredTurns,
    overallScore,
    pronunciationScore,
    accuracyScore,
    responseScore,
    strongestMetric,
    summary,
    nextStep,
    rubricVersion,
  } = value;

  if (
    !(
      averageResponseMs === null ||
      (typeof averageResponseMs === "number" &&
        Number.isInteger(averageResponseMs) &&
        averageResponseMs >= 0)
    ) ||
    typeof assessedTurns !== "number" ||
    !Number.isInteger(assessedTurns) ||
    assessedTurns < 0 ||
    !(
      unscoredTurns === undefined ||
      (typeof unscoredTurns === "number" &&
        Number.isInteger(unscoredTurns) &&
        unscoredTurns >= 0)
    ) ||
    !isNullableScore(overallScore) ||
    !isNullableScore(pronunciationScore) ||
    !isNullableScore(accuracyScore) ||
    !isNullableScore(responseScore) ||
    !(rubricVersion === undefined || rubricVersion === 2) ||
    !(strongestMetric === null || isMetric(strongestMetric)) ||
    typeof summary !== "string" ||
    summary.trim().length === 0 ||
    typeof nextStep !== "string" ||
    nextStep.trim().length === 0
  ) {
    return false;
  }

  if ((averageResponseMs === null) !== (responseScore === null)) return false;

  const hasCoreScore = pronunciationScore !== null || accuracyScore !== null;
  if ((overallScore === null) === hasCoreScore) return false;
  if ((strongestMetric === null) === hasCoreScore) return false;

  if (
    strongestMetric !== null &&
    value[`${strongestMetric}Score`] === null
  ) {
    return false;
  }
  if (rubricVersion === 2 && strongestMetric === "response") return false;

  return true;
}

/**
 * Scores how quickly the learner starts replying. The generous bands keep a
 * thoughtful beginner response from being treated as failure.
 */
export function scoreLiveResponseTime(milliseconds: number): number | null {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  if (milliseconds <= 2_500) return 100;
  if (milliseconds <= 4_000) return 92;
  if (milliseconds <= 6_000) return 82;
  if (milliseconds <= 9_000) return 70;
  if (milliseconds <= 13_000) return 55;
  if (milliseconds <= 18_000) return 40;
  return 25;
}

function normalizedScore(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2,
  );
}

function strongestMetricFor(
  scores: Record<LiveScoreMetric, number | null>,
): LiveScoreMetric | null {
  let strongest: LiveScoreMetric | null = null;

  // Response time is deliberately excluded: VAD, microphone, room, and
  // accessibility differences make it useful coaching context but too noisy
  // to call a language strength.
  for (const metric of ["pronunciation", "accuracy"] as const) {
    const score = scores[metric];
    if (score === null) continue;
    if (strongest === null || score > scores[strongest]!) strongest = metric;
  }

  return strongest;
}

function metricLabel(metric: LiveScoreMetric) {
  if (metric === "response") return "Response time";
  if (metric === "pronunciation") return "Pronunciation";
  return "Accuracy";
}

function sessionSummary(overallScore: number, strongest: LiveScoreMetric) {
  const strength = metricLabel(strongest);

  if (overallScore >= 90) {
    return `Excellent session. ${strength} was your strongest area.`;
  }
  if (overallScore >= 80) {
    return `Strong session. ${strength} was your strongest area.`;
  }
  if (overallScore >= 70) {
    return `Good progress. ${strength} was your strongest area.`;
  }
  if (overallScore >= 60) {
    return `You are building consistency. ${strength} was your strongest area.`;
  }
  return `This session gives you a clear starting point. ${strength} was your strongest area.`;
}

function assessmentStrength(assessment: LiveTurnAssessment) {
  const language = assessmentLanguageScore(assessment);
  if (language !== null) return language;

  return Number.POSITIVE_INFINITY;
}

function assessmentLanguageScore(assessment: LiveTurnAssessment) {
  const pronunciation = normalizedScore(
    assessment.pronunciationScore ?? Number.NaN,
  );
  const accuracy = normalizedScore(assessment.accuracyScore ?? Number.NaN);

  if (pronunciation === null && accuracy === null) return null;

  // A present-but-null languageScore is a deliberate abstention from the
  // calibration (for example a partial mixed reply whose Telugu-coverage cap
  // could not be applied). Falling back to a derived score there would let
  // the turn bypass that cap, so only a truly absent field is legacy data.
  if (assessment.languageScore !== undefined) {
    return normalizedScore(assessment.languageScore ?? Number.NaN);
  }

  // Legacy and hand-built assessments predate per-turn languageScore. Derive
  // the same balanced score so saved sessions and focused tests remain valid.
  if (pronunciation === null) return accuracy;
  if (accuracy === null) return pronunciation;
  return Math.round((pronunciation + accuracy) / 2);
}

export function gradeLiveSession(
  turns: readonly LiveTranscriptTurn[],
): LiveSessionGrade {
  const learnerTurns = (turns as readonly GradableLiveTranscriptTurn[]).filter(
    (turn) => turn.speaker === "you" && turn.final,
  );
  const assessments = learnerTurns.flatMap((turn) =>
    turn.assessment ? [turn.assessment] : [],
  );
  const assessed = assessments.filter(
    (assessment) => assessmentLanguageScore(assessment) !== null,
  );
  const languageScores = assessed.flatMap((assessment) => {
    const score = assessmentLanguageScore(assessment);
    return score === null ? [] : [score];
  });

  const pronunciationScores = assessed.flatMap((assessment) => {
    if (assessment.pronunciationScore === null) return [];
    const score = normalizedScore(assessment.pronunciationScore);
    return score === null ? [] : [score];
  });
  const accuracyScores = assessed.flatMap((assessment) => {
    const score = normalizedScore(assessment.accuracyScore ?? Number.NaN);
    return score === null ? [] : [score];
  });
  // Score each turn's latency on the band scale first, then combine, so one
  // step-away outlier cannot drag the whole session into a low band. The
  // median keeps the displayed time representative for the same reason.
  const timedTurns = learnerTurns.flatMap((turn) => {
    if (
      turn.responseLatencyMs === undefined ||
      turn.responseLatencyMs > MAX_RESPONSE_LATENCY_MS
    ) {
      return [];
    }
    const score = scoreLiveResponseTime(turn.responseLatencyMs);
    return score === null
      ? []
      : [{ milliseconds: turn.responseLatencyMs, score }];
  });

  const pronunciationScore = average(pronunciationScores);
  const accuracyScore = average(accuracyScores);
  const averageResponseMs = median(
    timedTurns.map((turn) => turn.milliseconds),
  );
  const responseScore = average(timedTurns.map((turn) => turn.score));
  const metricScores: Record<LiveScoreMetric, number | null> = {
    pronunciation: pronunciationScore,
    accuracy: accuracyScore,
    response: responseScore,
  };
  const overallScore = average(languageScores);
  const hasCoreScore = overallScore !== null;
  const strongestMetric = hasCoreScore
    ? strongestMetricFor(metricScores)
    : null;

  // Per-turn feedback lines are mid-conversation coaching ("try that reply
  // once more"), so they only make sense as a next step when at least one
  // turn was actually scored.
  let nextStep = EMPTY_NEXT_STEP;
  if (assessed.length > 0) {
    const weakest = assessed.reduce((currentWeakest, assessment) =>
      assessmentStrength(assessment) < assessmentStrength(currentWeakest)
        ? assessment
        : currentWeakest,
    );
    const feedback = weakest.feedback.trim();
    if (feedback) nextStep = feedback;
  } else if (assessments.length > 0) {
    nextStep = UNSCORED_NEXT_STEP;
  }

  return {
    rubricVersion: 2,
    averageResponseMs,
    assessedTurns: assessed.length,
    unscoredTurns: learnerTurns.length - assessed.length,
    overallScore,
    pronunciationScore,
    accuracyScore,
    responseScore,
    strongestMetric,
    summary:
      overallScore === null || strongestMetric === null
        ? "No learner responses were assessed in this session."
        : sessionSummary(overallScore, strongestMetric),
    nextStep,
  };
}
