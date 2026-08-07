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

test("blocks microphone frames through playback and its acoustic tail", () => {
  const clock = createFakeClock();
  const guard = createLiveOutputCaptureGuard(clock.dependencies);
  let readyCount = 0;
  const shouldForward = () =>
    shouldForwardLiveMicrophoneFrame({
      isMuted: false,
      sessionMatches: true,
      outputBlocked: guard.isInputBlocked(),
    });

  assert.equal(guard.isInputBlocked(), false);
  assert.equal(shouldForward(), true);
  guard.beginOutput();
  assert.equal(guard.isInputBlocked(), true);
  assert.equal(shouldForward(), false);

  guard.releaseAfterTail(() => {
    readyCount += 1;
  });
  const [[handle, task]] = clock.scheduled;
  assert.equal(task.delayMs, LIVE_OUTPUT_ECHO_TAIL_MS);
  assert.equal(guard.isInputBlocked(), true);
  assert.equal(shouldForward(), false);
  assert.equal(readyCount, 0);

  clock.run(handle);
  assert.equal(guard.isInputBlocked(), false);
  assert.equal(shouldForward(), true);
  assert.equal(readyCount, 1);
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

test("forwards microphone frames only for the active unmuted session between turns", () => {
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      isMuted: false,
      sessionMatches: true,
      outputBlocked: false,
    }),
    true,
  );
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      isMuted: true,
      sessionMatches: true,
      outputBlocked: false,
    }),
    false,
  );
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      isMuted: false,
      sessionMatches: false,
      outputBlocked: false,
    }),
    false,
  );
  assert.equal(
    shouldForwardLiveMicrophoneFrame({
      isMuted: false,
      sessionMatches: true,
      outputBlocked: true,
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

  assert.match(playSamplesSource, /endMicrophoneStream\(\);/);
  assert.match(
    playSamplesSource,
    /getOutputCaptureGuard\(\)\.beginOutput\(\);/,
  );
  assert.ok(
    playSamplesSource.indexOf("endMicrophoneStream();") <
      playSamplesSource.indexOf("getOutputCaptureGuard().beginOutput();"),
    "Gemini must receive audioStreamEnd before the playback capture gap",
  );
  assert.match(playSamplesSource, /source\.start\(startAt\);/);
  assert.match(
    startCaptureSource,
    /outputBlocked:\s*outputCaptureGuard\.isInputBlocked\(\)/,
  );
  assert.match(
    startCaptureSource,
    /microphoneStreamOpenRef\.current = true;/,
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
  assert.ok(
    assessmentCaptureAt > uploadAt,
    "assessment PCM is captured only after the frame passes the microphone forwarding guard",
  );
  assert.match(
    hookSource,
    /session\.sendRealtimeInput\(\{ audioStreamEnd: true \}\);/,
  );
  assert.match(hookSource, /playFish:\s*playSamples/);
  assert.match(hookSource, /playFallback:\s*playAudio/);
  assert.match(
    hookSource,
    /if \(!fishSpeechController\?\.bufferFallback\(encodedAudio\)\)\s*\{\s*playAudio\(encodedAudio\);/,
  );
});

test("keeps checked captions independent and finalizes only the latest presentation candidate", async () => {
  const hookSource = await readFile(
    new URL("../app/practice-live/useGeminiLive.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    hookSource,
    /const parsed = parseLivePresentedTurnToolCall\(call\.args\);/,
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
    /audioParts\.length &&[\s\S]*pendingPresentedTurnRef\.current[\s\S]*finalizePendingPresentation\(\)/,
    "the latest checked candidate becomes visible before buffered audio plays",
  );
  assert.match(
    hookSource,
    /mayuPresentationReadyRef\.current &&[\s\S]*learnerReplyWindowOpenedAtRef\.current === null[\s\S]*FunctionResponseScheduling\.SILENT/,
    "post-audio continuation calls cannot create duplicate transcript turns",
  );
  assert.match(
    hookSource,
    /suppressNativeAudioUntilBoundaryRef\.current = true;[\s\S]*FunctionResponseScheduling\.SILENT/,
    "audio following a duplicate post-playback tool call is suppressed to the turn boundary",
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
