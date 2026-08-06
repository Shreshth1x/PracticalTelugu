import { isLiveFamilyVoice } from "../../../practice-live/live-config.ts";
import {
  getFishTtsModel,
  getFishVoiceId,
  getPracticeLiveClientIp,
  verifyFishVoiceAccessToken,
} from "../fish-config.ts";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 2_048;
const MAX_TELUGU_LENGTH = 420;
const MAX_PCM_BYTES = 2 * 1_024 * 1_024;
const FISH_UPSTREAM_TIMEOUT_MS = 8_000;
const RATE_WINDOW_MS = 15 * 60 * 1_000;
const RATE_REQUESTS = 40;
const TELUGU_SCRIPT = /[\u0c00-\u0c7f]/u;
const TELUGU_AND_NEUTRAL_CHARACTERS =
  /^[\u0c00-\u0c7f\p{Nd}\p{P}\s\u200c\u200d]+$/u;

const requestsByForwardedIp = new Map<string, number[]>();

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

function isSameOriginRequest(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin && !fetchSite) return false;
  if (origin && origin !== expectedOrigin) return false;

  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function consumeRequest(ip: string, now: number) {
  const recent = (requestsByForwardedIp.get(ip) ?? []).filter(
    (requestedAt) => now - requestedAt < RATE_WINDOW_MS,
  );

  if (recent.length >= RATE_REQUESTS) {
    requestsByForwardedIp.set(ip, recent);
    return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1_000));
  }

  recent.push(now);
  requestsByForwardedIp.set(ip, recent);
  return 0;
}

function cleanTelugu(value: unknown) {
  if (typeof value !== "string") return "";

  const cleaned = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  return cleaned &&
    cleaned.length <= MAX_TELUGU_LENGTH &&
    TELUGU_SCRIPT.test(cleaned) &&
    TELUGU_AND_NEUTRAL_CHARACTERS.test(cleaned)
    ? cleaned
    : "";
}

function isExpectedPcmContentType(response: Response) {
  const mimeType =
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ??
    "";
  return (
    mimeType === "audio/pcm" ||
    mimeType === "audio/l16" ||
    mimeType === "application/octet-stream"
  );
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The route's bounded error response still takes precedence.
  }
}

async function readBoundedPcm(response: Response) {
  if (!response.body) return { status: "empty" as const };

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      await cancelBody(response);
      return { status: "invalid" as const };
    }
    if (contentLength === 0) {
      await cancelBody(response);
      return { status: "empty" as const };
    }
    if (contentLength > MAX_PCM_BYTES) {
      await cancelBody(response);
      return { status: "oversize" as const };
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    byteLength += value.byteLength;
    if (byteLength > MAX_PCM_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The bounded response still takes precedence if Fish closed first.
      }
      return { status: "oversize" as const };
    }
    chunks.push(value);
  }

  if (byteLength === 0) return { status: "empty" as const };
  if (byteLength % 2 !== 0) return { status: "invalid" as const };

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok" as const, bytes };
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
        // The size response still takes precedence if the sender closed first.
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
      { code: "request_too_large", message: "That voice request was too large." },
      413,
    );
  }

  let rawBody: string | null;
  try {
    rawBody = await readBoundedBody(request);
  } catch {
    return json(
      { code: "invalid_request", message: "That voice request was not valid." },
      400,
    );
  }

  if (rawBody === null) {
    return json(
      { code: "request_too_large", message: "That voice request was too large." },
      413,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(
      { code: "invalid_request", message: "That voice request was not valid." },
      400,
    );
  }

  const body =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  if (!body) {
    return json(
      {
        code: "invalid_request",
        message: "That voice request was not valid.",
      },
      400,
    );
  }

  const familyVoice = body.familyVoice;
  if (!isLiveFamilyVoice(familyVoice)) {
    return json(
      {
        code: "invalid_family_voice",
        message: "Choose Grandma or Grandpa's voice and try again.",
      },
      400,
    );
  }

  const apiKey = process.env.FISH_API_KEY?.trim();
  const voiceId = getFishVoiceId(familyVoice);
  if (!apiKey || !voiceId) {
    return json(
      {
        code: "fish_not_configured",
        message: "The cloned Practice Live voice is not configured.",
      },
      503,
    );
  }

  const voiceAccessToken = body.voiceAccessToken;
  if (typeof voiceAccessToken !== "string" || !voiceAccessToken) {
    return json(
      {
        code: "voice_access_required",
        message: "Start a new Practice Live session and try again.",
      },
      401,
      { "WWW-Authenticate": 'Bearer realm="practice-live-voice"' },
    );
  }

  const clientIp = getPracticeLiveClientIp(request);
  const access = await verifyFishVoiceAccessToken(
    voiceAccessToken,
    familyVoice,
    clientIp,
  );
  if (!access.valid) {
    const forbidden =
      access.reason === "wrong_ip" || access.reason === "wrong_voice";
    return json(
      {
        code: forbidden ? "voice_access_forbidden" : "voice_access_denied",
        message: "Start a new Practice Live session and try again.",
      },
      forbidden ? 403 : 401,
      forbidden
        ? {}
        : { "WWW-Authenticate": 'Bearer realm="practice-live-voice"' },
    );
  }

  const text = cleanTelugu(body.text);
  if (!text) {
    return json(
      {
        code: "invalid_telugu",
        message: "The cloned voice needs a short native-script Telugu turn.",
      },
      400,
    );
  }

  if (request.signal.aborted) {
    return new Response(null, { status: 499 });
  }

  const retryAfter = consumeRequest(clientIp, Date.now());
  if (retryAfter) {
    return new Response(
      JSON.stringify({
        code: "rate_limited",
        message: "Wait a little before requesting another cloned voice turn.",
      }),
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  const upstreamController = new AbortController();
  let upstreamTimedOut = false;
  const forwardRequestAbort = () => {
    upstreamController.abort(request.signal.reason);
  };
  request.signal.addEventListener("abort", forwardRequestAbort, { once: true });
  const upstreamDeadline = setTimeout(() => {
    upstreamTimedOut = true;
    upstreamController.abort(
      new DOMException("Fish Audio request timed out.", "TimeoutError"),
    );
  }, FISH_UPSTREAM_TIMEOUT_MS);

  try {
    const fishResponse = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model: getFishTtsModel(),
      },
      body: JSON.stringify({
        text,
        reference_id: voiceId,
        format: "pcm",
        sample_rate: 24_000,
        latency: "balanced",
      }),
      signal: upstreamController.signal,
    });

    if (!fishResponse.ok || !fishResponse.body) {
      const fishRequestId = fishResponse.headers.get("x-request-id");
      console.error("Fish Audio rejected Practice Live speech", {
        status: fishResponse.status,
        requestId: fishRequestId,
      });
      if (fishResponse.status === 402) {
        return json(
          {
            code: "fish_payment_required",
            message: "The cloned voice account needs usable API credit.",
          },
          503,
        );
      }
      return json(
        {
          code: "fish_rejected",
          message: "The cloned voice could not speak that turn.",
        },
        502,
      );
    }

    if (!isExpectedPcmContentType(fishResponse)) {
      await cancelBody(fishResponse);
      console.error("Fish Audio returned an unexpected content type", {
        requestId: fishResponse.headers.get("x-request-id"),
      });
      return json(
        {
          code: "fish_invalid_audio",
          message: "The cloned voice returned invalid audio.",
        },
        502,
      );
    }

    const pcm = await readBoundedPcm(fishResponse);
    if (pcm.status !== "ok") {
      console.error("Fish Audio returned unusable PCM", {
        reason: pcm.status,
        requestId: fishResponse.headers.get("x-request-id"),
      });
      return json(
        {
          code:
            pcm.status === "oversize"
              ? "fish_audio_too_large"
              : "fish_invalid_audio",
          message: "The cloned voice returned invalid audio.",
        },
        502,
      );
    }

    return new Response(pcm.bytes, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Length": String(pcm.bytes.byteLength),
        "Content-Type": "audio/pcm;rate=24000",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    if (upstreamTimedOut) {
      return json(
        {
          code: "fish_timeout",
          message: "The cloned voice took too long to respond.",
        },
        504,
      );
    }
    console.error("Fish Audio request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown failure",
    });
    return json(
      {
        code: "fish_unavailable",
        message: "The cloned voice is temporarily unavailable.",
      },
      502,
    );
  } finally {
    clearTimeout(upstreamDeadline);
    request.signal.removeEventListener("abort", forwardRequestAbort);
  }
}
