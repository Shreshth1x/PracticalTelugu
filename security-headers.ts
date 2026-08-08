/**
 * Security headers applied to every response, both by the Cloudflare worker
 * (production) and by next.config.ts (frameworks that honor headers()).
 *
 * The Content-Security-Policy is deliberately Report-Only until a real
 * browser session (Google sign-in popup, Gemini Live WebSocket, audio
 * worklet) has been verified free of violations; flip the header name to
 * "Content-Security-Policy" after that check.
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next/vinext bootstraps with inline scripts, so 'unsafe-inline' is
  // required; external script injection is still limited to Google GSI.
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
  "Content-Security-Policy-Report-Only": CONTENT_SECURITY_POLICY,
};
