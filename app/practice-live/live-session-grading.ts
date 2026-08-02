import type { LiveTranscriptTurn } from "./live-transcript";

export type LiveScoreMetric = "pronunciation" | "accuracy" | "response";

export type LiveSessionGrade = {
  averageResponseMs: number | null;
  assessedTurns: number;
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
  accuracyScore: number;
  feedback: string;
};

type GradableLiveTranscriptTurn = LiveTranscriptTurn & {
  responseLatencyMs?: number;
  assessment?: LiveTurnAssessment;
};

const METRIC_WEIGHTS: Record<LiveScoreMetric, number> = {
  pronunciation: 0.4,
  accuracy: 0.4,
  response: 0.2,
};

const EMPTY_NEXT_STEP =
  "Complete a learner response in Practice Live to get a focused next step.";

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
    overallScore,
    pronunciationScore,
    accuracyScore,
    responseScore,
    strongestMetric,
    summary,
    nextStep,
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
    !isNullableScore(overallScore) ||
    !isNullableScore(pronunciationScore) ||
    !isNullableScore(accuracyScore) ||
    !isNullableScore(responseScore) ||
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

function strongestMetricFor(
  scores: Record<LiveScoreMetric, number | null>,
): LiveScoreMetric | null {
  let strongest: LiveScoreMetric | null = null;

  for (const metric of [
    "pronunciation",
    "accuracy",
    "response",
  ] as const) {
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
  const pronunciation = normalizedScore(assessment.pronunciationScore ?? Number.NaN);
  const accuracy = normalizedScore(assessment.accuracyScore);

  if (pronunciation === null) return accuracy ?? Number.POSITIVE_INFINITY;
  if (accuracy === null) return pronunciation;
  return (pronunciation + accuracy) / 2;
}

export function gradeLiveSession(
  turns: readonly LiveTranscriptTurn[],
): LiveSessionGrade {
  const learnerTurns = (turns as readonly GradableLiveTranscriptTurn[]).filter(
    (turn) => turn.speaker === "you" && turn.final,
  );
  const assessed = learnerTurns.flatMap((turn) => {
    const assessment = turn.assessment;
    if (!assessment || normalizedScore(assessment.accuracyScore) === null) {
      return [];
    }
    return [assessment];
  });

  const pronunciationScores = assessed.flatMap((assessment) => {
    if (assessment.pronunciationScore === null) return [];
    const score = normalizedScore(assessment.pronunciationScore);
    return score === null ? [] : [score];
  });
  const accuracyScores = assessed.flatMap((assessment) => {
    const score = normalizedScore(assessment.accuracyScore);
    return score === null ? [] : [score];
  });
  const responseTimes = learnerTurns.flatMap((turn) => {
    if (turn.responseLatencyMs === undefined) return [];
    return scoreLiveResponseTime(turn.responseLatencyMs) === null
      ? []
      : [turn.responseLatencyMs];
  });

  const pronunciationScore = average(pronunciationScores);
  const accuracyScore = average(accuracyScores);
  const averageResponseMs = average(responseTimes);
  const responseScore =
    averageResponseMs === null ? null : scoreLiveResponseTime(averageResponseMs);
  const metricScores: Record<LiveScoreMetric, number | null> = {
    pronunciation: pronunciationScore,
    accuracy: accuracyScore,
    response: responseScore,
  };
  const hasCoreScore = pronunciationScore !== null || accuracyScore !== null;
  const strongestMetric = hasCoreScore
    ? strongestMetricFor(metricScores)
    : null;

  let overallScore: number | null = null;
  if (hasCoreScore) {
    let weightedTotal = 0;
    let availableWeight = 0;

    for (const metric of [
      "pronunciation",
      "accuracy",
      "response",
    ] as const) {
      const score = metricScores[metric];
      if (score === null) continue;
      weightedTotal += score * METRIC_WEIGHTS[metric];
      availableWeight += METRIC_WEIGHTS[metric];
    }

    overallScore = Math.round(weightedTotal / availableWeight);
  }

  let nextStep = EMPTY_NEXT_STEP;
  if (assessed.length > 0) {
    const weakest = assessed.reduce((currentWeakest, assessment) =>
      assessmentStrength(assessment) < assessmentStrength(currentWeakest)
        ? assessment
        : currentWeakest,
    );
    const feedback = weakest.feedback.trim();
    if (feedback) nextStep = feedback;
  }

  return {
    averageResponseMs,
    assessedTurns: assessed.length,
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
