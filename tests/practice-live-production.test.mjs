import assert from "node:assert/strict";
import test from "node:test";

import { POST as createLiveToken } from "../app/api/practice-live/token/route.ts";
import {
  buildLiveConnectConfig,
  buildLiveSystemInstruction,
  isLiveListenerRelationship,
  isLiveSessionDuration,
} from "../app/practice-live/live-config.ts";
import {
  getLiveOpeningCue,
  getLiveScenario,
} from "../app/practice-live/live-scenarios.ts";

const familyScenario = getLiveScenario("family-check-in");
assert.ok(familyScenario);

test("validates only the two production relationships and session durations", () => {
  assert.equal(isLiveListenerRelationship("close"), true);
  assert.equal(isLiveListenerRelationship("respectful"), true);
  assert.equal(isLiveListenerRelationship("formal"), false);
  assert.equal(isLiveSessionDuration(60), true);
  assert.equal(isLiveSessionDuration(120), true);
  assert.equal(isLiveSessionDuration("60"), false);
  assert.equal(isLiveSessionDuration(300), false);
});

test("locks each Live prompt and reviewed family opener to one relationship", () => {
  const close = buildLiveSystemInstruction(familyScenario, {
    relationship: "close",
    durationSeconds: 60,
  });
  const respectful = buildLiveSystemInstruction(familyScenario, {
    relationship: "respectful",
    durationSeconds: 120,
  });

  assert.match(close, /CLOSE RELATIONSHIP LOCK/);
  assert.match(close, /nuvvu\/nee/);
  assert.match(close, /Session length: 60 seconds/);
  assert.match(respectful, /RESPECTFUL RELATIONSHIP LOCK/);
  assert.match(respectful, /meeru\/mee/);
  assert.match(respectful, /new person of the learner's own age/);
  assert.match(respectful, /Session length: 120 seconds/);
  assert.match(
    getLiveOpeningCue(familyScenario, "close"),
    /have-you-eaten__primary/,
  );
  assert.match(
    getLiveOpeningCue(familyScenario, "respectful"),
    /have-you-eaten__alt_0/,
  );
});

test("uses the production 500 ms end-of-speech window", () => {
  const config = buildLiveConnectConfig(familyScenario, {
    relationship: "respectful",
    durationSeconds: 60,
  });

  assert.equal(
    config.realtimeInputConfig?.automaticActivityDetection?.silenceDurationMs,
    500,
  );
});

test("rejects cross-origin, oversized, and invalid token requests before minting", async () => {
  const headerless = await createLiveToken(
    new Request("https://practicaltelugu.example/api/practice-live/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId: "family-check-in",
        relationship: "respectful",
        durationSeconds: 60,
      }),
    }),
  );
  assert.equal(headerless.status, 403);

  const crossOrigin = await createLiveToken(
    new Request("https://practicaltelugu.example/api/practice-live/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({
        scenarioId: "family-check-in",
        relationship: "respectful",
        durationSeconds: 60,
      }),
    }),
  );
  assert.equal(crossOrigin.status, 403);

  const oversized = await createLiveToken(
    new Request("https://practicaltelugu.example/api/practice-live/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "4096",
        Origin: "https://practicaltelugu.example",
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
    }),
  );
  assert.equal(oversized.status, 413);

  const invalidRelationship = await createLiveToken(
    new Request("https://practicaltelugu.example/api/practice-live/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://practicaltelugu.example",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        scenarioId: "family-check-in",
        relationship: "formal",
        durationSeconds: 60,
      }),
    }),
  );
  assert.equal(invalidRelationship.status, 400);
  assert.equal((await invalidRelationship.json()).code, "invalid_relationship");
});

test("mints one-use tokens with exact connection and session headroom", async () => {
  const fixedNow = Date.parse("2026-08-02T12:00:00.000Z");
  const originalDateNow = Date.now;
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const tokenRequests = [];

  Date.now = () => fixedNow;
  process.env.GEMINI_API_KEY = "test-only-key";
  globalThis.fetch = async (_input, init) => {
    tokenRequests.push(JSON.parse(String(init?.body)));
    return Response.json({ name: "auth_tokens/test-only" });
  };

  try {
    for (const durationSeconds of [60, 120]) {
      const response = await createLiveToken(
        new Request(
          "https://practicaltelugu.example/api/practice-live/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://practicaltelugu.example",
              "Sec-Fetch-Site": "same-origin",
              "X-Forwarded-For": `ttl-test-${durationSeconds}`,
            },
            body: JSON.stringify({
              scenarioId: "family-check-in",
              relationship: "respectful",
              durationSeconds,
            }),
          },
        ),
      );

      assert.equal(response.status, 200);
      const payload = await response.json();
      const request = tokenRequests.at(-1);
      assert.ok(request);
      assert.equal(request.uses, 1);
      assert.equal(
        Date.parse(request.newSessionExpireTime) - fixedNow,
        60_000,
      );
      assert.equal(
        Date.parse(request.expireTime) - fixedNow,
        (durationSeconds + 70) * 1_000,
      );
      assert.equal(
        Date.parse(request.expireTime) -
          Date.parse(request.newSessionExpireTime),
        (durationSeconds + 10) * 1_000,
      );
      assert.equal(payload.sessionLimitSeconds, durationSeconds);
      assert.equal(payload.tokenExpiresAt, request.expireTime);
    }

    assert.equal(tokenRequests.length, 2);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
});
