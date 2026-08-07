export const LIVE_ASSESSMENT_SAMPLE_RATE = 16_000;

const MAX_CAPTURE_SECONDS = 20;
const ACTIVITY_PRE_ROLL_MS = 750;
const MIN_CAPTURE_MS = 180;
const MAX_CAPTURE_SAMPLES =
  LIVE_ASSESSMENT_SAMPLE_RATE * MAX_CAPTURE_SECONDS;
const ACTIVITY_PRE_ROLL_SAMPLES = Math.round(
  (LIVE_ASSESSMENT_SAMPLE_RATE * ACTIVITY_PRE_ROLL_MS) / 1_000,
);
const MIN_CAPTURE_SAMPLES = Math.round(
  (LIVE_ASSESSMENT_SAMPLE_RATE * MIN_CAPTURE_MS) / 1_000,
);

export type LiveAssessmentAudioCapture = {
  chunks: Int16Array[];
  sampleCount: number;
  activityStartSample: number | null;
  activityEndSample: number | null;
};

export function createLiveAssessmentAudioCapture(): LiveAssessmentAudioCapture {
  return {
    chunks: [],
    sampleCount: 0,
    activityStartSample: null,
    activityEndSample: null,
  };
}

export function resetLiveAssessmentAudioCapture(
  capture: LiveAssessmentAudioCapture,
) {
  capture.chunks = [];
  capture.sampleCount = 0;
  capture.activityStartSample = null;
  capture.activityEndSample = null;
}

export function appendLiveAssessmentAudio(
  capture: LiveAssessmentAudioCapture,
  pcm: Int16Array,
) {
  if (!pcm.length) return;

  capture.chunks.push(pcm.slice());
  capture.sampleCount += pcm.length;

  while (
    capture.sampleCount > MAX_CAPTURE_SAMPLES &&
    capture.chunks.length > 1
  ) {
    const removed = capture.chunks.shift();
    if (!removed) break;
    capture.sampleCount -= removed.length;
    if (capture.activityStartSample !== null) {
      capture.activityStartSample = Math.max(
        0,
        capture.activityStartSample - removed.length,
      );
    }
    if (capture.activityEndSample !== null) {
      capture.activityEndSample = Math.max(
        0,
        capture.activityEndSample - removed.length,
      );
    }
  }
}

export function markLiveAssessmentActivityStart(
  capture: LiveAssessmentAudioCapture,
) {
  capture.activityStartSample = Math.max(
    0,
    capture.sampleCount - ACTIVITY_PRE_ROLL_SAMPLES,
  );
  capture.activityEndSample = null;
}

export function markLiveAssessmentActivityEnd(
  capture: LiveAssessmentAudioCapture,
) {
  capture.activityEndSample = capture.sampleCount;
}

/**
 * Returns one bounded learner clip and atomically clears the capture for the
 * next conversational turn. Server VAD marks trim long silence when available;
 * the full bounded window remains a safe fallback when the provider omits VAD.
 */
export function takeLiveAssessmentAudio(
  capture: LiveAssessmentAudioCapture,
) {
  const chunks = capture.chunks;
  const sampleCount = capture.sampleCount;
  const start = Math.min(
    sampleCount,
    Math.max(0, capture.activityStartSample ?? 0),
  );
  const end = Math.min(
    sampleCount,
    Math.max(start, capture.activityEndSample ?? sampleCount),
  );

  const combined = new Int16Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  resetLiveAssessmentAudioCapture(capture);

  if (end - start < MIN_CAPTURE_SAMPLES) return null;
  return combined.slice(start, end);
}
