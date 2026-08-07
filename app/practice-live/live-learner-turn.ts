/**
 * Gemini documents input transcription as independent from model/tool output.
 * Keep learner bookkeeping in a VAD-scoped epoch so whichever signal arrives
 * first can settle the same turn without creating a second transcript row.
 */

export type LearnerTurnEpoch = {
  id: number;
  activityActive: boolean;
  observedLearnerInput: boolean;
  captioned: boolean;
  counted: boolean;
  pendingCaption: boolean;
  finalText: string | null;
  modelOutputSeen: boolean;
  modelTurnComplete: boolean;
  modelBoundaryAfterCaption: boolean;
  latencyClockStarted: boolean;
};

export type LearnerTurnState = {
  nextEpochId: number;
  currentEpoch: LearnerTurnEpoch | null;
  expectsLearnerResponse: boolean;
  controlTurnPending: boolean;
};

export type LearnerTurnEvent =
  | { type: "activity-start" }
  | { type: "activity-end" }
  | { type: "interim-transcription" }
  | { type: "final-transcription"; text: string }
  | { type: "learner-caption" }
  | { type: "model-output" }
  | { type: "model-turn-complete" }
  | { type: "mayu-turn-presented"; expectsReply: boolean }
  | { type: "control-turn-requested" };

export type LearnerTurnEffects = {
  beginPendingCaption: boolean;
  applyLearnerCaption: boolean;
  countLearnerTurn: boolean;
  startLatencyClock: boolean;
};

export type LearnerTurnTransition = {
  state: LearnerTurnState;
  effects: LearnerTurnEffects;
};

const NO_EFFECTS: LearnerTurnEffects = {
  beginPendingCaption: false,
  applyLearnerCaption: false,
  countLearnerTurn: false,
  startLatencyClock: false,
};

export function createLearnerTurnState(): LearnerTurnState {
  return {
    nextEpochId: 1,
    currentEpoch: null,
    expectsLearnerResponse: false,
    controlTurnPending: false,
  };
}

export function learnerActivityEventFromSignal(
  voiceActivityType: string | undefined,
  vadSignalType: string | undefined,
): Extract<LearnerTurnEvent, { type: "activity-start" | "activity-end" }> | null {
  if (
    voiceActivityType === "ACTIVITY_START" ||
    vadSignalType === "VAD_SIGNAL_TYPE_SOS"
  ) {
    return { type: "activity-start" };
  }
  if (
    voiceActivityType === "ACTIVITY_END" ||
    vadSignalType === "VAD_SIGNAL_TYPE_EOS"
  ) {
    return { type: "activity-end" };
  }
  return null;
}

function createEpoch(state: LearnerTurnState) {
  const epoch: LearnerTurnEpoch = {
    id: state.nextEpochId,
    activityActive: false,
    observedLearnerInput: false,
    captioned: false,
    counted: false,
    pendingCaption: false,
    finalText: null,
    modelOutputSeen: false,
    modelTurnComplete: false,
    modelBoundaryAfterCaption: false,
    latencyClockStarted: false,
  };

  return {
    state: {
      ...state,
      nextEpochId: state.nextEpochId + 1,
      currentEpoch: epoch,
    },
    epoch,
  };
}

function setEpoch(
  state: LearnerTurnState,
  epoch: LearnerTurnEpoch,
): LearnerTurnState {
  return { ...state, currentEpoch: epoch };
}

function beginObservedEpoch(
  state: LearnerTurnState,
  epoch: LearnerTurnEpoch,
) {
  const shouldBeginPending = !epoch.captioned && !epoch.pendingCaption;
  const nextEpoch = {
    ...epoch,
    observedLearnerInput: true,
    pendingCaption: epoch.captioned ? false : true,
  };

  return {
    state: setEpoch(state, nextEpoch),
    epoch: nextEpoch,
    shouldBeginPending,
  };
}

function shouldStartDefiniteActivityEpoch(epoch: LearnerTurnEpoch | null) {
  if (!epoch) return true;
  if (epoch.activityActive) return false;

  // A new VAD start is a definitive boundary once the previous captioned
  // response has reached model output. Duplicate SDK SOS/start signals before
  // that point remain attached to the same epoch.
  return (
    epoch.captioned && (epoch.modelOutputSeen || epoch.modelTurnComplete)
  );
}

function shouldStartTranscriptionFallbackEpoch(
  epoch: LearnerTurnEpoch | null,
) {
  if (!epoch) return true;

  // Do not let an interim transcription that arrives after an early learner
  // tool call reopen the settled epoch. Once its final transcription arrives,
  // a later model-complete interim can safely begin the next fallback epoch.
  return (
    epoch.captioned &&
    epoch.finalText !== null &&
    epoch.modelTurnComplete
  );
}

function markCounted(
  epoch: LearnerTurnEpoch,
  effects: LearnerTurnEffects,
) {
  if (epoch.counted) return { epoch, effects };

  return {
    epoch: { ...epoch, counted: true },
    effects: { ...effects, countLearnerTurn: true },
  };
}

function startLatencyClock(
  epoch: LearnerTurnEpoch,
  effects: LearnerTurnEffects,
) {
  if (epoch.latencyClockStarted || epoch.modelOutputSeen) {
    return { epoch, effects };
  }

  return {
    epoch: { ...epoch, latencyClockStarted: true },
    effects: { ...effects, startLatencyClock: true },
  };
}

export function learnerCaptionRequired(
  state: LearnerTurnState,
  replay = false,
) {
  if (replay) return false;

  const observedUncaptioned = Boolean(
    state.currentEpoch?.observedLearnerInput &&
      !state.currentEpoch.captioned,
  );

  return (
    observedUncaptioned ||
    (state.expectsLearnerResponse && !state.controlTurnPending)
  );
}

export function advanceLearnerTurn(
  previous: LearnerTurnState,
  event: LearnerTurnEvent,
): LearnerTurnTransition {
  let state = previous;
  const effects = { ...NO_EFFECTS };

  if (event.type === "control-turn-requested") {
    return {
      state: { ...state, controlTurnPending: true },
      effects,
    };
  }

  if (event.type === "mayu-turn-presented") {
    return {
      state: {
        ...state,
        expectsLearnerResponse: event.expectsReply,
        controlTurnPending: false,
      },
      effects,
    };
  }

  if (event.type === "activity-start") {
    let epoch = state.currentEpoch;
    if (shouldStartDefiniteActivityEpoch(epoch)) {
      const created = createEpoch(state);
      state = created.state;
      epoch = created.epoch;
    }

    if (!epoch) return { state, effects };
    const observed = beginObservedEpoch(state, {
      ...epoch,
      activityActive: true,
    });
    state = observed.state;
    effects.beginPendingCaption = observed.shouldBeginPending;
    return { state, effects };
  }

  if (event.type === "activity-end") {
    let epoch = state.currentEpoch;
    if (!epoch) {
      const created = createEpoch(state);
      state = created.state;
      epoch = created.epoch;
    }

    const observed = beginObservedEpoch(state, {
      ...epoch,
      activityActive: false,
    });
    state = observed.state;
    effects.beginPendingCaption = observed.shouldBeginPending;
    const latency = startLatencyClock(observed.epoch, effects);
    return { state: setEpoch(state, latency.epoch), effects: latency.effects };
  }

  if (event.type === "interim-transcription") {
    let epoch = state.currentEpoch;
    if (shouldStartTranscriptionFallbackEpoch(epoch)) {
      const created = createEpoch(state);
      state = created.state;
      epoch = created.epoch;
    }

    if (!epoch || epoch.captioned) return { state, effects };
    const observed = beginObservedEpoch(state, {
      ...epoch,
      activityActive: true,
    });
    effects.beginPendingCaption = observed.shouldBeginPending;
    return { state: observed.state, effects };
  }

  if (event.type === "final-transcription") {
    const text = event.text.trim();
    if (!text) return { state, effects };

    let epoch = state.currentEpoch;
    if (
      !epoch ||
      (epoch.finalText !== null &&
        epoch.finalText !== text &&
        shouldStartTranscriptionFallbackEpoch(epoch))
    ) {
      const created = createEpoch(state);
      state = created.state;
      epoch = created.epoch;
    }

    if (epoch.finalText === text) return { state, effects };

    const observed = beginObservedEpoch(state, {
      ...epoch,
      activityActive: false,
      finalText: text,
    });
    state = observed.state;
    effects.beginPendingCaption = observed.shouldBeginPending;

    let settled = markCounted(observed.epoch, effects);
    settled = startLatencyClock(settled.epoch, settled.effects);
    return {
      state: setEpoch(state, settled.epoch),
      effects: settled.effects,
    };
  }

  if (event.type === "learner-caption") {
    let epoch = state.currentEpoch;
    if (
      epoch?.captioned &&
      !epoch.modelBoundaryAfterCaption
    ) {
      // A repeated/retried tool call for the same model exchange must not add
      // another learner row or score. A genuine next reply can only follow
      // model output (or its turn-complete boundary).
      return { state, effects };
    }

    // The next blocking tool can arrive even when the provider omitted learner
    // VAD and transcription. Model output is still the exchange boundary, so
    // start a fresh slot once the prior response has crossed that boundary.
    if (!epoch || epoch.captioned) {
      const created = createEpoch(state);
      state = created.state;
      epoch = created.epoch;
    }

    if (epoch.captioned) return { state, effects };

    epoch = {
      ...epoch,
      observedLearnerInput: true,
      captioned: true,
      pendingCaption: false,
      // Model audio can race ahead of the blocking caption tool. Only a model
      // boundary observed after this accepted caption may open the next
      // tool-only exchange; historical output remains available to latency
      // bookkeeping but cannot make an immediate retry look new.
      modelBoundaryAfterCaption: false,
    };
    effects.applyLearnerCaption = true;
    state = {
      ...setEpoch(state, epoch),
      expectsLearnerResponse: false,
    };

    let settled = markCounted(epoch, effects);
    settled = startLatencyClock(settled.epoch, settled.effects);
    return {
      state: setEpoch(state, settled.epoch),
      effects: settled.effects,
    };
  }

  if (event.type === "model-output") {
    const epoch = state.currentEpoch;
    if (!epoch?.observedLearnerInput) return { state, effects };

    const counted = markCounted(
      {
        ...epoch,
        activityActive: false,
        modelOutputSeen: true,
        modelBoundaryAfterCaption:
          epoch.modelBoundaryAfterCaption || epoch.captioned,
      },
      effects,
    );
    return {
      state: setEpoch(state, counted.epoch),
      effects: counted.effects,
    };
  }

  const epoch = state.currentEpoch;
  if (!epoch) return { state, effects };
  return {
    state: setEpoch(state, {
      ...epoch,
      activityActive: false,
      modelTurnComplete: true,
      modelBoundaryAfterCaption:
        epoch.modelBoundaryAfterCaption || epoch.captioned,
    }),
    effects,
  };
}
