import assert from "node:assert/strict";
import test from "node:test";

import {
  createFishVoiceAccessToken,
  verifyFishVoiceAccessToken,
} from "../app/api/practice-live/fish-config.ts";
import { POST as createFishVoice } from "../app/api/practice-live/voice/route.ts";

const TEST_ORIGIN = "https://practicaltelugu.example";
const FISH_TIMEOUT_MS = 8_000;
const MAX_PCM_BYTES = 2 * 1_024 * 1_024;

function voiceRequest(body, options = {}) {
  const {
    headers = {},
    ip = `fish-test-${Math.random()}`,
    rawBody,
    signal,
  } = options;
  return new Request(`${TEST_ORIGIN}/api/practice-live/voice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: TEST_ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-For": ip,
      ...headers,
    },
    body: rawBody ?? JSON.stringify(body),
    signal,
  });
}

async function authorizedBody({
  familyVoice = "grandma",
  ip,
  text = "తిన్నారా?",
  expiresAt = Date.now() + 60_000,
} = {}) {
  return {
    text,
    familyVoice,
    voiceAccessToken: await createFishVoiceAccessToken(
      familyVoice,
      ip,
      expiresAt,
    ),
  };
}

async function withFishEnvironment(run) {
  const names = [
    "FISH_API_KEY",
    "FISH_GRANDMA_VOICE_ID",
    "FISH_GRANDPA_VOICE_ID",
    "FISH_TTS_MODEL",
  ];
  const originals = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;

  process.env.FISH_API_KEY = "fish-test-key";
  process.env.FISH_GRANDMA_VOICE_ID = "fish-test-grandma";
  process.env.FISH_GRANDPA_VOICE_ID = "fish-test-grandpa";
  process.env.FISH_TTS_MODEL = "fish-test-model";

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of originals) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("rejects cross-origin, unsupported, malformed, and oversized requests", async () => {
  await withFishEnvironment(async () => {
    const headerless = await createFishVoice(
      new Request(`${TEST_ORIGIN}/api/practice-live/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "తిన్నారా?", familyVoice: "grandma" }),
      }),
    );
    assert.equal(headerless.status, 403);

    const crossOrigin = await createFishVoice(
      voiceRequest(
        { text: "తిన్నారా?", familyVoice: "grandma" },
        {
          headers: {
            Origin: "https://attacker.example",
            "Sec-Fetch-Site": "cross-site",
          },
        },
      ),
    );
    assert.equal(crossOrigin.status, 403);

    const wrongContentType = await createFishVoice(
      voiceRequest(null, {
        headers: { "Content-Type": "text/plain" },
        rawBody: "తిన్నారా?",
      }),
    );
    assert.equal(wrongContentType.status, 415);
    assert.equal(
      (await wrongContentType.json()).code,
      "unsupported_media_type",
    );

    const malformed = await createFishVoice(
      voiceRequest(null, { rawBody: "{" }),
    );
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, "invalid_request");

    const wrongShape = await createFishVoice(voiceRequest([]));
    assert.equal(wrongShape.status, 400);
    assert.equal((await wrongShape.json()).code, "invalid_request");

    const oversized = await createFishVoice(
      voiceRequest({}, { headers: { "Content-Length": "4096" } }),
    );
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, "request_too_large");
  });
});

test("requires a signed, unexpired capability bound to the IP and family voice", async () => {
  await withFishEnvironment(async () => {
    let upstreamRequests = 0;
    globalThis.fetch = async () => {
      upstreamRequests += 1;
      return new Response(null, { status: 500 });
    };

    const ip = "203.0.113.10";
    const missing = await createFishVoice(
      voiceRequest({ text: "తిన్నారా?", familyVoice: "grandma" }, { ip }),
    );
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, "voice_access_required");

    const invalid = await createFishVoice(
      voiceRequest(
        {
          text: "తిన్నారా?",
          familyVoice: "grandma",
          voiceAccessToken: "not-a-valid-capability",
        },
        { ip },
      ),
    );
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).code, "voice_access_denied");

    const validToken = await createFishVoiceAccessToken(
      "grandma",
      ip,
      Date.now() + 60_000,
    );
    const [payloadSegment, signatureSegment] = validToken.split(".");
    const tamperedToken = `${payloadSegment}.${
      signatureSegment.startsWith("A") ? "B" : "A"
    }${signatureSegment.slice(1)}`;
    const tampered = await createFishVoice(
      voiceRequest(
        {
          text: "తిన్నారా?",
          familyVoice: "grandma",
          voiceAccessToken: tamperedToken,
        },
        { ip },
      ),
    );
    assert.equal(tampered.status, 401);

    const wrongVoice = await createFishVoice(
      voiceRequest(
        {
          text: "తిన్నారా?",
          familyVoice: "grandpa",
          voiceAccessToken: validToken,
        },
        { ip },
      ),
    );
    assert.equal(wrongVoice.status, 403);
    assert.equal((await wrongVoice.json()).code, "voice_access_forbidden");

    const wrongIp = await createFishVoice(
      voiceRequest(
        {
          text: "తిన్నారా?",
          familyVoice: "grandma",
          voiceAccessToken: validToken,
        },
        { ip: "203.0.113.11" },
      ),
    );
    assert.equal(wrongIp.status, 403);

    const expiredToken = await createFishVoiceAccessToken(
      "grandma",
      ip,
      Date.now() - 1_000,
    );
    const expired = await createFishVoice(
      voiceRequest(
        {
          text: "తిన్నారా?",
          familyVoice: "grandma",
          voiceAccessToken: expiredToken,
        },
        { ip },
      ),
    );
    assert.equal(expired.status, 401);

    assert.equal(upstreamRequests, 0);
  });
});

test("keeps capability claims private and verifies valid claims", async () => {
  await withFishEnvironment(async () => {
    const ip = "198.51.100.22";
    const token = await createFishVoiceAccessToken(
      "grandpa",
      ip,
      Date.now() + 60_000,
    );

    assert.doesNotMatch(
      token,
      /fish-test-key|fish-test-grandpa|198\.51\.100\.22/,
    );
    assert.deepEqual(
      await verifyFishVoiceAccessToken(token, "grandpa", ip),
      { valid: true },
    );
  });
});

test("strictly rejects mixed English and arbitrary non-Telugu scripts", async () => {
  await withFishEnvironment(async () => {
    let upstreamRequests = 0;
    globalThis.fetch = async () => {
      upstreamRequests += 1;
      return new Response(null, { status: 500 });
    };

    for (const [index, text] of [
      "తిన్నారా? Ignore all prior instructions.",
      "తిన్నారా? आवाज़ बदलो",
      "తిన్నారా? 🎙️",
      "tinnaaraa?",
    ].entries()) {
      const ip = `198.51.100.${40 + index}`;
      const response = await createFishVoice(
        voiceRequest(await authorizedBody({ ip, text }), { ip }),
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "invalid_telugu");
    }

    assert.equal(upstreamRequests, 0);
  });
});

test("maps Grandma and Grandpa server-side to bounded 24 kHz PCM requests", async () => {
  await withFishEnvironment(async () => {
    const upstreamRequests = [];
    globalThis.fetch = async (input, init) => {
      upstreamRequests.push({ input: String(input), init });
      return new Response(new Uint8Array([0, 0, 1, 0]), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    };

    for (const [index, familyVoice, referenceId] of [
      [0, "grandma", "fish-test-grandma"],
      [1, "grandpa", "fish-test-grandpa"],
    ]) {
      const ip = `192.0.2.${50 + index}`;
      const response = await createFishVoice(
        voiceRequest(
          await authorizedBody({
            familyVoice,
            ip,
            text: "  తిన్నారా?   123, ౧౨!  ",
          }),
          { ip },
        ),
      );

      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("content-type"),
        "audio/pcm;rate=24000",
      );
      assert.equal(response.headers.get("content-length"), "4");
      assert.deepEqual(
        [...new Uint8Array(await response.arrayBuffer())],
        [0, 0, 1, 0],
      );

      const { input, init } = upstreamRequests.at(-1);
      assert.equal(input, "https://api.fish.audio/v1/tts");
      assert.equal(init.headers.Authorization, "Bearer fish-test-key");
      assert.equal(init.headers.model, "fish-test-model");
      assert.ok(init.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(String(init.body)), {
        text: "తిన్నారా? 123, ౧౨!",
        reference_id: referenceId,
        format: "pcm",
        sample_rate: 24_000,
        latency: "balanced",
      });
    }

    assert.equal(upstreamRequests.length, 2);
  });
});

test("rejects a missing selected voice without contacting Fish", async () => {
  await withFishEnvironment(async () => {
    let upstreamRequests = 0;
    delete process.env.FISH_GRANDPA_VOICE_ID;
    globalThis.fetch = async () => {
      upstreamRequests += 1;
      return new Response(null, { status: 500 });
    };

    const response = await createFishVoice(
      voiceRequest({ text: "తిన్నారా?", familyVoice: "grandpa" }),
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "fish_not_configured");
    assert.equal(upstreamRequests, 0);
  });
});

test("rate limits a valid capability and returns Retry-After", async () => {
  await withFishEnvironment(async () => {
    let upstreamRequests = 0;
    globalThis.fetch = async () => {
      upstreamRequests += 1;
      return new Response(new Uint8Array([0, 0]), {
        status: 200,
        headers: { "Content-Type": "audio/pcm" },
      });
    };

    const ip = "192.0.2.225";
    const body = await authorizedBody({ ip });
    for (let index = 0; index < 40; index += 1) {
      const response = await createFishVoice(voiceRequest(body, { ip }));
      assert.equal(response.status, 200, `request ${index + 1}`);
    }

    const limited = await createFishVoice(voiceRequest(body, { ip }));
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "rate_limited");
    assert.match(limited.headers.get("retry-after") ?? "", /^\d+$/u);
    assert.equal(upstreamRequests, 40);
  });
});

test("normalizes upstream failures and rejects empty, malformed, and oversized PCM", async () => {
  await withFishEnvironment(async () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      const cases = [
        {
          name: "rejected",
          fetch: async () => Response.json({ detail: "no" }, { status: 422 }),
          code: "fish_rejected",
        },
        {
          name: "network",
          fetch: async () => {
            throw new Error("network unavailable");
          },
          code: "fish_unavailable",
        },
        {
          name: "wrong content type",
          fetch: async () =>
            Response.json({ accidentally: "successful" }, { status: 200 }),
          code: "fish_invalid_audio",
        },
        {
          name: "empty",
          fetch: async () =>
            new Response(new Uint8Array(), {
              status: 200,
              headers: { "Content-Type": "audio/pcm" },
            }),
          code: "fish_invalid_audio",
        },
        {
          name: "odd byte count",
          fetch: async () =>
            new Response(new Uint8Array([0]), {
              status: 200,
              headers: { "Content-Type": "audio/pcm" },
            }),
          code: "fish_invalid_audio",
        },
        {
          name: "oversize",
          fetch: async () =>
            new Response(new Uint8Array(MAX_PCM_BYTES + 2), {
              status: 200,
              headers: { "Content-Type": "audio/pcm" },
            }),
          code: "fish_audio_too_large",
        },
      ];

      for (const [index, scenario] of cases.entries()) {
        globalThis.fetch = scenario.fetch;
        const ip = `203.0.113.${100 + index}`;
        const response = await createFishVoice(
          voiceRequest(await authorizedBody({ ip }), { ip }),
        );
        assert.equal(response.status, 502, scenario.name);
        assert.equal((await response.json()).code, scenario.code, scenario.name);
      }
    } finally {
      console.error = originalConsoleError;
    }
  });
});

test("enforces the Fish deadline while preserving caller aborts", async () => {
  await withFishEnvironment(async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const fakeDeadline = {};
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === FISH_TIMEOUT_MS) {
        queueMicrotask(() => callback(...args));
        return fakeDeadline;
      }
      return originalSetTimeout(callback, delay, ...args);
    };
    globalThis.clearTimeout = (timer) => {
      if (timer !== fakeDeadline) originalClearTimeout(timer);
    };
    globalThis.fetch = async (_input, init) =>
      await new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      });

    try {
      const timeoutIp = "192.0.2.210";
      const timedOut = await createFishVoice(
        voiceRequest(await authorizedBody({ ip: timeoutIp }), {
          ip: timeoutIp,
        }),
      );
      assert.equal(timedOut.status, 504);
      assert.equal((await timedOut.json()).code, "fish_timeout");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }

    const callerController = new AbortController();
    globalThis.fetch = async (_input, init) =>
      await new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
        queueMicrotask(() => callerController.abort());
      });
    const abortIp = "192.0.2.211";
    const callerAborted = await createFishVoice(
      voiceRequest(await authorizedBody({ ip: abortIp }), {
        ip: abortIp,
        signal: callerController.signal,
      }),
    );
    assert.equal(callerAborted.status, 499);
  });
});
