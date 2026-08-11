import type { LiveSessionGrade } from "./live-session-grading.ts";

type LiveSessionCompletionEvidence = {
  learnerTurns: number;
  grade: Pick<
    LiveSessionGrade,
    "assessedTurns" | "unscoredTurns" | "strongestMetric" | "summary"
  >;
};

export type LiveSessionCompletionCopy = {
  headline: string;
  subcopy: string;
};

function totalEvidenceTurns({
  learnerTurns,
  grade,
}: LiveSessionCompletionEvidence) {
  if (grade.unscoredTurns !== undefined) {
    return grade.assessedTurns + grade.unscoredTurns;
  }

  return Math.max(learnerTurns, grade.assessedTurns);
}

export function describeLiveSessionCompletion(
  evidence: LiveSessionCompletionEvidence,
): LiveSessionCompletionCopy {
  const assessedTurns = evidence.grade.assessedTurns;
  const totalTurns = totalEvidenceTurns(evidence);

  if (totalTurns === 0) {
    return {
      headline: "This practice ended before your first reply.",
      subcopy: "No learner response was captured, so there was nothing to score.",
    };
  }

  if (assessedTurns === 0) {
    return {
      headline:
        totalTurns === 1
          ? "Your reply was captured."
          : `${totalTurns} replies were captured.`,
      subcopy:
        totalTurns === 1
          ? "It could not be scored reliably this time."
          : "They could not be scored reliably this time.",
    };
  }

  if (assessedTurns === totalTurns) {
    return {
      headline: evidence.grade.summary,
      subcopy:
        assessedTurns === 1
          ? "Your reply was scored in this conversation."
          : assessedTurns === 2
            ? "Both replies were scored in this conversation."
            : `All ${assessedTurns} replies were scored in this conversation.`,
    };
  }

  const strongestArea =
    evidence.grade.strongestMetric === "pronunciation"
      ? "Pronunciation"
      : evidence.grade.strongestMetric === "accuracy"
        ? "Accuracy"
        : null;
  const unscoredTurns = totalTurns - assessedTurns;

  return {
    headline:
      assessedTurns === 1
        ? "One reply had enough reliable evidence to score."
        : `${assessedTurns} replies had enough reliable evidence to score.`,
    subcopy: [
      strongestArea
        ? `${strongestArea} was strongest in ${
            assessedTurns === 1 ? "that reply" : "those replies"
          }.`
        : null,
      `${unscoredTurns} ${unscoredTurns === 1 ? "reply was" : "replies were"} left unscored.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}
