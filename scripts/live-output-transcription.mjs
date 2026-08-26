export function createOutputTranscriptionState() {
  return { text: "", finished: false };
}

export function applyOutputTranscriptionUpdate(state, update) {
  const text =
    typeof update?.text === "string" ? update.text.trim() : "";

  return {
    text: text ? `${state.text} ${text}`.trim() : state.text,
    finished: state.finished || update?.finished === true,
  };
}

export function isOutputTranscriptionReady(
  state,
  { responseComplete, settleElapsed },
) {
  return Boolean(
    state.text && responseComplete && (state.finished || settleElapsed),
  );
}
