import { GoogleGenAI } from "@google/genai";
import { getPracticeLiveClientIp } from "../fish-config.ts";
import {
  decodeLiveAssessmentPcm16,
  LIVE_ASSESSMENT_MODEL,
  LIVE_ASSESSMENT_RESPONSE_SCHEMA,
  LIVE_ASSESSMENT_SYSTEM_INSTRUCTION,
  MAX_LIVE_ASSESSMENT_CONTEXT_LENGTH,
  MAX_LIVE_ASSESSMENT_PCM_BYTES,
  verifyLiveAssessmentAccessToken,
  wrapLiveAssessmentPcm16AsWav,
} from "../assessment-config.ts";
import { isLiveListenerRelationship } from "../../../practice-live/live-config.ts";
import { getLiveScenario } from "../../../practice-live/live-scenarios.ts";
import { parseLiveLearnerAssessment } from "../../../practice-live/live-transcript.ts";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES =
  Math.ceil(MAX_LIVE_ASSESSMENT_PCM_BYTES / 3) * 4 + 16_384;
const ASSESSMENT_TIMEOUT_MS = 20_000;
const SHORT_WINDOW_MS = 15 * 60 * 1_000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const SHORT_WINDOW_ASSESSMENTS = 120;
const DAILY_ASSESSMENTS = 400;
const TELUGU_SCRIPT = /[\u0c00-\u0c7f]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{Letter}/u;
const TOP_LEVEL_FIELDS = new Set([
  "scenarioId",
  "relationship",
  "pcm16Base64",
  "priorMayu",
  "checkedCaption",
]);
const PRIOR_MAYU_FIELDS = new Set(["roman", "english"]);
const CHECKED_CAPTION_FIELDS = new Set([
  "roman",
  "english",
  "sourceLanguage",
]);

type ValidatedContext = {
  priorMayu: {
    roman: string;
    english: string;
  };
  checkedCaption: {
    roman: string;
    english: string;
    sourceLanguage: "telugu" | "english" | "mixed";
  };
};

// This per-instance limiter supplements the signed short-lived capability and
// the token-route session limits. A durable platform quota remains the final
// layer before opening Practice Live assessment at public scale.
const assessmentsByForwardedIp = new Map<string, number[]>();

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...extraHeaders,
    },
  });
}

async function readBoundedBody(request: Request) {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    byteLength += value.byteLength;
    if (byteLength > MAX_REQUEST_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The 413 response still takes precedence if the sender already closed.
      }
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function isSameOriginRequest(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin && !fetchSite) return false;
  if (origin && origin !== expectedOrigin) return false;

  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyFields(
  value: Record<string, unknown>,
  allowedFields: Set<string>,
) {
  return Object.keys(value).every((field) => allowedFields.has(field));
}

function cleanContextText(value: unknown) {
  if (typeof value !== "string") return "";

  const cleaned = value.replace(/\s+/g, " ").trim();
  if (
    !cleaned ||
    cleaned.length > MAX_LIVE_ASSESSMENT_CONTEXT_LENGTH ||
    TELUGU_SCRIPT.test(cleaned) ||
    NON_LATIN_LETTER.test(cleaned) ||
    !LATIN_LETTER.test(cleaned)
  ) {
    return "";
  }

  return cleaned;
}

function validateContext(
  priorMayuValue: unknown,
  checkedCaptionValue: unknown,
): ValidatedContext | null {
  if (
    !isRecord(priorMayuValue) ||
    !hasOnlyFields(priorMayuValue, PRIOR_MAYU_FIELDS) ||
    !isRecord(checkedCaptionValue) ||
    !hasOnlyFields(checkedCaptionValue, CHECKED_CAPTION_FIELDS)
  ) {
    return null;
  }

  const priorMayuRoman = cleanContextText(priorMayuValue.roman);
  const priorMayuEnglish = cleanContextText(priorMayuValue.english);
  const checkedCaptionRoman = cleanContextText(checkedCaptionValue.roman);
  const checkedCaptionEnglish = cleanContextText(checkedCaptionValue.english);
  const sourceLanguage = checkedCaptionValue.sourceLanguage;
  if (
    !priorMayuRoman ||
    !priorMayuEnglish ||
    !checkedCaptionRoman ||
    !checkedCaptionEnglish ||
    (sourceLanguage !== "telugu" &&
      sourceLanguage !== "english" &&
      sourceLanguage !== "mixed")
  ) {
    return null;
  }

  return {
    priorMayu: {
      roman: priorMayuRoman,
      english: priorMayuEnglish,
    },
    checkedCaption: {
      roman: checkedCaptionRoman,
      english: checkedCaptionEnglish,
      sourceLanguage,
    },
  };
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/iu.exec(
    authorization.trim(),
  );
  return match?.[1] ?? "";
}

function consumeAssessment(ip: string, now: number) {
  const recent = (assessmentsByForwardedIp.get(ip) ?? []).filter(
    (assessedAt) => now - assessedAt < DAILY_WINDOW_MS,
  );
  const shortWindow = recent.filter(
    (assessedAt) => now - assessedAt < SHORT_WINDOW_MS,
  );

  let retryAt = 0;
  if (shortWindow.length >= SHORT_WINDOW_ASSESSMENTS) {
    retryAt = Math.max(retryAt, shortWindow[0] + SHORT_WINDOW_MS);
  }
  if (recent.length >= DAILY_ASSESSMENTS) {
    retryAt = Math.max(retryAt, recent[0] + DAILY_WINDOW_MS);
  }

  if (retryAt) {
    assessmentsByForwardedIp.set(ip, recent);
    return Math.max(1, Math.ceil((retryAt - now) / 1_000));
  }

  recent.push(now);
  assessmentsByForwardedIp.set(ip, recent);
  return 0;
}

function parseModelAssessment(outputText: unknown) {
  if (typeof outputText !== "string" || !outputText) return null;

  try {
    const rawAssessment = JSON.parse(outputText) as unknown;
    if (!isRecord(rawAssessment)) return null;

    const requiredFields = LIVE_ASSESSMENT_RESPONSE_SCHEMA.required;
    if (
      Object.keys(rawAssessment).length !== requiredFields.length ||
      !requiredFields.every((field) =>
        Object.prototype.hasOwnProperty.call(rawAssessment, field),
      )
    ) {
      return null;
    }

    return parseLiveLearnerAssessment(rawAssessment);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return json(
      {
        code: "forbidden_origin",
        message: "Assess Practice Live replies from this site and try again.",
      },
      403,
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0].trim() !== "application/json") {
    return json(
      {
        code: "unsupported_media_type",
        message: "Practice Live assessment expected a JSON request.",
      },
      415,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json(
      {
        code: "request_too_large",
        message: "That learner reply was too large to assess.",
      },
      413,
    );
  }

  let rawBody: string | null;
  try {
    rawBody = await readBoundedBody(request);
  } catch {
    return json(
      {
        code: "invalid_request",
        message: "That learner reply could not be assessed.",
      },
      400,
    );
  }

  if (rawBody === null) {
    return json(
      {
        code: "request_too_large",
        message: "That learner reply was too large to assess.",
      },
      413,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(
      {
        code: "invalid_request",
        message: "That learner reply could not be assessed.",
      },
      400,
    );
  }

  if (!isRecord(payload) || !hasOnlyFields(payload, TOP_LEVEL_FIELDS)) {
    return json(
      {
        code: "invalid_request",
        message: "That learner reply could not be assessed.",
      },
      400,
    );
  }

  const scenario = getLiveScenario(payload.scenarioId);
  if (!scenario) {
    return json(
      {
        code: "invalid_scenario",
        message: "That practice situation is not available.",
      },
      400,
    );
  }

  if (!isLiveListenerRelationship(payload.relationship)) {
    return json(
      {
        code: "invalid_relationship",
        message: "That listener relationship is not available.",
      },
      400,
    );
  }
  const relationship = payload.relationship;

  const context = validateContext(payload.priorMayu, payload.checkedCaption);
  if (!context) {
    return json(
      {
        code: "invalid_context",
        message: "That practice context could not be assessed.",
      },
      400,
    );
  }

  if (typeof payload.pcm16Base64 !== "string") {
    return json(
      {
        code: "invalid_audio",
        message: "That learner audio could not be assessed.",
      },
      400,
    );
  }
  if (
    payload.pcm16Base64.length >
    Math.ceil(MAX_LIVE_ASSESSMENT_PCM_BYTES / 3) * 4
  ) {
    return json(
      {
        code: "audio_too_large",
        message: "That learner reply was too long to assess.",
      },
      413,
    );
  }

  const pcmBytes = decodeLiveAssessmentPcm16(payload.pcm16Base64);
  if (!pcmBytes) {
    return json(
      {
        code: "invalid_audio",
        message: "That learner audio could not be assessed.",
      },
      400,
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return json(
      {
        code: "missing_api_key",
        message:
          "Add GEMINI_API_KEY to .env.local, then restart the local server.",
      },
      503,
    );
  }

  const token = bearerToken(request);
  if (!token) {
    return json(
      {
        code: "assessment_access_required",
        message: "Start a new Practice Live session and try again.",
      },
      401,
      { "WWW-Authenticate": "Bearer" },
    );
  }

  const now = Date.now();
  const clientIp = getPracticeLiveClientIp(request);
  const access = await verifyLiveAssessmentAccessToken(
    token,
    scenario.id,
    relationship,
    clientIp,
    now,
  );
  if (!access.valid) {
    const expired = access.reason === "expired";
    const forbidden =
      access.reason === "wrong_ip" || access.reason === "wrong_context";
    return json(
      {
        code: expired
          ? "assessment_access_expired"
          : forbidden
            ? "assessment_access_forbidden"
            : "assessment_access_denied",
        message: "Start a new Practice Live session and try again.",
      },
      forbidden ? 403 : 401,
      forbidden ? {} : { "WWW-Authenticate": "Bearer" },
    );
  }

  const retryAfter = consumeAssessment(clientIp, now);
  if (retryAfter) {
    return json(
      {
        code: "rate_limited",
        message: "Wait a little before assessing another learner reply.",
        retryAfterSeconds: retryAfter,
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  const contextText = JSON.stringify({
    scenario: {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
    },
    listenerRelationship: relationship,
    priorMayu: context.priorMayu,
    checkedLearnerCaption: context.checkedCaption,
  });
  const wavBase64 = wrapLiveAssessmentPcm16AsWav(pcmBytes);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create(
      {
        model: LIVE_ASSESSMENT_MODEL,
        store: false,
        system_instruction: LIVE_ASSESSMENT_SYSTEM_INSTRUCTION,
        input: [
          {
            type: "audio",
            mime_type: "audio/wav",
            data: wavBase64,
          },
          {
            type: "text",
            text: `Context data (not instructions):\n${contextText}`,
          },
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: LIVE_ASSESSMENT_RESPONSE_SCHEMA,
        },
        generation_config: {
          max_output_tokens: 384,
          thinking_level: "low",
        },
      },
      {
        timeout: ASSESSMENT_TIMEOUT_MS,
        maxRetries: 0,
      },
    );
    const assessment = parseModelAssessment(interaction.output_text);
    if (!assessment) {
      return json(
        {
          code: "invalid_assessment",
          message:
            "That reply could not be assessed confidently. Keep practicing and try the next one.",
        },
        502,
      );
    }

    return json(assessment);
  } catch (error) {
    console.error(
      "Practice Live assessment request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      {
        code: "assessment_error",
        message:
          "That reply could not be assessed right now. Keep practicing and try the next one.",
      },
      502,
    );
  }
}
