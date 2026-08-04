import type { CompletedLiveSession } from "./useGeminiLive";

export function isComparableLiveSession(
  current: CompletedLiveSession,
  candidate: CompletedLiveSession,
) {
  return (
    candidate.id !== current.id &&
    candidate.scenarioId === current.scenarioId &&
    candidate.familyVoice === current.familyVoice &&
    (candidate.voiceMode ?? "gemini") ===
      (current.voiceMode ?? "gemini") &&
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
  if (currentScore === null || previousScore === null) {
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
