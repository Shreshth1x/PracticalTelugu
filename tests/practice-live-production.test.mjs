import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { verifyFishVoiceAccessToken } from "../app/api/practice-live/fish-config.ts";
import { POST as createLiveToken } from "../app/api/practice-live/token/route.ts";
import { FISH_AUTH_TIMEOUT_MS } from "../app/api/practice-live/fish-authorization.ts";
import {
  buildLiveConnectConfig,
  buildLiveSystemInstruction,
  isLiveFamilyVoice,
  isLiveListenerRelationship,
  isLiveSessionDuration,
} from "../app/practice-live/live-config.ts";
import {
  getLiveOpeningCue,
  getLiveScenario,
} from "../app/practice-live/live-scenarios.ts";

const familyScenario = getLiveScenario("family-check-in");
assert.ok(familyScenario);

test("validates family voices, relationships, and session durations", () => {
  assert.equal(isLiveFamilyVoice("grandma"), true);
  assert.equal(isLiveFamilyVoice("grandpa"), true);
  assert.equal(isLiveFamilyVoice("aunt"), false);
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
        familyVoice: "grandma",
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
        familyVoice: "grandma",
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
        familyVoice: "grandma",
        relationship: "formal",
        durationSeconds: 60,
      }),
    }),
  );
  assert.equal(invalidRelationship.status, 400);
  assert.equal((await invalidRelationship.json()).code, "invalid_relationship");

  const invalidFamilyVoice = await createLiveToken(
    new Request("https://practicaltelugu.example/api/practice-live/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://practicaltelugu.example",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        scenarioId: "family-check-in",
        familyVoice: "aunt",
        relationship: "respectful",
        durationSeconds: 60,
      }),
    }),
  );
  assert.equal(invalidFamilyVoice.status, 400);
  assert.equal(
    (await invalidFamilyVoice.json()).code,
    "invalid_family_voice",
  );
});

test("mints one-use tokens with exact connection and session headroom", async () => {
  const fixedNow = Date.parse("2026-08-02T12:00:00.000Z");
  const originalDateNow = Date.now;
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalFishApiKey = process.env.FISH_API_KEY;
  const originalGrandmaVoiceId = process.env.FISH_GRANDMA_VOICE_ID;
  const originalGrandpaVoiceId = process.env.FISH_GRANDPA_VOICE_ID;
  const tokenRequests = [];

  Date.now = () => fixedNow;
  process.env.GEMINI_API_KEY = "test-only-key";
  delete process.env.FISH_API_KEY;
  delete process.env.FISH_GRANDMA_VOICE_ID;
  delete process.env.FISH_GRANDPA_VOICE_ID;
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
              familyVoice: durationSeconds === 60 ? "grandma" : "grandpa",
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
      assert.equal(payload.voiceMode, "gemini");
      assert.equal(payload.voiceModeReason, "not_configured");
      assert.equal(payload.voiceAccessToken, undefined);
      assert.equal(
        payload.familyVoice,
        durationSeconds === 60 ? "grandma" : "grandpa",
      );
    }

    assert.equal(tokenRequests.length, 2);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
    if (originalFishApiKey === undefined) delete process.env.FISH_API_KEY;
    else process.env.FISH_API_KEY = originalFishApiKey;
    if (originalGrandmaVoiceId === undefined)
      delete process.env.FISH_GRANDMA_VOICE_ID;
    else process.env.FISH_GRANDMA_VOICE_ID = originalGrandmaVoiceId;
    if (originalGrandpaVoiceId === undefined)
      delete process.env.FISH_GRANDPA_VOICE_ID;
    else process.env.FISH_GRANDPA_VOICE_ID = originalGrandpaVoiceId;
  }
});

test("enables Fish only for an allowlisted signed-in owner and configured voice", async () => {
  const fixedNow = Date.parse("2026-08-02T12:00:00.000Z");
  const ownerEmail = "owner@example.com";
  const originalDateNow = Date.now;
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalFishApiKey = process.env.FISH_API_KEY;
  const originalGrandmaVoiceId = process.env.FISH_GRANDMA_VOICE_ID;
  const originalGrandpaVoiceId = process.env.FISH_GRANDPA_VOICE_ID;
  const originalAllowedEmailHash = process.env.FISH_ALLOWED_EMAIL_SHA256;

  Date.now = () => fixedNow;
  process.env.GEMINI_API_KEY = "test-only-key";
  process.env.FISH_API_KEY = "server-only-fish-key";
  process.env.FISH_GRANDMA_VOICE_ID = "server-only-grandma-id";
  process.env.FISH_ALLOWED_EMAIL_SHA256 = createHash("sha256")
    .update(ownerEmail)
    .digest("hex");
  delete process.env.FISH_GRANDPA_VOICE_ID;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/auth/v1/user")) {
      assert.equal(init?.headers?.Authorization, "Bearer owner-access-token");
      return Response.json({ email: ownerEmail });
    }
    return Response.json({ name: "auth_tokens/family-voice-test" });
  };

  try {
    for (const [familyVoice, expectedMode] of [
      ["grandma", "fish"],
      ["grandpa", "gemini"],
    ]) {
      const response = await createLiveToken(
        new Request(
          "https://practicaltelugu.example/api/practice-live/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://practicaltelugu.example",
              "Sec-Fetch-Site": "same-origin",
              "X-Forwarded-For": `family-voice-mode-${familyVoice}`,
              Authorization: "Bearer owner-access-token",
            },
            body: JSON.stringify({
              scenarioId: "family-check-in",
              familyVoice,
              relationship: "respectful",
              durationSeconds: 60,
            }),
          },
        ),
      );

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.familyVoice, familyVoice);
      assert.equal(payload.voiceMode, expectedMode);
      assert.equal(
        payload.voiceModeReason,
        expectedMode === "fish" ? "authorized" : "not_configured",
      );
      if (expectedMode === "fish") {
        assert.equal(typeof payload.voiceAccessToken, "string");
        assert.deepEqual(
          await verifyFishVoiceAccessToken(
            payload.voiceAccessToken,
            familyVoice,
            `family-voice-mode-${familyVoice}`,
            fixedNow + 129_999,
          ),
          { valid: true },
        );
        assert.deepEqual(
          await verifyFishVoiceAccessToken(
            payload.voiceAccessToken,
            familyVoice,
            `family-voice-mode-${familyVoice}`,
            fixedNow + 130_000,
          ),
          { valid: false, reason: "expired" },
        );
      } else {
        assert.equal(payload.voiceAccessToken, undefined);
      }
      assert.doesNotMatch(
        JSON.stringify(payload),
        /server-only-fish-key|server-only-grandma-id/,
      );
    }
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
    if (originalFishApiKey === undefined) delete process.env.FISH_API_KEY;
    else process.env.FISH_API_KEY = originalFishApiKey;
    if (originalGrandmaVoiceId === undefined)
      delete process.env.FISH_GRANDMA_VOICE_ID;
    else process.env.FISH_GRANDMA_VOICE_ID = originalGrandmaVoiceId;
    if (originalGrandpaVoiceId === undefined)
      delete process.env.FISH_GRANDPA_VOICE_ID;
    else process.env.FISH_GRANDPA_VOICE_ID = originalGrandpaVoiceId;
    if (originalAllowedEmailHash === undefined)
      delete process.env.FISH_ALLOWED_EMAIL_SHA256;
    else process.env.FISH_ALLOWED_EMAIL_SHA256 = originalAllowedEmailHash;
  }
});

test("fails private voice authorization closed without blocking public Gemini", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalFishApiKey = process.env.FISH_API_KEY;
  const originalGrandmaVoiceId = process.env.FISH_GRANDMA_VOICE_ID;
  const originalAllowedEmailHash = process.env.FISH_ALLOWED_EMAIL_SHA256;
  const ownerEmail = "owner@example.com";

  process.env.GEMINI_API_KEY = "test-only-key";
  process.env.FISH_API_KEY = "server-only-fish-key";
  process.env.FISH_GRANDMA_VOICE_ID = "server-only-grandma-id";
  process.env.FISH_ALLOWED_EMAIL_SHA256 = createHash("sha256")
    .update(ownerEmail)
    .digest("hex");

  const request = (ip, accessToken) =>
    new Request("https://practicaltelugu.example/api/practice-live/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://practicaltelugu.example",
        "Sec-Fetch-Site": "same-origin",
        "X-Forwarded-For": ip,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        scenarioId: "family-check-in",
        familyVoice: "grandma",
        relationship: "respectful",
        durationSeconds: 60,
      }),
    });

  try {
    for (const scenario of [
      {
        name: "anonymous",
        token: "",
        auth: "unused",
        reason: "signed_out",
      },
      {
        name: "unallowlisted",
        token: "other-token",
        auth: "other",
        reason: "not_allowlisted",
      },
      {
        name: "invalid",
        token: "invalid-token",
        auth: "invalid",
        reason: "signed_out",
      },
      {
        name: "auth-outage",
        token: "outage-token",
        auth: "outage",
        reason: "auth_unavailable",
      },
    ]) {
      globalThis.fetch = async (input) => {
        if (String(input).endsWith("/auth/v1/user")) {
          if (scenario.auth === "other") {
            return Response.json({ email: "other@example.com" });
          }
          if (scenario.auth === "invalid") {
            return Response.json({ message: "invalid token" }, { status: 401 });
          }
          throw new Error("Supabase unavailable");
        }
        return Response.json({ name: `auth_tokens/${scenario.name}` });
      };

      const response = await createLiveToken(
        request(`private-voice-${scenario.name}`, scenario.token),
      );
      assert.equal(response.status, 200, scenario.name);
      const payload = await response.json();
      assert.equal(payload.voiceMode, "gemini", scenario.name);
      assert.equal(payload.voiceModeReason, scenario.reason, scenario.name);
      assert.equal(payload.voiceAccessToken, undefined, scenario.name);
      assert.equal(typeof payload.token, "string", scenario.name);
    }

    delete process.env.FISH_ALLOWED_EMAIL_SHA256;
    globalThis.fetch = async (input) => {
      assert.doesNotMatch(String(input), /\/auth\/v1\/user$/u);
      return Response.json({ name: "auth_tokens/missing-allowlist" });
    };
    const missingAllowlist = await createLiveToken(
      request("private-voice-missing-allowlist", "owner-token"),
    );
    assert.equal(missingAllowlist.status, 200);
    const missingAllowlistPayload = await missingAllowlist.json();
    assert.equal(missingAllowlistPayload.voiceMode, "gemini");
    assert.equal(missingAllowlistPayload.voiceModeReason, "not_configured");

    process.env.FISH_ALLOWED_EMAIL_SHA256 = createHash("sha256")
      .update(ownerEmail)
      .digest("hex");

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const fakeDeadline = {};
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === FISH_AUTH_TIMEOUT_MS) {
        queueMicrotask(() => callback(...args));
        return fakeDeadline;
      }
      return originalSetTimeout(callback, delay, ...args);
    };
    globalThis.clearTimeout = (timer) => {
      if (timer !== fakeDeadline) originalClearTimeout(timer);
    };
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/auth/v1/user")) {
        return await new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          );
        });
      }
      return Response.json({ name: "auth_tokens/auth-timeout" });
    };
    try {
      const response = await createLiveToken(
        request("private-voice-auth-timeout", "hanging-token"),
      );
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.voiceMode, "gemini");
      assert.equal(payload.voiceModeReason, "auth_unavailable");
      assert.equal(payload.voiceAccessToken, undefined);
      assert.equal(typeof payload.token, "string");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
    if (originalFishApiKey === undefined) delete process.env.FISH_API_KEY;
    else process.env.FISH_API_KEY = originalFishApiKey;
    if (originalGrandmaVoiceId === undefined)
      delete process.env.FISH_GRANDMA_VOICE_ID;
    else process.env.FISH_GRANDMA_VOICE_ID = originalGrandmaVoiceId;
    if (originalAllowedEmailHash === undefined)
      delete process.env.FISH_ALLOWED_EMAIL_SHA256;
    else process.env.FISH_ALLOWED_EMAIL_SHA256 = originalAllowedEmailHash;
  }
});
