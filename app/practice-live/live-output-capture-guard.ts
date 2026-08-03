export const LIVE_OUTPUT_ECHO_TAIL_MS = 400;

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

export function shouldForwardLiveMicrophoneFrame({
  isMuted,
  sessionMatches,
  outputBlocked,
}: {
  isMuted: boolean;
  sessionMatches: boolean;
  outputBlocked: boolean;
}) {
  return !isMuted && sessionMatches && !outputBlocked;
}

/**
 * Keeps speaker output out of the microphone stream without stopping the
 * MediaStream. The short tail covers room/device echo after the last sample.
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
