import type { LiveFamilyVoice } from "../../practice-live/live-config.ts";

const VOICE_CAPABILITY_VERSION = 1;
const VOICE_CAPABILITY_DOMAIN =
  "practice-live:fish-voice-capability:v1";
const VOICE_IP_BINDING_DOMAIN =
  "practice-live:fish-voice-ip-binding:v1";
const MAX_VOICE_CAPABILITY_LENGTH = 1_024;
const textEncoder = new TextEncoder();

type VoiceCapabilityPayload = [
  version: number,
  familyVoice: LiveFamilyVoice,
  expiresAtSeconds: number,
  ipBinding: string,
];

export type FishVoiceAccessVerification =
  | { valid: true }
  | {
      valid: false;
      reason: "invalid" | "expired" | "wrong_ip" | "wrong_voice";
    };

function fishApiKey() {
  return process.env.FISH_API_KEY?.trim() ?? "";
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url");

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + "=".repeat(paddingLength));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return {
    key,
    signature: new Uint8Array(
      await crypto.subtle.sign("HMAC", key, textEncoder.encode(message)),
    ),
  };
}

async function ipBinding(secret: string, ip: string) {
  const { signature } = await hmac(
    secret,
    `${VOICE_IP_BINDING_DOMAIN}\n${ip}`,
  );
  return bytesToBase64Url(signature);
}

export function getPracticeLiveClientIp(request: Request) {
  const candidate =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    request.headers.get("x-real-ip") ??
    "unknown";

  return candidate.trim().slice(0, 128) || "unknown";
}

export function getFishVoiceId(familyVoice: LiveFamilyVoice) {
  return (
    familyVoice === "grandma"
      ? process.env.FISH_GRANDMA_VOICE_ID
      : process.env.FISH_GRANDPA_VOICE_ID
  )?.trim() ?? "";
}

export function hasFishVoice(familyVoice: LiveFamilyVoice) {
  return Boolean(fishApiKey() && getFishVoiceId(familyVoice));
}

export async function createFishVoiceAccessToken(
  familyVoice: LiveFamilyVoice,
  ip: string,
  expiresAt: number,
) {
  const secret = fishApiKey();
  if (!secret) throw new Error("Fish Audio is not configured.");

  const payload: VoiceCapabilityPayload = [
    VOICE_CAPABILITY_VERSION,
    familyVoice,
    Math.floor(expiresAt / 1_000),
    await ipBinding(secret, ip),
  ];
  const encodedPayload = bytesToBase64Url(
    textEncoder.encode(JSON.stringify(payload)),
  );
  const { signature } = await hmac(
    secret,
    `${VOICE_CAPABILITY_DOMAIN}\n${encodedPayload}`,
  );

  return `${encodedPayload}.${bytesToBase64Url(signature)}`;
}

export async function verifyFishVoiceAccessToken(
  token: string,
  familyVoice: LiveFamilyVoice,
  ip: string,
  now = Date.now(),
): Promise<FishVoiceAccessVerification> {
  const secret = fishApiKey();
  if (!secret || !token || token.length > MAX_VOICE_CAPABILITY_LENGTH) {
    return { valid: false, reason: "invalid" };
  }

  try {
    const segments = token.split(".");
    if (segments.length !== 2) return { valid: false, reason: "invalid" };

    const [encodedPayload, encodedSignature] = segments;
    const signature = base64UrlToBytes(encodedSignature);
    if (signature.byteLength !== 32) {
      return { valid: false, reason: "invalid" };
    }

    const { key } = await hmac(
      secret,
      `${VOICE_CAPABILITY_DOMAIN}\n${encodedPayload}`,
    );
    const signatureIsValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      textEncoder.encode(`${VOICE_CAPABILITY_DOMAIN}\n${encodedPayload}`),
    );
    if (!signatureIsValid) return { valid: false, reason: "invalid" };

    const decodedPayload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encodedPayload)),
    ) as unknown;
    if (
      !Array.isArray(decodedPayload) ||
      decodedPayload.length !== 4 ||
      decodedPayload[0] !== VOICE_CAPABILITY_VERSION ||
      (decodedPayload[1] !== "grandma" && decodedPayload[1] !== "grandpa") ||
      !Number.isSafeInteger(decodedPayload[2]) ||
      typeof decodedPayload[3] !== "string"
    ) {
      return { valid: false, reason: "invalid" };
    }

    const [, permittedVoice, expiresAtSeconds, permittedIpBinding] =
      decodedPayload as VoiceCapabilityPayload;
    if (expiresAtSeconds <= Math.floor(now / 1_000)) {
      return { valid: false, reason: "expired" };
    }
    if (permittedVoice !== familyVoice) {
      return { valid: false, reason: "wrong_voice" };
    }
    if ((await ipBinding(secret, ip)) !== permittedIpBinding) {
      return { valid: false, reason: "wrong_ip" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "invalid" };
  }
}
