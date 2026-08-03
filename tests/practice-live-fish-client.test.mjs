import assert from "node:assert/strict";
import test from "node:test";

import {
  createFishSpeechController,
  FISH_SPEECH_CLIENT_TIMEOUT_MS,
} from "../app/practice-live/live-fish-speech.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeTimers() {
  let nextHandle = 1;
  const callbacks = new Map();
  const delays = [];

  return {
    scheduleTimeout(callback, delayMs) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      delays.push(delayMs);
      return handle;
    },
    cancelTimeout(handle) {
      callbacks.delete(handle);
    },
    runAll() {
      for (const [handle, callback] of [...callbacks]) {
        callbacks.delete(handle);
        callback();
      }
    },
    get activeCount() {
      return callbacks.size;
    },
    delays,
  };
}

function createHarness() {
  const timers = fakeTimers();
  const controller = createFishSpeechController(
    {
      scheduleTimeout: timers.scheduleTimeout,
      cancelTimeout: timers.cancelTimeout,
      createAbortController: () => new AbortController(),
    },
    FISH_SPEECH_CLIENT_TIMEOUT_MS,
  );

  return { controller, timers };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test("Fish success discards buffered Gemini and plays Fish exactly once", async () => {
  const { controller, timers } = createHarness();
  const request = deferred();
  const fishAudio = { source: "fish" };
  const playedFish = [];
  const playedFallback = [];
  let fallbackCount = 0;
  let releaseCount = 0;

  controller.start({
    request: () => request.promise,
    playFish: (audio) => playedFish.push(audio),
    playFallback: (audio) => playedFallback.push(audio),
    onFallback: () => {
      fallbackCount += 1;
    },
    onFallbackReleased: () => {
      releaseCount += 1;
    },
  });
  assert.equal(controller.bufferFallback("gemini-one"), true);
  assert.equal(controller.bufferFallback("gemini-two"), true);

  request.resolve(fishAudio);
  await flushPromises();

  assert.deepEqual(playedFish, [fishAudio]);
  assert.deepEqual(playedFallback, []);
  assert.equal(fallbackCount, 0);
  assert.equal(releaseCount, 0);
  assert.equal(timers.activeCount, 0);
  assert.equal(controller.bufferFallback("late-gemini"), true);
  timers.runAll();
  assert.deepEqual(playedFish, [fishAudio]);
  assert.deepEqual(playedFallback, []);
});

test("request failure releases buffered Gemini exactly once", async () => {
  const { controller, timers } = createHarness();
  const request = deferred();
  const playedFallback = [];
  let fallbackCount = 0;
  let releaseCount = 0;

  controller.start({
    request: () => request.promise,
    playFish: () => assert.fail("Fish must not play after a failed request"),
    playFallback: (audio) => playedFallback.push(audio),
    onFallback: () => {
      fallbackCount += 1;
    },
    onFallbackReleased: () => {
      releaseCount += 1;
    },
  });
  controller.bufferFallback("gemini-one");
  controller.bufferFallback("gemini-two");

  request.reject(new Error("network unavailable"));
  await flushPromises();
  timers.runAll();

  assert.deepEqual(playedFallback, ["gemini-one", "gemini-two"]);
  assert.equal(fallbackCount, 1);
  assert.equal(releaseCount, 1);
  assert.equal(controller.bufferFallback("gemini-after-fallback"), false);
});

test("a hung Fish request times out after the nine-second client window", () => {
  const { controller, timers } = createHarness();
  let requestSignal;
  const playedFallback = [];
  let fallbackCount = 0;

  controller.start({
    request: (signal) => {
      requestSignal = signal;
      return new Promise(() => undefined);
    },
    playFish: () => assert.fail("A hung request cannot play Fish audio"),
    playFallback: (audio) => playedFallback.push(audio),
    onFallback: () => {
      fallbackCount += 1;
    },
    onFallbackReleased: () => undefined,
  });
  controller.bufferFallback("gemini-timeout");

  assert.deepEqual(timers.delays, [9_000]);
  timers.runAll();

  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(playedFallback, ["gemini-timeout"]);
  assert.equal(fallbackCount, 1);
  assert.equal(controller.isPending(), false);
});

test("late Fish resolution after timeout never plays Fish or duplicates fallback", async () => {
  const { controller, timers } = createHarness();
  const request = deferred();
  const playedFish = [];
  const playedFallback = [];
  let fallbackCount = 0;
  let releaseCount = 0;

  controller.start({
    request: () => request.promise,
    playFish: (audio) => playedFish.push(audio),
    playFallback: (audio) => playedFallback.push(audio),
    onFallback: () => {
      fallbackCount += 1;
    },
    onFallbackReleased: () => {
      releaseCount += 1;
    },
  });
  controller.bufferFallback("gemini-only-once");
  timers.runAll();

  request.resolve("late-fish-audio");
  await flushPromises();
  timers.runAll();

  assert.deepEqual(playedFish, []);
  assert.deepEqual(playedFallback, ["gemini-only-once"]);
  assert.equal(fallbackCount, 1);
  assert.equal(releaseCount, 1);
});

test("cancel and reset clear pending timers without marking fallback", async (t) => {
  for (const method of ["cancel", "reset"]) {
    await t.test(method, () => {
      const { controller, timers } = createHarness();
      let requestSignal;
      let fallbackCount = 0;
      let releaseCount = 0;

      controller.start({
        request: (signal) => {
          requestSignal = signal;
          return new Promise(() => undefined);
        },
        playFish: () => assert.fail(`${method} must not play Fish`),
        playFallback: () => assert.fail(`${method} must not release Gemini`),
        onFallback: () => {
          fallbackCount += 1;
        },
        onFallbackReleased: () => {
          releaseCount += 1;
        },
      });
      controller.bufferFallback("discarded-gemini");

      controller[method]();
      timers.runAll();

      assert.equal(requestSignal.aborted, true);
      assert.equal(timers.activeCount, 0);
      assert.equal(fallbackCount, 0);
      assert.equal(releaseCount, 0);
      assert.equal(controller.isPending(), false);
    });
  }
});

test("fallback playback callbacks finish before the release callback", async () => {
  const { controller } = createHarness();
  const events = [];

  controller.start({
    request: async () => {
      throw new Error("Fish unavailable");
    },
    playFish: () => assert.fail("Failed Fish audio must not play"),
    playFallback: (audio) => {
      events.push(`play:${audio}:start`);
      events.push(`play:${audio}:end`);
    },
    onFallback: () => events.push("fallback"),
    onFallbackReleased: () => events.push("released"),
  });
  controller.bufferFallback("one");
  controller.bufferFallback("two");

  await flushPromises();

  assert.deepEqual(events, [
    "fallback",
    "play:one:start",
    "play:one:end",
    "play:two:start",
    "play:two:end",
    "released",
  ]);
});
