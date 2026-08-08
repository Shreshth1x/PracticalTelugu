import type { CompletedLiveSession } from "./useGeminiLive";

export function isComparableLiveSession(
  current: CompletedLiveSession,
  candidate: CompletedLiveSession,
) {
  return (
    candidate.id !== current.id &&
    candidate.scenarioId === current.scenarioId &&
    candidate.relationship === current.relationship &&
    candidate.sessionLimitSeconds === current.sessionLimitSeconds &&
    candidate.grade?.rubricVersion === current.grade?.rubricVersion &&
    candidate.grade?.overallScore !== null &&
    candidate.grade?.overallScore !== undefined
  );
}

export function describeLiveScoreProgress(
  currentScore: number | null,
  previousScore: number | null,
) {
  if (currentScore === null) {
    // An unscored session must not claim a new baseline was saved — the
    // previous score (when there is one) remains the comparison point.
    return previousScore === null
      ? "Once a session earns a score, later practices with this setup will compare here."
      : "This session was not scored, so your earlier score stays the baseline.";
  }
  if (previousScore === null) {
    return "Baseline saved. Your next practice with this same setup will compare here.";
  }

  const scoreDelta = currentScore - previousScore;
  if (Math.abs(scoreDelta) < 5) {
    return "In the same range as your last matching practice.";
  }
  if (scoreDelta > 0) {
    return `Up ${scoreDelta} points from your last matching practice.`;
  }

  return `Today: ${currentScore}. Last matching practice: ${previousScore}.`;
}
