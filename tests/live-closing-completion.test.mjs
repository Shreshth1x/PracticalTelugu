import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildLiveSystemInstruction } from "../app/practice-live/live-config.ts";
import {
  canSendClosingControlNow,
  shouldCompleteClosingPlayback,
} from "../app/practice-live/live-closing-completion.ts";
import { getLiveScenario } from "../app/practice-live/live-scenarios.ts";

const drainedClosing = {
  closingPlaybackPending: true,
  activeAudioSourceCount: 0,
  mayuTurnComplete: true,
  hasPendingPresentation: false,
};

test("completes only a fully drained closing presentation", () => {
  const cases = [
    {
      name: "ordinary completed turn",
      input: { ...drainedClosing, closingPlaybackPending: false },
      expected: false,
    },
    {
      name: "closing with audible audio remaining",
      input: { ...drainedClosing, activeAudioSourceCount: 1 },
      expected: false,
    },
    {
      name: "closing before Gemini completes its turn",
      input: { ...drainedClosing, mayuTurnComplete: false },
      expected: false,
    },
    {
      name: "closing with a continuation presentation pending",
      input: { ...drainedClosing, hasPendingPresentation: true },
      expected: false,
    },
    {
      name: "completed closing with no audio or presentation remaining",
      input: drainedClosing,
      expected: true,
    },
  ];

  for (const { name, input, expected } of cases) {
    assert.equal(shouldCompleteClosingPlayback(input), expected, name);
  }
});

test("waits for an in-progress learner reply before sending the closing control", () => {
  assert.equal(
    canSendClosingControlNow({
      phase: "listening",
      hasLearnerReplyInFlight: false,
    }),
    true,
  );
  assert.equal(
    canSendClosingControlNow({
      phase: "muted",
      hasLearnerReplyInFlight: false,
    }),
    true,
  );
  assert.equal(
    canSendClosingControlNow({
      phase: "listening",
      hasLearnerReplyInFlight: true,
    }),
    false,
  );
  assert.equal(
    canSendClosingControlNow({
      phase: "speaking",
      hasLearnerReplyInFlight: false,
    }),
    false,
  );
});

test("forbids Mayu from ending an ordinary exchange early", () => {
  const scenario = getLiveScenario("family-check-in");
  assert.ok(scenario);

  const instruction = buildLiveSystemInstruction(scenario, {
    relationship: "respectful",
    durationSeconds: 60,
  });

  assert.match(
    instruction,
    /Never end the conversation, say goodbye, or give a farewell on your own\./,
  );
  assert.match(
    instruction,
    /Only close after the app sends the explicit last-exchange practice-control message\./,
  );
});

test("wires the trusted closing marker through playback drain and deadline grace", async () => {
  const hookSource = await readFile(
    new URL("../app/practice-live/useGeminiLive.ts", import.meta.url),
    "utf8",
  );
  const settleStart = hookSource.indexOf(
    "const settleAssistantPlayback = useCallback",
  );
  const settleEnd = hookSource.indexOf(
    "const playSamples = useCallback",
    settleStart,
  );
  assert.ok(settleStart >= 0 && settleEnd > settleStart);

  const settleSource = hookSource.slice(settleStart, settleEnd);
  const predicateAt = settleSource.indexOf(
    "shouldCompleteClosingPlayback({",
  );
  const endAt = settleSource.indexOf('endSessionRef.current("limit")');
  const replyWindowAt = settleSource.indexOf("openLearnerReplyWindow()");
  assert.ok(predicateAt >= 0, "playback settlement checks closing state");
  assert.ok(endAt > predicateAt, "a drained closing completes the session");
  assert.ok(
    replyWindowAt > endAt,
    "the closing completes before another learner reply window can open",
  );

  assert.match(
    hookSource,
    /if \(!pending\.parsed\.replay && pending\.isControlTurn\) \{\s*closingPlaybackPendingRef\.current = true;/,
    "only the accepted client control turn arms automatic completion",
  );
  assert.match(
    hookSource,
    /const isControlTurn =\s*learnerTurnStateRef\.current\.controlTurnPending;\s*if \(isControlTurn\) closingPlaybackPendingRef\.current = true;/,
    "the caption-watchdog fallback preserves the same trusted marker",
  );
  assert.match(
    hookSource,
    /now >= deadline \+ CLOSING_PLAYBACK_GRACE_MS/,
    "a closing may drain past the nominal deadline but still has a bounded hard stop",
  );
  assert.match(
    hookSource,
    /const closingTurnInFlight =\s*closingRequestedRef\.current \|\|/,
    "deadline grace begins when the closing is requested, before its tool call is accepted",
  );
  assert.match(
    hookSource,
    /const hasLearnerReplyInFlight = Boolean\([\s\S]*learnerEpoch\?\.activityActive[\s\S]*!learnerEpoch\.captioned[\s\S]*canSendClosingControlNow\(\{/,
    "the last-exchange trigger queues behind active or not-yet-captioned learner speech",
  );
  assert.match(
    hookSource,
    /isControlTurn,\s*\}\);/,
    "accepted control turns pass through deterministic closing policy",
  );
  assert.match(
    hookSource,
    /deadlineTimerRef\.current = window\.setTimeout\(\s*\(\) => deadlineCheckRef\.current\(\)/,
    "the one-shot deadline uses the same drain-aware completion check",
  );
});
