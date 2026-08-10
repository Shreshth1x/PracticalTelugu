// Half-duplex keeps uploads closed during output; this short tail also covers
// the last bit of speaker energy right after Mayu's final sample.
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
 * Hardware capture remains alive after Mayu opens a reply window. The caller
 * still applies the production half-duplex output gate before uploading PCM.
 * Before the first Mayu turn, withholding uploads prevents startup noise from
 * becoming a contextless learner turn.
 */
export function shouldForwardLiveMicrophoneFrame({
  expectsLearnerResponse,
  isMuted,
  sessionMatches,
}: {
  expectsLearnerResponse: boolean;
  isMuted: boolean;
  sessionMatches: boolean;
}) {
  return expectsLearnerResponse && !isMuted && sessionMatches;
}

/**
 * Holds learner input closed through playback and a short acoustic tail before
 * reopening learner bookkeeping. The MediaStream itself stays alive.
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
