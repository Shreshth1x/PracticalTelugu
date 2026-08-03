export const FISH_SPEECH_CLIENT_TIMEOUT_MS = 9_000;

type TimerHandle = unknown;

export type FishSpeechControllerDependencies = {
  scheduleTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  cancelTimeout: (handle: TimerHandle) => void;
  createAbortController: () => AbortController;
};

export type FishSpeechTurn<TFishAudio, TFallbackAudio> = {
  request: (signal: AbortSignal) => Promise<TFishAudio>;
  playFish: (audio: TFishAudio) => void;
  playFallback: (audio: TFallbackAudio) => void;
  onFallback: () => void;
  onFallbackReleased: () => void;
};

export type FishSpeechController<TFishAudio, TFallbackAudio> = {
  start: (turn: FishSpeechTurn<TFishAudio, TFallbackAudio>) => void;
  bufferFallback: (audio: TFallbackAudio) => boolean;
  isPending: () => boolean;
  cancel: () => void;
  reset: () => void;
};

type ActiveFishSpeech<TFishAudio, TFallbackAudio> = {
  controller: AbortController;
  timeoutHandle: TimerHandle | null;
  status: "pending" | "fish" | "fallback";
  fallbackAudio: TFallbackAudio[];
  turn: FishSpeechTurn<TFishAudio, TFallbackAudio>;
};

/**
 * Owns the state for one Fish speech request at a time. Browser APIs and audio
 * effects are supplied by the caller so the request/fallback race is fully
 * deterministic and executable in Node tests.
 */
export function createFishSpeechController<TFishAudio, TFallbackAudio>(
  dependencies: FishSpeechControllerDependencies,
  timeoutMs = FISH_SPEECH_CLIENT_TIMEOUT_MS,
): FishSpeechController<TFishAudio, TFallbackAudio> {
  let active: ActiveFishSpeech<TFishAudio, TFallbackAudio> | null = null;

  const clearActiveTimer = (
    speech: ActiveFishSpeech<TFishAudio, TFallbackAudio>,
  ) => {
    if (speech.timeoutHandle === null) return;
    dependencies.cancelTimeout(speech.timeoutHandle);
    speech.timeoutHandle = null;
  };

  const cancel = () => {
    const speech = active;
    if (!speech) return;

    active = null;
    clearActiveTimer(speech);
    speech.controller.abort();
    speech.fallbackAudio = [];
  };

  const releaseFallback = (
    speech: ActiveFishSpeech<TFishAudio, TFallbackAudio>,
  ) => {
    if (active !== speech || speech.status !== "pending") return;

    clearActiveTimer(speech);
    speech.status = "fallback";
    const fallbackAudio = speech.fallbackAudio;
    speech.fallbackAudio = [];
    speech.controller.abort();
    speech.turn.onFallback();

    try {
      for (const audio of fallbackAudio) speech.turn.playFallback(audio);
    } finally {
      // This must run after every fallback chunk has been handed to playback.
      // The live hook uses that ordering before reopening the learner's reply.
      speech.turn.onFallbackReleased();
    }
  };

  const start = (turn: FishSpeechTurn<TFishAudio, TFallbackAudio>) => {
    cancel();

    const speech: ActiveFishSpeech<TFishAudio, TFallbackAudio> = {
      controller: dependencies.createAbortController(),
      timeoutHandle: null,
      status: "pending",
      fallbackAudio: [],
      turn,
    };
    active = speech;
    speech.timeoutHandle = dependencies.scheduleTimeout(
      () => releaseFallback(speech),
      timeoutMs,
    );

    let request: Promise<TFishAudio>;
    try {
      request = turn.request(speech.controller.signal);
    } catch {
      releaseFallback(speech);
      return;
    }

    void request.then(
      (audio) => {
        if (
          active !== speech ||
          speech.status !== "pending" ||
          speech.controller.signal.aborted
        ) {
          return;
        }

        clearActiveTimer(speech);
        speech.status = "fish";
        speech.fallbackAudio = [];
        speech.turn.playFish(audio);
      },
      () => releaseFallback(speech),
    );
  };

  return {
    start,
    bufferFallback(audio) {
      if (!active || active.status === "fallback") return false;
      if (active.status === "pending") active.fallbackAudio.push(audio);
      return true;
    },
    isPending() {
      return active?.status === "pending";
    },
    cancel,
    reset: cancel,
  };
}
