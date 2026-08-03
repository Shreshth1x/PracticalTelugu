type GoogleIdTokenCredentials = {
  provider: "google";
  token: string;
  nonce: string;
};

type GoogleIdTokenAuthClient = {
  auth: {
    signInWithIdToken: (
      credentials: GoogleIdTokenCredentials,
    ) => Promise<{ error: { message: string } | null }>;
  };
};

export async function signInWithGoogleIdToken(
  client: GoogleIdTokenAuthClient,
  idToken: string,
  rawNonce: string,
) {
  const { error } = await client.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    nonce: rawNonce,
  });

  return { error: error?.message ?? null };
}
