const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://cdbpdjqswlmjsblawhju.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_6dJtra2hWy4JzkO7ZCQXWw_GbVr6E_h";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_BEARER_LENGTH = 4_096;
export const FISH_AUTH_TIMEOUT_MS = 1_500;

function allowedEmailHashes() {
  return new Set(
    (process.env.FISH_ALLOWED_EMAIL_SHA256 ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => SHA256_HEX.test(value)),
  );
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return "";

  const token = authorization.slice("Bearer ".length).trim();
  return token && token.length <= MAX_BEARER_LENGTH ? token : "";
}

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function canUsePrivateFishVoice(request: Request) {
  const allowed = allowedEmailHashes();
  const token = bearerToken(request);
  if (!allowed.size || !token) return false;

  const controller = new AbortController();
  const forwardRequestAbort = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) forwardRequestAbort();
  else request.signal.addEventListener("abort", forwardRequestAbort, { once: true });
  const deadline = setTimeout(
    () => controller.abort(new DOMException("Authorization timed out.", "TimeoutError")),
    FISH_AUTH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;

    const payload = (await response.json()) as { email?: unknown };
    if (typeof payload.email !== "string" || !payload.email.trim()) {
      return false;
    }

    const emailHash = await sha256Hex(
      payload.email.trim().toLocaleLowerCase("en-US"),
    );
    return allowed.has(emailHash);
  } catch {
    // Private voices fail closed while the public Gemini practice remains usable.
    return false;
  } finally {
    clearTimeout(deadline);
    request.signal.removeEventListener("abort", forwardRequestAbort);
  }
}
