"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { hasLearningData, safeAppPath } from "../learning-state";
import { useLearning } from "../LearningProvider";
import { Wordmark } from "../Wordmark";

type AccountMode = "signin" | "signup" | "reset-password";

function authErrorMessage(message: string, action: AccountMode | "google") {
  const normalized = message.toLocaleLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "That email and password don’t match.";
  }
  if (
    normalized.includes("already registered") ||
    normalized.includes("already exists")
  ) {
    return "There may already be an account with this email. Try signing in or reset your password.";
  }
  if (
    normalized.includes("provider is not enabled") ||
    normalized.includes("unsupported provider")
  ) {
    return "Google sign-in isn’t available yet. Use email for now.";
  }
  if (normalized.includes("rate limit")) {
    return "Too many attempts. Wait a moment, then try again.";
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "Couldn’t connect. Your progress is still safe on this device.";
  }
  if (action === "google") {
    return "Google sign-in couldn’t start. Try again or use email.";
  }

  return "Something went wrong. Your progress is still safe on this device.";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function AccountPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode");
  const returnTo = safeAppPath(searchParams.get("returnTo"));
  const [mode, setMode] = useState<AccountMode>(
    initialMode === "signup" || initialMode === "reset-password"
      ? initialMode
      : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"email" | "google" | "reset" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const {
    state,
    preferences,
    savedWords,
    hydrated,
    user,
    authReady,
    syncStatus,
    syncMessage,
    signInWithPassword,
    signUp,
    signInWithGoogle,
    sendPasswordReset,
    updatePassword,
    signOut,
    retrySync,
  } = useLearning();

  const hasDeviceProgress = useMemo(
    () =>
      hasLearningData({
        state,
        preferences,
        savedWords,
      }),
    [preferences, savedWords, state],
  );

  const changeMode = (nextMode: AccountMode) => {
    setMode(nextMode);
    setError("");
    setMessage("");
    setPassword("");
  };

  const validateCredentials = () => {
    if (!validEmail(email)) {
      setError("Enter a valid email address.");
      return false;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return false;
    }
    return true;
  };

  const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (mode === "reset-password") {
      if (password.length < 8) {
        setError("Use at least 8 characters.");
        return;
      }
      setBusy("email");
      const result = await updatePassword(password);
      setBusy(null);
      if (result.error) {
        setError(authErrorMessage(result.error, mode));
        return;
      }
      setMessage("Your password has been updated.");
      window.setTimeout(() => router.push(returnTo), 650);
      return;
    }

    if (!validateCredentials()) return;

    setBusy("email");
    const result =
      mode === "signup"
        ? await signUp(email.trim(), password)
        : await signInWithPassword(email.trim(), password);
    setBusy(null);

    if (result.error) {
      setError(authErrorMessage(result.error, mode));
      return;
    }

    if (result.needsEmailConfirmation) {
      setMessage("Check your email to finish creating your account.");
      return;
    }

    router.push(returnTo);
  };

  const startGoogle = async () => {
    setError("");
    setMessage("");
    setBusy("google");
    const result = await signInWithGoogle(returnTo);
    setBusy(null);
    if (result.error) setError(authErrorMessage(result.error, "google"));
  };

  const requestReset = async () => {
    setError("");
    setMessage("");
    if (!validEmail(email)) {
      setError("Enter your email above, then try again.");
      return;
    }

    setBusy("reset");
    const result = await sendPasswordReset(email.trim());
    setBusy(null);
    if (result.error) {
      setError(authErrorMessage(result.error, "signin"));
      return;
    }
    setMessage("Check your email for a password reset link.");
  };

  const isResetMode = mode === "reset-password";
  const title =
    mode === "signup"
      ? "Keep your Telugu progress."
      : isResetMode
        ? "Choose a new password."
        : "Welcome back.";
  const description =
    mode === "signup"
      ? "Create an account to keep practiced phrases and saved phrases on every device."
      : isResetMode
        ? "Use at least eight characters so your account stays secure."
        : "Sign in to bring back your practiced phrases and saved phrases.";

  return (
    <main className="account-page">
      <header className="account-header">
        <Link href="/" aria-label="PracticalTelugu home">
          <Wordmark />
        </Link>
        <Link href={returnTo} className="account-back">
          Back to practice
        </Link>
      </header>

      <section className="account-content" aria-labelledby="account-title">
        {authReady && user && !isResetMode ? (
          <div className="account-signed-in">
            <span className="account-check" aria-hidden="true">
              ✓
            </span>
            <h1 id="account-title">Your progress is backed up.</h1>
            <p>Signed in as {user.email}</p>
            <div
              className={`account-sync account-sync-${syncStatus}`}
              role="status"
            >
              <span />
              {syncMessage}
            </div>
            <div className="account-signed-actions">
              {syncStatus === "error" ? (
                <button className="secondary-button" onClick={retrySync}>
                  Try again
                </button>
              ) : null}
              <Link href="/recordings" className="secondary-button">
                Open family recorder
              </Link>
              <Link href={returnTo} className="primary-button">
                Back to practice
              </Link>
              <button
                className="text-button"
                onClick={async () => {
                  const result = await signOut();
                  if (result.error) {
                    setError("Couldn’t sign out. Try again.");
                    return;
                  }
                  setMessage(
                    "Signed out. Your progress is still on this device.",
                  );
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <>
            <span className="account-kicker">Optional progress backup</span>
            <h1 id="account-title">{title}</h1>
            <p className="account-description">{description}</p>

            {mode === "signup" && hydrated && hasDeviceProgress ? (
              <p className="account-local-note">
                <span aria-hidden="true">✓</span>
                The progress on this device will be added to your account.
              </p>
            ) : null}

            {!isResetMode ? (
              <>
                <button
                  className="google-button"
                  onClick={startGoogle}
                  disabled={busy !== null}
                >
                  <span className="google-mark" aria-hidden="true">
                    G
                  </span>
                  {busy === "google"
                    ? "Opening Google…"
                    : "Continue with Google"}
                </button>
                <div className="account-divider" aria-hidden="true">
                  <span />
                  <small>or</small>
                  <span />
                </div>
              </>
            ) : null}

            <form className="account-form" onSubmit={submitEmail} noValidate>
              {!isResetMode ? (
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    disabled={busy !== null}
                  />
                </label>
              ) : null}
              <label>
                <span>{isResetMode ? "New password" : "Password"}</span>
                <span className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      mode === "signin"
                        ? "current-password"
                        : "new-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    disabled={busy !== null}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </span>
              </label>

              {mode === "signin" ? (
                <button
                  type="button"
                  className="account-forgot"
                  onClick={requestReset}
                  disabled={busy !== null}
                >
                  {busy === "reset"
                    ? "Sending reset link…"
                    : "Forgot your password?"}
                </button>
              ) : null}

              {error ? (
                <p className="account-error" role="alert">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="account-message" role="status">
                  {message}
                </p>
              ) : null}

              <button
                type="submit"
                className="primary-button account-submit"
                disabled={busy !== null}
              >
                {busy === "email"
                  ? mode === "signup"
                    ? "Creating account…"
                    : isResetMode
                      ? "Updating password…"
                      : "Signing in…"
                  : mode === "signup"
                    ? "Create account"
                    : isResetMode
                      ? "Update password"
                      : "Sign in"}
              </button>
            </form>

            {!isResetMode ? (
              <p className="account-switch">
                {mode === "signup"
                  ? "Already have an account?"
                  : "New to PracticalTelugu?"}{" "}
                <button
                  type="button"
                  onClick={() =>
                    changeMode(mode === "signup" ? "signin" : "signup")
                  }
                >
                  {mode === "signup" ? "Sign in" : "Create an account"}
                </button>
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
