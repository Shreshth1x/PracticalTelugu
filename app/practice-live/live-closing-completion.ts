export type LiveClosingPlaybackState = {
  closingPlaybackPending: boolean;
  activeAudioSourceCount: number;
  mayuTurnComplete: boolean;
  hasPendingPresentation: boolean;
};

export function canSendClosingControlNow({
  phase,
  hasLearnerReplyInFlight,
}: {
  phase: string;
  hasLearnerReplyInFlight: boolean;
}) {
  return (
    (phase === "listening" || phase === "muted") &&
    !hasLearnerReplyInFlight
  );
}

/**
 * A closing turn can finish the session only after Gemini has completed the
 * turn and every accepted presentation and audible sample has drained.
 * Ordinary model-turn boundaries must never finish the session by themselves.
 */
export function shouldCompleteClosingPlayback({
  closingPlaybackPending,
  activeAudioSourceCount,
  mayuTurnComplete,
  hasPendingPresentation,
}: LiveClosingPlaybackState) {
  return (
    closingPlaybackPending &&
    activeAudioSourceCount === 0 &&
    mayuTurnComplete &&
    !hasPendingPresentation
  );
}
