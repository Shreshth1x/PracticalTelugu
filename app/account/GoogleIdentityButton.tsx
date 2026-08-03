"use client";

import { useEffect, useRef, useState } from "react";
import {
  createGoogleIdentityConfiguration,
  createGoogleIdentityNonce,
} from "./google-identity-nonce";

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ??
  "460568999964-l0llnlqhgj9uvsruqr65lh0qma961scn.apps.googleusercontent.com";

type GoogleButtonConfiguration = {
  type: "standard";
  theme: "outline";
  size: "large";
  text: "continue_with";
  shape: "rectangular";
  logo_alignment: "left";
  width: string;
};

type GoogleIdentityApi = {
  initialize: (
    configuration: ReturnType<typeof createGoogleIdentityConfiguration>,
  ) => void;
  renderButton: (
    parent: HTMLElement,
    configuration: GoogleButtonConfiguration,
  ) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleIdentityApi;
      };
    };
  }
}

let googleIdentityScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleIdentityScriptPromise) return googleIdentityScriptPromise;

  googleIdentityScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT}"]`,
    );
    const script = existingScript ?? document.createElement("script");

    const loaded = () => {
      cleanup();
      if (window.google?.accounts?.id) {
        resolve();
      } else {
        reject(new Error("Google Identity Services did not initialize."));
      }
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("Google Identity Services could not be loaded."));
    };
    const cleanup = () => {
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };

    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);

    if (!existingScript) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      document.head.append(script);
    }
  }).catch((error) => {
    googleIdentityScriptPromise = null;
    throw error;
  });

  return googleIdentityScriptPromise;
}

type GoogleIdentityButtonProps = {
  disabled: boolean;
  signingIn: boolean;
  onCredential: (credential: string, rawNonce: string) => Promise<void>;
  onError: (message: string) => void;
};

export function GoogleIdentityButton({
  disabled,
  signingIn,
  onCredential,
  onError,
}: GoogleIdentityButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [interactionLocked, setInteractionLocked] = useState(false);

  useEffect(() => {
    onCredentialRef.current = onCredential;
    onErrorRef.current = onError;
  }, [onCredential, onError]);

  useEffect(() => {
    if (buttonRef.current) {
      buttonRef.current.inert = disabled || interactionLocked;
    }
  }, [disabled, interactionLocked]);

  useEffect(() => {
    let active = true;
    let renderedWidth = 0;
    let resizeObserver: ResizeObserver | null = null;

    const prepareButton = async () => {
      const parent = buttonRef.current;
      const googleIdentity = window.google?.accounts?.id;
      if (!active || !parent || !googleIdentity) return false;

      try {
        const { rawNonce, hashedNonce } = await createGoogleIdentityNonce();
        if (!active || !buttonRef.current) return false;

        googleIdentity.initialize(
          createGoogleIdentityConfiguration({
            clientId: GOOGLE_CLIENT_ID,
            rawNonce,
            hashedNonce,
            onStart: () => {
              if (active) setInteractionLocked(true);
            },
            onCredential: async (credential, credentialNonce) => {
              if (!active) return;
              await onCredentialRef.current(credential, credentialNonce);
            },
            onMissingCredential: () => {
              if (!active) return;
              onErrorRef.current(
                "Google did not return a sign-in credential. Try again or use email.",
              );
            },
            onSettled: async () => {
              if (!active) return;
              const prepared = await prepareButton();
              if (active && prepared) setInteractionLocked(false);
            },
          }),
        );

        const renderOfficialButton = () => {
          const width = Math.min(parent.clientWidth || 400, 400);
          if (width === renderedWidth && parent.childElementCount > 0) return;
          renderedWidth = width;
          parent.replaceChildren();
          googleIdentity.renderButton(parent, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "left",
            width: String(width),
          });
        };

        renderedWidth = 0;
        renderOfficialButton();
        resizeObserver ??= new ResizeObserver(renderOfficialButton);
        resizeObserver.observe(parent);
        setStatus("ready");
        return true;
      } catch {
        if (!active) return false;
        setStatus("error");
        onErrorRef.current(
          "Google sign-in could not be prepared. Try again or use email.",
        );
        return false;
      }
    };

    void loadGoogleIdentityScript()
      .then(prepareButton)
      .catch(() => {
        if (!active) return;
        setStatus("error");
        onErrorRef.current(
          "Google sign-in could not be loaded. Check your connection or use email.",
        );
      });

    return () => {
      active = false;
      resizeObserver?.disconnect();
    };
  }, []);

  const effectivelyDisabled = disabled || interactionLocked;
  const statusMessage =
    status === "loading"
      ? "Preparing Google sign-in…"
      : signingIn
        ? "Signing in with Google…"
        : status === "error"
          ? "Google sign-in is unavailable. Use email below."
          : interactionLocked
            ? "Refreshing Google sign-in…"
            : null;

  return (
    <div
      className={`google-identity google-identity-${status}${effectivelyDisabled ? " google-identity-disabled" : ""}`}
      aria-busy={
        signingIn || interactionLocked || status === "loading"
      }
      aria-disabled={effectivelyDisabled}
    >
      <div ref={buttonRef} className="google-identity-button" />
      {statusMessage ? (
        <p
          className="google-identity-status"
          role={status === "error" ? undefined : "status"}
        >
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}
