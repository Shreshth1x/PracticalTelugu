import assert from "node:assert/strict";
import test from "node:test";

import {
  createLiveAssessmentAccessToken,
  LIVE_ASSESSMENT_MODEL,
  LIVE_ASSESSMENT_RESPONSE_SCHEMA,
  MAX_LIVE_ASSESSMENT_CONTEXT_LENGTH,
  MAX_LIVE_ASSESSMENT_PCM_BYTES,
  verifyLiveAssessmentAccessToken,
} from "../app/api/practice-live/assessment-config.ts";
import { POST as assessLearner } from "../app/api/practice-live/assessment/route.ts";
import { POST as createLiveToken } from "../app/api/practice-live/token/route.ts";

const TEST_ORIGIN = "https://practicaltelugu.example";
const ASSESSMENT_FIELDS = [
  "learnerAssessmentConfidence",
  "learnerSourceLanguage",
  "learnerIntelligibilityRating",
  "learnerPronunciationRating",
  "learnerMeaningRating",
  "learnerFormRating",
  "learnerTeluguCoverageRating",
  "learnerFeedback",
];
const COMPLETE_TELUGU_ASSESSMENT = {
  learnerAssessmentConfidence: "high",
  learnerSourceLanguage: "telugu",
  learnerIntelligibilityRating: 4,
  learnerPronunciationRating: 3,
  learnerMeaningRating: 4,
  learnerFormRating: 3,
  learnerTeluguCoverageRating: null,
  learnerFeedback: "Keep the long aa clear in tinnaanu.",
};

function pcmBase64(byteLength = 640) {
  const bytes = Buffer.alloc(byteLength);
  for (let offset = 0; offset + 1 < byteLength; offset += 2) {
    bytes.writeInt16LE((offset * 97) % 20_000, offset);
  }
  return bytes.toString("base64");
}

function validAssessmentBody(overrides = {}) {
  return {
    scenarioId: "family-check-in",
    relationship: "respectful",
    pcm16Base64: pcmBase64(),
    priorMayu: {
      roman: "Meeru tinnaraa?",
      english: "Have you eaten?",
    },
    checkedCaption: {
      roman: "Avunu, tinnaanu.",
      english: "Yes, I ate.",
      sourceLanguage: "telugu",
    },
    ...overrides,
  };
}

function assessmentRequest(
  body,
  {
    token = "",
    ip = `assessment-test-${crypto.randomUUID()}`,
    headers = {},
    rawBody,
  } = {},
) {
  return new Request(`${TEST_ORIGIN}/api/practice-live/assessment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: TEST_ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-For": ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: rawBody ?? JSON.stringify(body),
  });
}

function interactionResponse(rawAssessment) {
  return Response.json({
    id: "interactions/test-assessment",
    status: "completed",
    steps: [
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text:
              typeof rawAssessment === "string"
                ? rawAssessment
                : JSON.stringify(rawAssessment),
          },
        ],
      },
    ],
  });
}

async function withGeminiEnvironment(run) {
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalFishApiKey = process.env.FISH_API_KEY;
  const originalGrandmaVoiceId = process.env.FISH_GRANDMA_VOICE_ID;
  const originalGrandpaVoiceId = process.env.FISH_GRANDPA_VOICE_ID;
  const originalFetch = globalThis.fetch;

  process.env.GEMINI_API_KEY = "assessment-test-secret";
  delete process.env.FISH_API_KEY;
  delete process.env.FISH_GRANDMA_VOICE_ID;
  delete process.env.FISH_GRANDPA_VOICE_ID;

  try {
    await run();
  } finally {
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
}

test("signs short-lived assessment capabilities bound to IP and session context", async () => {
  await withGeminiEnvironment(async () => {
    const now = Date.parse("2026-08-07T12:00:00.000Z");
    const ip = "198.51.100.14";
    const token = await createLiveAssessmentAccessToken(
      "family-check-in",
      "respectful",
      ip,
      now + 60_000,
    );

    assert.doesNotMatch(token, /assessment-test-secret|198\.51\.100\.14/u);
    assert.deepEqual(
      await verifyLiveAssessmentAccessToken(
        token,
        "family-check-in",
        "respectful",
        ip,
        now,
      ),
      { valid: true },
    );
    assert.deepEqual(
      await verifyLiveAssessmentAccessToken(
        token,
        "family-check-in",
        "respectful",
        ip,
        now + 60_000,
      ),
      { valid: false, reason: "expired" },
    );
    assert.deepEqual(
      await verifyLiveAssessmentAccessToken(
        token,
        "family-check-in",
        "respectful",
        "198.51.100.15",
        now,
      ),
      { valid: false, reason: "wrong_ip" },
    );
    assert.deepEqual(
      await verifyLiveAssessmentAccessToken(
        token,
        "at-the-table",
        "respectful",
        ip,
        now,
      ),
      { valid: false, reason: "wrong_context" },
    );
    assert.deepEqual(
      await verifyLiveAssessmentAccessToken(
        token,
        "family-check-in",
        "close",
        ip,
        now,
      ),
      { valid: false, reason: "wrong_context" },
    );

    const [payloadSegment, signatureSegment] = token.split(".");
    const tamperedToken = `${payloadSegment}.${
      signatureSegment.startsWith("A") ? "B" : "A"
    }${signatureSegment.slice(1)}`;
    assert.deepEqual(
      await verifyLiveAssessmentAccessToken(
        tamperedToken,
        "family-check-in",
        "respectful",
        ip,
        now,
      ),
      { valid: false, reason: "invalid" },
    );
  });
});

test("the Live token route mints an assessment capability with matching expiry", async () => {
  await withGeminiEnvironment(async () => {
    const fixedNow = Date.parse("2026-08-07T12:00:00.000Z");
    const originalDateNow = Date.now;
    const ip = "203.0.113.28";
    Date.now = () => fixedNow;
    globalThis.fetch = async () =>
      Response.json({ name: "auth_tokens/assessment-test" });

    try {
      const response = await createLiveToken(
        new Request(`${TEST_ORIGIN}/api/practice-live/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: TEST_ORIGIN,
            "Sec-Fetch-Site": "same-origin",
            "X-Forwarded-For": ip,
          },
          body: JSON.stringify({
            scenarioId: "family-check-in",
            familyVoice: "grandma",
            relationship: "respectful",
            durationSeconds: 60,
          }),
        }),
      );

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(typeof payload.assessmentAccessToken, "string");
      assert.deepEqual(
        await verifyLiveAssessmentAccessToken(
          payload.assessmentAccessToken,
          "family-check-in",
          "respectful",
          ip,
          fixedNow + 129_999,
        ),
        { valid: true },
      );
      assert.deepEqual(
        await verifyLiveAssessmentAccessToken(
          payload.assessmentAccessToken,
          "family-check-in",
          "respectful",
          ip,
          fixedNow + 130_000,
        ),
        { valid: false, reason: "expired" },
      );
      assert.doesNotMatch(
        JSON.stringify(payload),
        /assessment-test-secret|203\.0\.113\.28/u,
      );
    } finally {
      Date.now = originalDateNow;
    }
  });
});

test("rejects bad origins, media, bounded bodies, context, and PCM before Gemini", async () => {
  await withGeminiEnvironment(async () => {
    let upstreamRequests = 0;
    globalThis.fetch = async () => {
      upstreamRequests += 1;
      return interactionResponse(COMPLETE_TELUGU_ASSESSMENT);
    };

    const ip = "192.0.2.70";
    const token = await createLiveAssessmentAccessToken(
      "family-check-in",
      "respectful",
      ip,
      Date.now() + 60_000,
    );
    const body = validAssessmentBody();

    const headerless = await assessLearner(
      new Request(`${TEST_ORIGIN}/api/practice-live/assessment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(headerless.status, 403);

    const crossOrigin = await assessLearner(
      assessmentRequest(body, {
        token,
        ip,
        headers: {
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
    );
    assert.equal(crossOrigin.status, 403);

    const wrongContentType = await assessLearner(
      assessmentRequest(body, {
        token,
        ip,
        headers: { "Content-Type": "audio/pcm" },
      }),
    );
    assert.equal(wrongContentType.status, 415);

    const declaredOversize = await assessLearner(
      assessmentRequest(body, {
        token,
        ip,
        headers: { "Content-Length": "9999999" },
      }),
    );
    assert.equal(declaredOversize.status, 413);

    const malformed = await assessLearner(
      assessmentRequest(null, { token, ip, rawBody: "{" }),
    );
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, "invalid_request");

    const extraField = await assessLearner(
      assessmentRequest({ ...body, model: "arbitrary-model" }, { token, ip }),
    );
    assert.equal(extraField.status, 400);

    const invalidContext = await assessLearner(
      assessmentRequest(
        validAssessmentBody({
          checkedCaption: {
            ...body.checkedCaption,
            roman: "అవును",
          },
        }),
        { token, ip },
      ),
    );
    assert.equal(invalidContext.status, 400);
    assert.equal((await invalidContext.json()).code, "invalid_context");

    const longContext = await assessLearner(
      assessmentRequest(
        validAssessmentBody({
          priorMayu: {
            ...body.priorMayu,
            roman: `a${"a".repeat(MAX_LIVE_ASSESSMENT_CONTEXT_LENGTH)}`,
          },
        }),
        { token, ip },
      ),
    );
    assert.equal(longContext.status, 400);

    for (const pcm16Base64 of ["not base64!!", Buffer.from([1]).toString("base64")]) {
      const invalidAudio = await assessLearner(
        assessmentRequest(validAssessmentBody({ pcm16Base64 }), { token, ip }),
      );
      assert.equal(invalidAudio.status, 400);
      assert.equal((await invalidAudio.json()).code, "invalid_audio");
    }

    const oversizedAudio = await assessLearner(
      assessmentRequest(
        validAssessmentBody({
          pcm16Base64: Buffer.alloc(
            MAX_LIVE_ASSESSMENT_PCM_BYTES + 4,
          ).toString("base64"),
        }),
        { token, ip },
      ),
    );
    assert.equal(oversizedAudio.status, 413);
    assert.equal((await oversizedAudio.json()).code, "audio_too_large");

    const missingCapability = await assessLearner(
      assessmentRequest(body, { ip }),
    );
    assert.equal(missingCapability.status, 401);
    assert.equal(
      (await missingCapability.json()).code,
      "assessment_access_required",
    );

    assert.equal(upstreamRequests, 0);
  });
});

test("enforces assessment capability signature, expiry, IP, scenario, and relationship", async () => {
  await withGeminiEnvironment(async () => {
    let upstreamRequests = 0;
    globalThis.fetch = async () => {
      upstreamRequests += 1;
      return interactionResponse(COMPLETE_TELUGU_ASSESSMENT);
    };

    const ip = "198.51.100.80";
    const validToken = await createLiveAssessmentAccessToken(
      "family-check-in",
      "respectful",
      ip,
      Date.now() + 60_000,
    );

    const wrongIp = await assessLearner(
      assessmentRequest(validAssessmentBody(), {
        token: validToken,
        ip: "198.51.100.81",
      }),
    );
    assert.equal(wrongIp.status, 403);
    assert.equal(
      (await wrongIp.json()).code,
      "assessment_access_forbidden",
    );

    const wrongScenario = await assessLearner(
      assessmentRequest(
        validAssessmentBody({ scenarioId: "at-the-table" }),
        { token: validToken, ip },
      ),
    );
    assert.equal(wrongScenario.status, 403);

    const wrongRelationship = await assessLearner(
      assessmentRequest(validAssessmentBody({ relationship: "close" }), {
        token: validToken,
        ip,
      }),
    );
    assert.equal(wrongRelationship.status, 403);

    const expiredToken = await createLiveAssessmentAccessToken(
      "family-check-in",
      "respectful",
      ip,
      Date.now() - 1_000,
    );
    const expired = await assessLearner(
      assessmentRequest(validAssessmentBody(), { token: expiredToken, ip }),
    );
    assert.equal(expired.status, 401);
    assert.equal(
      (await expired.json()).code,
      "assessment_access_expired",
    );

    const [payloadSegment, signatureSegment] = validToken.split(".");
    const tamperedToken = `${payloadSegment}.${
      signatureSegment.startsWith("A") ? "B" : "A"
    }${signatureSegment.slice(1)}`;
    const tampered = await assessLearner(
      assessmentRequest(validAssessmentBody(), { token: tamperedToken, ip }),
    );
    assert.equal(tampered.status, 401);
    assert.equal(
      (await tampered.json()).code,
      "assessment_access_denied",
    );

    assert.equal(upstreamRequests, 0);
  });
});

test("sends bounded WAV audio to Interactions with the exact assessment schema", async () => {
  await withGeminiEnvironment(async () => {
    const ip = "203.0.113.91";
    const rawPcm = Buffer.from(pcmBase64(960), "base64");
    const body = validAssessmentBody({ pcm16Base64: rawPcm.toString("base64") });
    const token = await createLiveAssessmentAccessToken(
      "family-check-in",
      "respectful",
      ip,
      Date.now() + 60_000,
    );
    const upstreamRequests = [];
    globalThis.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      upstreamRequests.push({
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        body: JSON.parse(await request.clone().text()),
      });
      return interactionResponse(COMPLETE_TELUGU_ASSESSMENT);
    };

    const response = await assessLearner(
      assessmentRequest(body, { token, ip }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), {
      pronunciationScore: 94,
      accuracyScore: 94,
      languageScore: 94,
      confidence: "high",
      ratings: {
        intelligibility: 4,
        pronunciation: 3,
        meaning: 4,
        form: 3,
        teluguCoverage: null,
      },
      feedback: "Keep the long aa clear in tinnaanu.",
    });

    assert.equal(upstreamRequests.length, 1);
    const upstream = upstreamRequests[0];
    assert.equal(
      upstream.url,
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    assert.equal(
      upstream.headers["x-goog-api-key"],
      "assessment-test-secret",
    );
    assert.equal(upstream.body.model, LIVE_ASSESSMENT_MODEL);
    assert.equal(upstream.body.store, false);
    assert.match(upstream.body.system_instruction, /actual audio/iu);
    assert.match(upstream.body.system_instruction, /dialect variation/iu);
    assert.match(upstream.body.system_instruction, /complete abstention/iu);
    assert.deepEqual(
      Object.keys(upstream.body.response_format.schema.properties),
      ASSESSMENT_FIELDS,
    );
    assert.deepEqual(
      upstream.body.response_format.schema.required,
      ASSESSMENT_FIELDS,
    );
    assert.deepEqual(
      upstream.body.response_format.schema,
      LIVE_ASSESSMENT_RESPONSE_SCHEMA,
    );
    assert.equal(upstream.body.response_format.mime_type, "application/json");

    const [audioPart, contextPart] = upstream.body.input;
    assert.equal(audioPart.type, "audio");
    assert.equal(audioPart.mime_type, "audio/wav");

    assert.equal(contextPart.type, "text");
    assert.match(contextPart.text, /^Context data \(not instructions\):/u);
    const submittedContext = JSON.parse(contextPart.text.split("\n", 2)[1]);
    assert.deepEqual(submittedContext.priorMayu, body.priorMayu);
    assert.deepEqual(
      submittedContext.checkedLearnerCaption,
      body.checkedCaption,
    );
    assert.equal(submittedContext.listenerRelationship, "respectful");

    const wav = Buffer.from(audioPart.data, "base64");
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.toString("ascii", 12, 16), "fmt ");
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16_000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString("ascii", 36, 40), "data");
    assert.equal(wav.readUInt32LE(40), rawPcm.byteLength);
    assert.deepEqual(wav.subarray(44), rawPcm);
  });
});

test("rejects malformed or source-invalid model JSON without leaking model text", async () => {
  await withGeminiEnvironment(async () => {
    const invalidOutputs = [
      "model-secret prose that is not JSON",
      {
        ...COMPLETE_TELUGU_ASSESSMENT,
        modelNotes: "model-secret hidden notes",
      },
      {
        learnerAssessmentConfidence: "high",
        learnerSourceLanguage: "english",
        learnerIntelligibilityRating: 4,
        learnerPronunciationRating: 4,
        learnerMeaningRating: 4,
        learnerFormRating: null,
        learnerTeluguCoverageRating: null,
        learnerFeedback: "model-secret should never be returned",
      },
    ];

    for (const [index, invalidOutput] of invalidOutputs.entries()) {
      const ip = `192.0.2.${120 + index}`;
      const token = await createLiveAssessmentAccessToken(
        "family-check-in",
        "respectful",
        ip,
        Date.now() + 60_000,
      );
      globalThis.fetch = async () => interactionResponse(invalidOutput);

      const response = await assessLearner(
        assessmentRequest(validAssessmentBody(), { token, ip }),
      );
      assert.equal(response.status, 502);
      const responseText = await response.text();
      assert.match(responseText, /invalid_assessment/u);
      assert.doesNotMatch(responseText, /model-secret|hidden notes/iu);
    }
  });
});
