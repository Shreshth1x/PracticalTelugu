// Hardware echo cancellation carries the real echo burden in full-duplex
// mode; this short tail only debounces the reply window and mic level meter
// right after Mayu's last sample.
export const LIVE_OUTPUT_ECHO_TAIL_MS = 120;

type LiveOutputCaptureGuardDependencies = {
  scheduleTimeout: (callback: () => void, delayMs: number) => unknown;
  cancelTimeout: (handle: unknown) => void;
};

export type LiveOutputCaptureGuard = {
  beginOutput: () => void;
  releaseAfterTail: (onReady?: () => void) => void;
  discardReleaseCallback: () => void;
  cancel: () => void;
  isInputBlocked: () => boolean;
};

/**
 * Microphone frames stream full-duplex: they keep flowing while Mayu speaks so
 * Gemini's server VAD can hear the learner interrupt. Only mute and session
 * identity gate the upload; the output guard governs the local meter and the
 * reply-window timing, never the stream itself.
 */
export function shouldForwardLiveMicrophoneFrame({
  isMuted,
  sessionMatches,
}: {
  isMuted: boolean;
  sessionMatches: boolean;
}) {
  return !isMuted && sessionMatches;
}

/**
 * Debounces the moment output stops before reopening learner bookkeeping.
 * Playback no longer mutes the microphone; this guard only sequences the
 * reply window and quiets the mic level meter while Mayu is audible.
 */
export function createLiveOutputCaptureGuard(
  dependencies: LiveOutputCaptureGuardDependencies,
  echoTailMs = LIVE_OUTPUT_ECHO_TAIL_MS,
): LiveOutputCaptureGuard {
  let inputBlocked = false;
  let releaseHandle: unknown | null = null;
  let releaseCallback: (() => void) | null = null;

  const clearRelease = () => {
    if (releaseHandle !== null) dependencies.cancelTimeout(releaseHandle);
    releaseHandle = null;
    releaseCallback = null;
  };

  return {
    beginOutput() {
      clearRelease();
      inputBlocked = true;
    },

    releaseAfterTail(onReady) {
      if (!inputBlocked) {
        onReady?.();
        return;
      }

      if (onReady) releaseCallback = onReady;
      if (releaseHandle !== null) return;

      releaseHandle = dependencies.scheduleTimeout(() => {
        releaseHandle = null;
        inputBlocked = false;
        const callback = releaseCallback;
        releaseCallback = null;
        callback?.();
      }, echoTailMs);
    },

    discardReleaseCallback() {
      releaseCallback = null;
    },

    cancel() {
      clearRelease();
      inputBlocked = false;
    },

    isInputBlocked() {
      return inputBlocked;
    },
  };
}
