import { GoogleGenAI } from "@google/genai";
import {
  buildLiveConnectConfig,
  buildLiveTokenConstraintConfig,
  isLiveFamilyVoice,
  isLiveListenerRelationship,
  isLiveSessionDuration,
  LIVE_MODEL,
} from "../../../practice-live/live-config.ts";
import {
  createFishVoiceAccessToken,
  getPracticeLiveClientIp,
  hasFishVoice,
} from "../fish-config.ts";
import {
  getPrivateFishVoiceAuthorization,
  type FishVoiceAuthorization,
} from "../fish-authorization.ts";
import {
  getLiveOpeningCue,
  getLiveScenario,
} from "../../../practice-live/live-scenarios.ts";
import { createLiveAssessmentAccessToken } from "../assessment-config.ts";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 2_048;
const SHORT_WINDOW_MS = 15 * 60 * 1_000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const SHORT_WINDOW_STARTS = 6;
const DAILY_STARTS = 20;
const NEW_SESSION_WINDOW_SECONDS = 60;
const SESSION_DRAIN_HEADROOM_SECONDS = 10;
const TOKEN_EXPIRY_HEADROOM_SECONDS =
  NEW_SESSION_WINDOW_SECONDS + SESSION_DRAIN_HEADROOM_SECONDS;

// This in-memory limiter is defense-in-depth on each edge/server instance. A
// durable platform rate limit (and sign-in for user quotas) is still required
// before Practice Live is opened at public scale.
const startsByForwardedIp = new Map<string, number[]>();

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

function json(
  body: Record<string, unknown>,
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

function consumeStart(ip: string, now: number) {
  const recent = (startsByForwardedIp.get(ip) ?? []).filter(
    (startedAt) => now - startedAt < DAILY_WINDOW_MS,
  );
  const shortWindow = recent.filter(
    (startedAt) => now - startedAt < SHORT_WINDOW_MS,
  );

  let retryAt = 0;
  if (shortWindow.length >= SHORT_WINDOW_STARTS) {
    retryAt = Math.max(retryAt, shortWindow[0] + SHORT_WINDOW_MS);
  }
  if (recent.length >= DAILY_STARTS) {
    retryAt = Math.max(retryAt, recent[0] + DAILY_WINDOW_MS);
  }

  if (retryAt) {
    startsByForwardedIp.set(ip, recent);
    return Math.max(1, Math.ceil((retryAt - now) / 1_000));
  }

  recent.push(now);
  startsByForwardedIp.set(ip, recent);
  return 0;
}

function isSameOriginRequest(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  // A browser POST supplies at least one of these provenance headers. Reject
  // headerless direct calls as an additional abuse barrier; durable quotas are
  // still required because non-browser clients can forge either header.
  if (!origin && !fetchSite) return false;
  if (origin && origin !== expectedOrigin) return false;

  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return json(
      {
        code: "forbidden_origin",
        message: "Start Practice Live from this site and try again.",
      },
      403,
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0].trim() !== "application/json") {
    return json(
      {
        code: "unsupported_media_type",
        message: "Practice Live expected a small JSON request.",
      },
      415,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json(
      {
        code: "request_too_large",
        message: "That Practice Live request was too large.",
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
        message: "Choose a practice situation and try again.",
      },
      400,
    );
  }

  if (rawBody === null) {
    return json(
      {
        code: "request_too_large",
        message: "That Practice Live request was too large.",
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
        message: "Choose a practice situation and try again.",
      },
      400,
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json(
      {
        code: "invalid_request",
        message: "Choose a practice situation and try again.",
      },
      400,
    );
  }

  const { scenarioId, familyVoice, relationship, durationSeconds } =
    payload as Record<string, unknown>;

  const scenario = getLiveScenario(scenarioId);
  if (!scenario) {
    return json(
      {
        code: "invalid_scenario",
        message: "That practice situation is not available.",
      },
      400,
    );
  }

  if (!isLiveListenerRelationship(relationship)) {
    return json(
      {
        code: "invalid_relationship",
        message: "Choose who you are speaking with and try again.",
      },
      400,
    );
  }

  if (!isLiveFamilyVoice(familyVoice)) {
    return json(
      {
        code: "invalid_family_voice",
        message: "Choose Grandma or Grandpa's voice and try again.",
      },
      400,
    );
  }

  if (!isLiveSessionDuration(durationSeconds)) {
    return json(
      {
        code: "invalid_duration",
        message: "Choose a one- or two-minute practice and try again.",
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

  const now = Date.now();
  const clientIp = getPracticeLiveClientIp(request);
  const retryAfter = consumeStart(clientIp, now);
  if (retryAfter) {
    return json(
      {
        code: "rate_limited",
        message:
          "You have started several live practices. Wait a little before trying again.",
        retryAfterSeconds: retryAfter,
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  const options = { relationship, durationSeconds };
  const config = buildLiveConnectConfig(scenario, options);
  const tokenConstraintConfig = buildLiveTokenConstraintConfig(config);
  const privateVoiceAuthorization: Promise<FishVoiceAuthorization> =
    hasFishVoice(familyVoice)
      ? getPrivateFishVoiceAuthorization(request)
      : Promise.resolve({
          authorized: false,
          reason: "not_configured",
        });

  try {
    const tokenExpiresAt = new Date(
      now +
        (durationSeconds + TOKEN_EXPIRY_HEADROOM_SECONDS) * 1_000,
    ).toISOString();
    const newSessionExpiresAt = new Date(
      now + NEW_SESSION_WINDOW_SECONDS * 1_000,
    ).toISOString();
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });
    const [authToken, voiceAuthorization] = await Promise.all([
      ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: tokenExpiresAt,
          newSessionExpireTime: newSessionExpiresAt,
          liveConnectConstraints: {
            model: LIVE_MODEL,
            config: tokenConstraintConfig,
          },
          lockAdditionalFields: [],
        },
      }),
      privateVoiceAuthorization,
    ]);

    if (!authToken.name) {
      throw new Error("Gemini returned an empty ephemeral token.");
    }

    const voiceMode = voiceAuthorization.authorized ? "fish" : "gemini";
    const [voiceAccessToken, assessmentAccessToken] = await Promise.all([
      voiceMode === "fish"
        ? createFishVoiceAccessToken(
            familyVoice,
            clientIp,
            Date.parse(tokenExpiresAt),
          )
        : Promise.resolve(undefined),
      createLiveAssessmentAccessToken(
        scenario.id,
        relationship,
        clientIp,
        Date.parse(tokenExpiresAt),
      ),
    ]);

    return json({
      token: authToken.name,
      assessmentAccessToken,
      model: LIVE_MODEL,
      config,
      voiceMode,
      voiceModeReason: voiceAuthorization.reason,
      familyVoice,
      ...(voiceAccessToken ? { voiceAccessToken } : {}),
      openingCue: getLiveOpeningCue(scenario, relationship),
      relationship,
      sessionLimitSeconds: durationSeconds,
      tokenExpiresAt,
    });
  } catch (error) {
    console.error("Practice Live token creation failed", error);

    return json(
      {
        code: "token_error",
        message:
          "Gemini Live could not create a temporary session. Try again in a moment.",
      },
      502,
    );
  }
}
