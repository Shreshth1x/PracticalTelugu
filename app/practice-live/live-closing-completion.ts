export type LiveClosingPlaybackState = {
  closingPlaybackPending: boolean;
  activeAudioSourceCount: number;
  mayuTurnComplete: boolean;
  hasPendingPresentation: boolean;
};

export type LiveServerTurnState = {
  generationComplete?: boolean;
  turnComplete?: boolean;
  waitingForInput?: boolean;
};

/**
 * Gemini's generationComplete marker is earlier than its realtime-playback
 * turn boundary. It is sufficient for server-side smoke validation, but the
 * browser still waits for the later boundary or its bounded local fallback.
 */
export function isLiveServerGenerationFinished({
  generationComplete,
  turnComplete,
  waitingForInput,
}: LiveServerTurnState) {
  return (
    generationComplete === true ||
    turnComplete === true ||
    waitingForInput === true
  );
}

export function isLiveServerTurnComplete({
  turnComplete,
  waitingForInput,
}: LiveServerTurnState) {
  return turnComplete === true || waitingForInput === true;
}

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
