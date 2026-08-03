const GOOGLE_NONCE_BYTES = 32;

function encodeBase64Url(bytes: Uint8Array) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;

    encoded += alphabet[(combined >> 18) & 63];
    encoded += alphabet[(combined >> 12) & 63];
    if (index + 1 < bytes.length) encoded += alphabet[(combined >> 6) & 63];
    if (index + 2 < bytes.length) encoded += alphabet[combined & 63];
  }

  return encoded;
}

function encodeHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

type NonceCrypto = Pick<Crypto, "getRandomValues" | "subtle">;

export type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdentityConfigurationOptions = {
  clientId: string;
  rawNonce: string;
  hashedNonce: string;
  onStart: () => void;
  onCredential: (credential: string, rawNonce: string) => Promise<void>;
  onMissingCredential: () => void;
  onSettled: () => Promise<void>;
};

export async function createGoogleIdentityNonce(
  cryptoApi: NonceCrypto = globalThis.crypto,
) {
  const randomBytes = new Uint8Array(GOOGLE_NONCE_BYTES);
  cryptoApi.getRandomValues(randomBytes);
  const rawNonce = encodeBase64Url(randomBytes);
  const hash = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawNonce),
  );

  return {
    rawNonce,
    hashedNonce: encodeHex(new Uint8Array(hash)),
  };
}

export function createGoogleIdentityConfiguration({
  clientId,
  rawNonce,
  hashedNonce,
  onStart,
  onCredential,
  onMissingCredential,
  onSettled,
}: GoogleIdentityConfigurationOptions) {
  return {
    client_id: clientId,
    nonce: hashedNonce,
    ux_mode: "popup" as const,
    callback: async (response: GoogleCredentialResponse) => {
      onStart();
      try {
        if (!response.credential) {
          onMissingCredential();
          return;
        }

        await onCredential(response.credential, rawNonce);
      } finally {
        await onSettled();
      }
    },
  };
}
