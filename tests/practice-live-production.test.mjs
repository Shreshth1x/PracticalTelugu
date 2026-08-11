import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POST as createLiveToken } from "../app/api/practice-live/token/route.ts";
import {
  buildLiveConnectConfig,
  buildLiveSystemInstruction,
  isLiveListenerRelationship,
  isLiveSessionDuration,
} from "../app/practice-live/live-config.ts";
import {
  getLiveClosingFarewell,
  getLiveFamilyAteFollowup,
  getLiveOpeningCue,
  getLiveOpeningGreeting,
  getLiveScenario,
} from "../app/practice-live/live-scenarios.ts";

const familyScenario = getLiveScenario("family-check-in");
assert.ok(familyScenario);

test("validates relationships and session durations", () => {
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
  assert.match(close, /have-you-eaten__primary/);
  assert.match(respectful, /have-you-eaten__alt_0/);
  const closeAteFollowup = getLiveFamilyAteFollowup("close");
  const respectfulAteFollowup = getLiveFamilyAteFollowup("respectful");
  assert.deepEqual(closeAteFollowup, {
    telugu: "ఏం తిన్నావు?",
    roman: "em tinnaavu?",
    pronunciation: "AYM tin-NAA-voo?",
    english: "What did you eat?",
  });
  assert.deepEqual(respectfulAteFollowup, {
    telugu: "ఏం తిన్నారు?",
    roman: "em tinnaaru?",
    pronunciation: "AYM tin-NAA-roo?",
    english: "What did you eat?",
  });
  assert.match(close, /entire next turn must be exactly[^\n]+ఏం తిన్నావు\?/);
  assert.doesNotMatch(close, /entire next turn must be exactly[^\n]+ఏం తిన్నారు\?/);
  assert.match(
    respectful,
    /entire next turn must be exactly[^\n]+ఏం తిన్నారు\?/,
  );
  assert.doesNotMatch(
    respectful,
    /entire next turn must be exactly[^\n]+ఏం తిన్నావు\?/,
  );
  assert.deepEqual(getLiveClosingFarewell("close"), {
    telugu: "సరే, మళ్లీ మాట్లాడదాం.",
    roman: "sare, malli maatlaadadaam.",
    pronunciation: "suh-RAY, MUL-lee maat-LAA-duh-daam.",
    english: "Okay, let's talk again.",
  });
  assert.deepEqual(getLiveClosingFarewell("respectful"), {
    telugu: "సరే అండి, మళ్లీ మాట్లాడదాం.",
    roman: "sare andi, malli maatlaadadaam.",
    pronunciation: "suh-RAY UN-dee, MUL-lee maat-LAA-duh-daam.",
    english: "Okay, let's talk again.",
  });
  const closeOpening = getLiveOpeningCue(familyScenario, "close");
  const respectfulOpening = getLiveOpeningCue(
    familyScenario,
    "respectful",
  );

  assert.match(closeOpening, /entire first turn/);
  assert.match(closeOpening, /నమస్కారం\. ఎలా ఉన్నావు\?/);
  assert.doesNotMatch(closeOpening, /నమస్కారం అండి/);
  assert.match(closeOpening, /until the learner replies/);
  assert.match(closeOpening, /mayuEnglish "Hello\. How are you\?"/);
  assert.doesNotMatch(closeOpening, /have-you-eaten/);
  assert.match(respectfulOpening, /నమస్కారం అండి\. ఎలా ఉన్నారు\?/);
  assert.doesNotMatch(respectfulOpening, /have-you-eaten/);
});

test("opens every Live situation with a greeting before its scenario", () => {
  for (const scenarioId of ["family-check-in", "at-the-table", "when-stuck"]) {
    const scenario = getLiveScenario(scenarioId);
    assert.ok(scenario);

    for (const relationship of ["close", "respectful"]) {
      const opening = getLiveOpeningCue(scenario, relationship);
      const expectedGreeting = getLiveOpeningGreeting(relationship);

      assert.match(opening, /no learner has spoken yet/);
      assert.match(opening, new RegExp(expectedGreeting.telugu));
      assert.match(opening, /Do not repeat it or call present_turn/);
      assert.match(opening, /first microphone turn/);
      assert.doesNotMatch(opening, /continue with this situation/);

      const instruction = buildLiveSystemInstruction(scenario, {
        relationship,
        durationSeconds: 60,
      });
      assert.match(instruction, /New-session sequence/);
      assert.match(instruction, /Treat the first evidenced microphone turn/);
      assert.match(instruction, /Never infer a reply from silence, noise/);
      assert.match(instruction, /wait silently for the learner's answer/);
      assert.match(instruction, new RegExp(scenario.title));
      assert.match(instruction, new RegExp(expectedGreeting.telugu));
    }
  }
});

test("ships a valid 24 kHz PCM opening for each relationship", async () => {
  for (const relationship of ["close", "respectful"]) {
    const greeting = getLiveOpeningGreeting(relationship);
    const bytes = await readFile(
      new URL(`../public${greeting.audioSrc}`, import.meta.url),
    );
    const durationSeconds = bytes.length / 2 / 24_000;

    assert.equal(bytes.length % 2, 0);
    assert.ok(durationSeconds >= 1);
    assert.ok(durationSeconds <= 3);
  }
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

  const invalidDuration = await createLiveToken(
    new Request("https://practicaltelugu.example/api/practice-live/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://practicaltelugu.example",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        scenarioId: "family-check-in",
        relationship: "respectful",
        durationSeconds: 300,
      }),
    }),
  );
  assert.equal(invalidDuration.status, 400);
  assert.equal((await invalidDuration.json()).code, "invalid_duration");
});

test("mints resumable tokens with exact session headroom", async () => {
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
      // The initial connection plus one session-resumption reconnect.
      assert.equal(request.uses, 2);
      assert.equal(
        Date.parse(request.expireTime) - fixedNow,
        (durationSeconds + 70) * 1_000,
      );
      // Resumption after a mid-session drop needs the new-session window to
      // last as long as the token itself.
      assert.equal(request.newSessionExpireTime, request.expireTime);
      assert.equal(payload.sessionLimitSeconds, durationSeconds);
      assert.equal(payload.tokenExpiresAt, request.expireTime);
      assert.equal(payload.voiceMode, undefined);
      assert.equal(payload.voiceAccessToken, undefined);
      assert.equal(payload.familyVoice, undefined);
      assert.equal(typeof payload.assessmentAccessToken, "string");
      assert.ok(payload.assessmentAccessToken.length > 0);
    }

    assert.equal(tokenRequests.length, 2);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
});
