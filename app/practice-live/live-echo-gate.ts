// Full-duplex playback relies on browser echo cancellation, but AEC residue
// still reaches the microphone on speaker playback. Without a gate, Gemini's
// server VAD hears Mayu's own voice as learner speech and the model answers
// its echo in a loop. This gate drops quiet echo-level frames while output is
// audible and lets genuinely louder learner speech through, so barge-in keeps
// working while self-talk cannot.

export const ECHO_GATE_HOLD_MS = 250;
// Frame levels arrive from the capture path's 4.2x-scaled RMS, clamped to 1.
// Speech at a normal distance lands around 0.2-0.85; AEC residue sits well
// below 0.1.
export const ECHO_GATE_MIN_SPEECH_LEVEL = 0.18;
export const ECHO_GATE_ECHO_MULTIPLIER = 2.25;
export const ECHO_GATE_FLOOR_SEED = 0.04;
export const ECHO_GATE_FLOOR_ALPHA = 0.08;
export const ECHO_GATE_FLOOR_MAX = 0.11;
export const ECHO_GATE_SPEECH_CONFIRM_FRAMES = 2;

export type LiveEchoGateFrame = {
  level: number;
  outputAudible: boolean;
  timestampMs: number;
};

export type LiveEchoGateDecision = {
  forward: boolean;
  reason: "idle" | "speech" | "hold" | "echo";
};

export type LiveEchoGate = {
  decide: (frame: LiveEchoGateFrame) => LiveEchoGateDecision;
  reset: () => void;
};

export function createLiveEchoGate(): LiveEchoGate {
  let echoFloor = ECHO_GATE_FLOOR_SEED;
  let openUntilMs = 0;
  let aboveThresholdFrames = 0;

  return {
    decide({ level, outputAudible, timestampMs }) {
      if (!outputAudible) {
        // Each Mayu turn starts from the conservative seed. A noisy prior
        // output must not leave the next turn with a near-closed barge-in gate.
        echoFloor = ECHO_GATE_FLOOR_SEED;
        openUntilMs = 0;
        aboveThresholdFrames = 0;
        return { forward: true, reason: "idle" };
      }

      const clamped = Math.min(1, Math.max(0, level));
      const threshold = Math.max(
        ECHO_GATE_MIN_SPEECH_LEVEL,
        echoFloor * ECHO_GATE_ECHO_MULTIPLIER,
      );

      if (clamped >= threshold) {
        aboveThresholdFrames += 1;
        if (aboveThresholdFrames < ECHO_GATE_SPEECH_CONFIRM_FRAMES) {
          return { forward: false, reason: "echo" };
        }
        // Refresh the hold on every above-threshold frame so continuous
        // speech never flickers the gate closed between syllables.
        openUntilMs = timestampMs + ECHO_GATE_HOLD_MS;
        return { forward: true, reason: "speech" };
      }

      aboveThresholdFrames = 0;

      if (timestampMs < openUntilMs) {
        // Trailing sub-threshold speech; do not let it teach the echo floor.
        return { forward: true, reason: "hold" };
      }

      // Only confident non-speech frames adapt the floor, so louder rooms and
      // weaker echo cancellation raise the bar instead of leaking through.
      echoFloor = Math.min(
        ECHO_GATE_FLOOR_MAX,
        echoFloor + (clamped - echoFloor) * ECHO_GATE_FLOOR_ALPHA,
      );
      return { forward: false, reason: "echo" };
    },

    reset() {
      echoFloor = ECHO_GATE_FLOOR_SEED;
      openUntilMs = 0;
      aboveThresholdFrames = 0;
    },
  };
}
