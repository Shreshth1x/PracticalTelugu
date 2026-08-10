export type LiveConnectBoundary<T> = {
  failure: Promise<never>;
  push: (message: T) => void;
  install: (dispatch: (message: T) => void) => boolean;
  consumeConnectFailure: (error: Error) => boolean;
  didFail: () => boolean;
};

/**
 * The Live SDK can deliver queued messages before `connect()` returns its
 * Session, and it does not reject that promise when the setup socket closes.
 * This boundary holds messages until the caller installs the Session and turns
 * setup-time socket failures into a promise the caller can race with connect.
 */
export function createLiveConnectBoundary<T>(): LiveConnectBoundary<T> {
  let state: "connecting" | "installed" | "failed" = "connecting";
  let dispatch: ((message: T) => void) | null = null;
  let queued: T[] = [];
  let rejectFailure: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });

  return {
    failure,

    push(message) {
      if (state === "failed") return;
      if (state === "installed") {
        dispatch?.(message);
        return;
      }
      queued.push(message);
    },

    install(nextDispatch) {
      if (state !== "connecting") return false;

      state = "installed";
      dispatch = nextDispatch;
      const pending = queued;
      queued = [];
      for (const message of pending) nextDispatch(message);
      return true;
    },

    consumeConnectFailure(error) {
      if (state === "installed") return false;
      if (state === "failed") return true;

      state = "failed";
      queued = [];
      rejectFailure(error);
      return true;
    },

    didFail() {
      return state === "failed";
    },
  };
}

export function nextLiveResumptionHandle(update: {
  resumable?: boolean;
  newHandle?: string;
}) {
  return update.resumable === true && update.newHandle
    ? update.newHandle
    : null;
}
