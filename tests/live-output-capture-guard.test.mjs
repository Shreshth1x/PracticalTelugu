import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createLiveOutputCaptureGuard,
  LIVE_OUTPUT_ECHO_TAIL_MS,
  shouldForwardLiveMicrophoneFrame,
} from "../app/practice-live/live-output-capture-guard.ts";

function createFakeClock() {
  let nextHandle = 1;
  const scheduled = new Map();

  return {
    dependencies: {
      scheduleTimeout(callback, delayMs) {
        const handle = nextHandle;
        nextHandle += 1;
        scheduled.set(handle, { callback, delayMs });
        return handle;
      },
      cancelTimeout(handle) {
        scheduled.delete(handle);
      },
    },
    scheduled,
    run(handle) {
      const task = scheduled.get(handle);
      assert.ok(task, `missing timer ${handle}`);
      scheduled.delete(handle);
      task.callback();
    },
  };
}

test("sequences the reply window through playback and its short tail", () => {
  const clock = createFakeClock();
  const guard = createLiveOutputCaptureGuard(clock.dependencies);
  let readyCount = 0;

  assert.equal(guard.isInputBlocked(), false);
  guard.beginOutput();
  assert.equal(guard.isInputBlocked(), true);
  // The basic eligibility check remains independent of output; the hook's
  // production half-duplex gate applies immediately afterward.
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      expectsLearnerResponse: true,
      isMuted: false,
      sessionMatches: true,
    }),
    true,
  );

  guard.releaseAfterTail(() => {
    readyCount += 1;
  });
  const [[handle, task]] = clock.scheduled;
  assert.equal(task.delayMs, LIVE_OUTPUT_ECHO_TAIL_MS);
  assert.equal(guard.isInputBlocked(), true);
  assert.equal(readyCount, 0);

  clock.run(handle);
  assert.equal(guard.isInputBlocked(), false);
  assert.equal(readyCount, 1);
});

test("keeps the reply-window debounce short enough for conversation", () => {
  assert.ok(
    LIVE_OUTPUT_ECHO_TAIL_MS <= 150,
    "a long echo tail adds dead time to every turn boundary",
  );
});

test("new output cancels a pending release and cancel clears the guard", () => {
  const clock = createFakeClock();
  const guard = createLiveOutputCaptureGuard(clock.dependencies);
  let readyCount = 0;

  guard.beginOutput();
  guard.releaseAfterTail(() => {
    readyCount += 1;
  });
  assert.equal(clock.scheduled.size, 1);

  guard.beginOutput();
  assert.equal(clock.scheduled.size, 0);
  assert.equal(guard.isInputBlocked(), true);

  guard.releaseAfterTail(() => {
    readyCount += 1;
  });
  guard.cancel();
  assert.equal(clock.scheduled.size, 0);
  assert.equal(guard.isInputBlocked(), false);
  assert.equal(readyCount, 0);
});

test("completion updates do not extend the acoustic tail", () => {
  const clock = createFakeClock();
  const guard = createLiveOutputCaptureGuard(clock.dependencies);
  const events = [];

  guard.beginOutput();
  guard.releaseAfterTail(() => events.push("audio-ended"));
  const [[handle]] = clock.scheduled;
  guard.releaseAfterTail(() => events.push("turn-complete"));

  assert.equal(clock.scheduled.size, 1);
  assert.ok(clock.scheduled.has(handle));
  clock.run(handle);
  assert.deepEqual(events, ["turn-complete"]);
});

test("interruption drops stale completion without extending the acoustic tail", () => {
  const clock = createFakeClock();
  const guard = createLiveOutputCaptureGuard(clock.dependencies);
  let readyCount = 0;

  guard.beginOutput();
  guard.releaseAfterTail(() => {
    readyCount += 1;
  });
  const [[handle]] = clock.scheduled;

  guard.discardReleaseCallback();
  assert.equal(clock.scheduled.size, 1);
  assert.ok(clock.scheduled.has(handle));

  clock.run(handle);
  assert.equal(readyCount, 0);
  assert.equal(guard.isInputBlocked(), false);
});

test("forwards microphone frames only after Mayu opens the reply window", () => {
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      expectsLearnerResponse: false,
      isMuted: false,
      sessionMatches: true,
    }),
    false,
    "startup audio must not become a learner turn before Mayu greets them",
  );
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      expectsLearnerResponse: true,
      isMuted: false,
      sessionMatches: true,
    }),
    true,
  );
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      expectsLearnerResponse: true,
      isMuted: true,
      sessionMatches: true,
    }),
    false,
  );
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      expectsLearnerResponse: true,
      isMuted: false,
      sessionMatches: false,
    }),
    false,
  );
});

test("wires the output guard into every local voice path and microphone upload", async () => {
  const hookSource = await readFile(
    new URL("../app/practice-live/useGeminiLive.ts", import.meta.url),
    "utf8",
  );
  const playSamplesStart = hookSource.indexOf("const playSamples = useCallback");
  const playSamplesEnd = hookSource.indexOf("const playAudio = useCallback");
  const startCaptureStart = hookSource.indexOf("const startCapture = useCallback");
  const startCaptureEnd = hookSource.indexOf("const start = useCallback");

  assert.ok(playSamplesStart >= 0 && playSamplesEnd > playSamplesStart);
  assert.ok(startCaptureStart >= 0 && startCaptureEnd > startCaptureStart);
  const playSamplesSource = hookSource.slice(playSamplesStart, playSamplesEnd);
  const startCaptureSource = hookSource.slice(startCaptureStart, startCaptureEnd);

  assert.doesNotMatch(
    playSamplesSource,
    /endMicrophoneStream\(\);/,
    "playback must keep hardware capture alive while the frame gate pauses uploads",
  );
  assert.match(
    playSamplesSource,
    /getOutputCaptureGuard\(\)\.beginOutput\(\);/,
  );
  assert.match(playSamplesSource, /source\.start\(startAt\);/);
  assert.doesNotMatch(
    startCaptureSource,
    /outputBlocked/,
    "microphone forwarding must not be gated on playback output",
  );
  assert.doesNotMatch(
    startCaptureSource,
    /mayuPresentationReadyRef\.current \|\|\s*!shouldForwardLiveMicrophoneFrame/,
    "a pending Mayu presentation must not mute the microphone upload",
  );
  assert.match(
    startCaptureSource,
    /microphoneStreamOpenRef\.current = true;/,
  );
  assert.match(
    hookSource,
    /const LIVE_FULL_DUPLEX_ENABLED = false;/,
    "speaker playback must remain fail-safe half-duplex until acoustic route tests prove barge-in safe",
  );
  assert.match(
    hookSource,
    /LIVE_FULL_DUPLEX_ENABLED && echoCancellationActive \? "full" : "half"/,
    "a browser AEC setting alone must not enable full-duplex microphone upload",
  );
  assert.match(
    startCaptureSource,
    /if \(outputAudible && duplexModeRef\.current === "half"\) \{\s*endMicrophoneStream\(\);\s*return;/,
    "Mayu playback and its acoustic tail must close the uploaded microphone stream",
  );
  const forwardingGuardAt = startCaptureSource.indexOf(
    "!shouldForwardLiveMicrophoneFrame({",
  );
  const uploadAt = startCaptureSource.indexOf("session.sendRealtimeInput({");
  const assessmentCaptureAt = startCaptureSource.indexOf(
    "appendLiveAssessmentAudio(learnerAssessmentAudioRef.current, pcm);",
  );
  assert.ok(forwardingGuardAt >= 0);
  assert.ok(uploadAt > forwardingGuardAt);
  assert.match(
    startCaptureSource,
    /expectsLearnerResponse:\s*learnerTurnStateRef\.current\.expectsLearnerResponse/,
    "the opening greeting must establish a reply window before microphone upload",
  );
  assert.ok(
    assessmentCaptureAt > uploadAt,
    "assessment PCM is captured only after the frame passes the microphone forwarding guard",
  );
  assert.match(
    hookSource,
    /session\.sendRealtimeInput\(\{ audioStreamEnd: true \}\);/,
  );
  assert.doesNotMatch(
    hookSource,
    /fishSpeech|bufferFallback|playFish/,
    "the removed cloned-voice path must not reappear in the live hook",
  );
});

test("keeps checked captions independent and finalizes only the latest presentation candidate", async () => {
  const hookSource = await readFile(
    new URL("../app/practice-live/useGeminiLive.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    hookSource,
    /const parsed =\s*parseLivePresentedTurnToolCall\(call\.args\) \?\?\s*repairLivePresentedTurnToolCall\(call\.args\);/,
  );
  assert.match(
    hookSource,
    /pendingPresentedTurnRef\.current = \{[\s\S]*learnerCaption,[\s\S]*isControlTurn/,
    "pre-audio presentation revisions replace one private candidate",
  );
  assert.match(
    hookSource,
    /if \(!needsLearnerCaption && parsed\.learner\)[\s\S]*No learner reply exists for this turn[\s\S]*FunctionResponseScheduling\.INTERRUPT[\s\S]*true/,
    "Mayu cannot fabricate a learner reply before microphone input exists",
  );
  assert.match(
    hookSource,
    /Mayu spoke without an accepted present_turn call[\s\S]*applyLearnerTurnEvent\(\{\s*type: "mayu-turn-presented",\s*expectsReply: !learnerTurnStateRef\.current\.controlTurnPending/,
    "the uncaptioned-audio fallback still opens the learner reply window",
  );
  assert.match(
    hookSource,
    /audioParts\.length &&[\s\S]*pendingPresentedTurnRef\.current[\s\S]*finalizePendingPresentation\(\)/,
    "the latest checked candidate becomes visible before buffered audio plays",
  );
  assert.match(
    hookSource,
    /mayuPresentationReadyRef\.current &&[\s\S]*learnerReplyWindowOpenedAtRef\.current === null[\s\S]*FunctionResponseScheduling\.SILENT/,
    "post-audio continuation calls cannot create duplicate transcript turns",
  );
  const acceptedResponseStart = hookSource.indexOf(
    "pendingPresentedTurnRef.current = {",
  );
  const acceptedResponseEnd = hookSource.indexOf(
    "sessionRef.current?.sendToolResponse",
    acceptedResponseStart,
  );
  assert.ok(
    acceptedResponseStart >= 0 && acceptedResponseEnd > acceptedResponseStart,
  );
  const acceptedResponseSource = hookSource.slice(
    acceptedResponseStart,
    acceptedResponseEnd,
  );
  assert.match(acceptedResponseSource, /continueSameTurn: true/);
  assert.doesNotMatch(
    acceptedResponseSource,
    /scheduling:/,
    "the blocking presentation response must resume its existing generation instead of scheduling another one",
  );
  assert.doesNotMatch(
    hookSource,
    /suppressNativeAudioUntilBoundaryRef/,
    "a duplicate tool call must not mute the accepted turn's remaining audio",
  );
  assert.doesNotMatch(
    hookSource,
    /PRACTICE-CONTROL TOOL-ONLY TURN|privateAssessmentTurnRef|learnerAssessmentQueueRef/,
  );
  assert.match(
    hookSource,
    /transcriptRef\.current = next;/,
    "provider ASR stays private until a checked learner caption arrives",
  );
  assert.doesNotMatch(
    hookSource,
    /validLearnerCaption \?\? transcriptFallback/,
    "an unstable provider transcript cannot become the active caption",
  );
  assert.match(
    hookSource,
    /if \(finalInput\.finished !== false\)/,
    "inputTranscription without an explicit false finished flag is final",
  );
});

test("uses pending-ASR finalization when ending a live session", async () => {
  const hookSource = await readFile(
    new URL("../app/practice-live/useGeminiLive.ts", import.meta.url),
    "utf8",
  );
  const endStart = hookSource.indexOf("const end = useCallback");
  const endEnd = hookSource.indexOf("const reset = useCallback", endStart);

  assert.ok(endStart >= 0 && endEnd > endStart);
  const endSource = hookSource.slice(endStart, endEnd);
  assert.match(
    endSource,
    /const completedTranscript = finalizeLiveTranscriptForEnd\(\s*transcriptRef\.current,?\s*\);/,
    "session end must preserve a safe final ASR transcript while marking it unscored",
  );
  assert.doesNotMatch(
    endSource,
    /removePendingLiveTurns/,
    "session end must not discard every in-flight learner row",
  );
});
