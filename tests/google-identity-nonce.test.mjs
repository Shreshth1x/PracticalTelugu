import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import {
  createGoogleIdentityConfiguration,
  createGoogleIdentityNonce,
} from "../app/account/google-identity-nonce.ts";
import { signInWithGoogleIdToken } from "../app/google-id-token-auth.ts";

test("creates a base64url nonce and the matching SHA-256 hash", async () => {
  const deterministicCrypto = {
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = index;
      }
      return bytes;
    },
    subtle: webcrypto.subtle,
  };

  const { rawNonce, hashedNonce } =
    await createGoogleIdentityNonce(deterministicCrypto);

  assert.equal(rawNonce, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
  assert.match(rawNonce, /^[A-Za-z0-9_-]+$/);
  assert.equal(
    hashedNonce,
    createHash("sha256").update(rawNonce).digest("hex"),
  );
  assert.match(hashedNonce, /^[a-f0-9]{64}$/);
});

test("creates a fresh nonce for each Google sign-in preparation", async () => {
  const first = await createGoogleIdentityNonce(webcrypto);
  const second = await createGoogleIdentityNonce(webcrypto);

  assert.notEqual(first.rawNonce, second.rawNonce);
  assert.notEqual(first.hashedNonce, second.hashedNonce);
});

test("routes the hashed nonce to Google and keeps the raw nonce locked through reprepare", async () => {
  const events = [];
  let locked = false;
  let releaseReprepare;
  let markReprepareStarted;
  const reprepareGate = new Promise((resolve) => {
    releaseReprepare = resolve;
  });
  const reprepareStarted = new Promise((resolve) => {
    markReprepareStarted = resolve;
  });
  let supabaseCredentials;
  const supabase = {
    auth: {
      async signInWithIdToken(credentials) {
        supabaseCredentials = credentials;
        return { error: { message: "Supabase rejected the token" } };
      },
    },
  };

  const configuration = createGoogleIdentityConfiguration({
    clientId: "public-client-id.apps.googleusercontent.com",
    rawNonce: "raw-browser-nonce",
    hashedNonce: "hashed-google-nonce",
    onStart: () => {
      locked = true;
      events.push("locked");
    },
    onCredential: async (credential, rawNonce) => {
      const result = await signInWithGoogleIdToken(
        supabase,
        credential,
        rawNonce,
      );
      events.push(["supabase", credential, rawNonce]);
      if (result.error) throw new Error(result.error);
    },
    onMissingCredential: () => {
      events.push("missing");
    },
    onSettled: async () => {
      events.push("repreparing");
      markReprepareStarted();
      await reprepareGate;
      locked = false;
      events.push("ready");
    },
  });

  assert.equal(configuration.nonce, "hashed-google-nonce");
  assert.equal(configuration.ux_mode, "popup");

  const callback = configuration.callback({ credential: "google-id-token" });
  await reprepareStarted;

  assert.equal(locked, true);
  assert.deepEqual(events, [
    "locked",
    ["supabase", "google-id-token", "raw-browser-nonce"],
    "repreparing",
  ]);
  assert.deepEqual(supabaseCredentials, {
    provider: "google",
    token: "google-id-token",
    nonce: "raw-browser-nonce",
  });

  releaseReprepare();
  await assert.rejects(callback, /Supabase rejected the token/);
  assert.equal(locked, false);
  assert.deepEqual(events.at(-1), "ready");
});
