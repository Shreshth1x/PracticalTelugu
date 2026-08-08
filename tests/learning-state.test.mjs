import assert from "node:assert/strict";
import test from "node:test";
import {
  applySnapshotChanges,
  mergeSnapshots,
  snapshotAdditionsSince,
  userStorageKeys,
} from "../app/learning-state.ts";

function snapshot({ state = {}, preferences = {}, savedWords = [] } = {}) {
  return {
    state: {
      completed: state.completed ?? [],
      confidence: state.confidence ?? {},
    },
    preferences: {
      showPronunciation: preferences.showPronunciation ?? true,
      autoplay: preferences.autoplay ?? false,
    },
    savedWords,
  };
}

test("mergeSnapshots keeps local preferences by default", () => {
  const local = snapshot({ preferences: { autoplay: true } });
  const cloud = snapshot({ preferences: { autoplay: false } });

  assert.equal(mergeSnapshots(local, cloud).preferences.autoplay, true);
});

test("mergeSnapshots can keep the second snapshot's preferences", () => {
  const additions = snapshot({
    state: { completed: ["hello-goodbye"] },
    preferences: { autoplay: true, showPronunciation: false },
  });
  const account = snapshot({
    state: { completed: ["at-the-table"] },
    preferences: { autoplay: false, showPronunciation: true },
  });

  const merged = mergeSnapshots(additions, account, { preferences: "cloud" });

  assert.deepEqual(merged.preferences, account.preferences);
  assert.deepEqual(
    [...merged.state.completed].sort(),
    ["at-the-table", "hello-goodbye"],
  );
});

test("the anonymous claim merge cannot revert signed-in preference changes", () => {
  // The frozen anonymous snapshot still says autoplay is off; the signed-in
  // account has since turned it on. The claim only adds learning progress.
  const anonymousAdditions = snapshotAdditionsSince(
    snapshot({
      state: { completed: ["hello-goodbye"] },
      preferences: { autoplay: false },
    }),
    snapshot(),
  );
  const accountState = snapshot({
    state: { completed: ["at-the-table"] },
    preferences: { autoplay: true },
  });

  const reconciled = mergeSnapshots(anonymousAdditions, accountState, {
    preferences: "cloud",
  });

  assert.equal(reconciled.preferences.autoplay, true);
  assert.ok(reconciled.state.completed.includes("hello-goodbye"));
  assert.ok(reconciled.state.completed.includes("at-the-table"));
});

test("an explicit reset clears progress but follows saved-word edits", () => {
  const baseline = snapshot({
    state: {
      completed: ["hello-goodbye"],
      confidence: { namaskaaram: "ready" },
    },
    savedWords: ["namaskaaram", "neellu"],
  });
  const current = snapshot({
    state: { completed: [], confidence: {} },
    savedWords: ["namaskaaram"],
  });
  const target = snapshot({
    state: {
      completed: ["hello-goodbye", "at-the-table"],
      confidence: { namaskaaram: "ready", ekkada: "learning" },
    },
    savedWords: ["namaskaaram", "neellu", "ekkada"],
  });

  const applied = applySnapshotChanges(baseline, current, target, {
    explicitReset: true,
  });

  assert.deepEqual(applied.state, { completed: [], confidence: {} });
  // "neellu" was un-saved locally (in baseline, not current) so it is removed;
  // the other device's "ekkada" save survives the reset.
  assert.deepEqual(applied.savedWords, ["namaskaaram", "ekkada"]);
});

test("an empty snapshot without explicit reset leaves the target untouched", () => {
  const baseline = snapshot({
    state: { completed: ["hello-goodbye"] },
    savedWords: ["namaskaaram"],
  });
  const damaged = snapshot();
  const target = snapshot({
    state: {
      completed: ["hello-goodbye", "at-the-table"],
      confidence: { neellu: "learning" },
    },
    preferences: { autoplay: true },
    savedWords: ["namaskaaram", "neellu"],
  });

  assert.deepEqual(applySnapshotChanges(baseline, damaged, target), target);
});

test("a fresh account with no baseline still syncs device progress", () => {
  const empty = snapshot();
  const current = snapshot({
    state: { completed: ["hello-goodbye"] },
    savedWords: ["namaskaaram"],
  });

  const applied = applySnapshotChanges(empty, current, empty);

  assert.deepEqual(applied.state.completed, ["hello-goodbye"]);
  assert.deepEqual(applied.savedWords, ["namaskaaram"]);
});

test("user storage keys include the reset-pending marker", () => {
  const keys = userStorageKeys("user-123");

  assert.equal(keys.resetPending, "palukulu.user.user-123.reset-pending.v1");
  assert.equal(keys.dirty, "palukulu.user.user-123.dirty.v1");
});
