import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createLiveConnectBoundary,
  nextLiveResumptionHandle,
} from "../app/practice-live/live-connect-boundary.ts";

test("buffers setup messages until the Live session is installed", () => {
  const boundary = createLiveConnectBoundary();
  const delivered = [];

  boundary.push("first");
  boundary.push("second");
  assert.deepEqual(delivered, []);
  assert.equal(boundary.install((message) => delivered.push(message)), true);
  assert.deepEqual(delivered, ["first", "second"]);

  boundary.push("third");
  assert.deepEqual(delivered, ["first", "second", "third"]);
  assert.equal(boundary.install(() => undefined), false);
});

test("turns a setup socket failure into a connect rejection", async () => {
  const boundary = createLiveConnectBoundary();
  const expected = new Error("setup closed");

  assert.equal(boundary.consumeConnectFailure(expected), true);
  assert.equal(boundary.consumeConnectFailure(new Error("duplicate close")), true);
  assert.equal(boundary.didFail(), true);
  boundary.push("dropped");
  assert.equal(boundary.install(() => assert.fail("failed messages must drop")), false);
  await assert.rejects(boundary.failure, expected);
});

test("leaves established socket failures to normal reconnect handling", () => {
  const boundary = createLiveConnectBoundary();

  assert.equal(boundary.install(() => undefined), true);
  assert.equal(
    boundary.consumeConnectFailure(new Error("established socket closed")),
    false,
  );
  assert.equal(boundary.didFail(), false);
});

test("clears stale Live resumption handles at non-resumable points", () => {
  assert.equal(
    nextLiveResumptionHandle({ resumable: true, newHandle: "fresh" }),
    "fresh",
  );
  assert.equal(
    nextLiveResumptionHandle({ resumable: false, newHandle: "stale" }),
    null,
  );
  assert.equal(nextLiveResumptionHandle({ resumable: true }), null);
  assert.equal(nextLiveResumptionHandle({}), null);
});

test("preserves the active Mayu turn while replacing a dropped socket", async () => {
  const source = await readFile(
    new URL("../app/practice-live/useGeminiLive.ts", import.meta.url),
    "utf8",
  );
  const resumeStart = source.indexOf("const attemptResume = useCallback");
  const resumeEnd = source.indexOf("useEffect(() => {", resumeStart);
  const resumeSource = source.slice(resumeStart, resumeEnd);

  assert.ok(resumeStart >= 0 && resumeEnd > resumeStart);
  assert.doesNotMatch(resumeSource, /stopPlayback\(\)/);
  assert.doesNotMatch(resumeSource, /prepareMayuResponse\(\)/);
  assert.doesNotMatch(resumeSource, /echoGateRef\.current\?\.reset\(\)/);
  assert.doesNotMatch(resumeSource, /updatePhase\("connecting"\)/);
  assert.match(
    resumeSource,
    /sessionRef\.current = session;\s*boundary\.install\(handleServerMessage\);/,
    "queued resumed messages must wait until tool responses have a Session",
  );
  assert.match(resumeSource, /LIVE_RECONNECT_TIMEOUT_MS/);
});
