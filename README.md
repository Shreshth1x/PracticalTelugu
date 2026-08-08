# PracticalTelugu

PracticalTelugu is a fast, phrase-first Telugu companion for people who want to
participate in real conversations. It skips alphabet units, grammar detours,
and locked curricula in favor of an ordered practical path that moves five
phrases at a time while keeping family visits, meals, errands, travel, and
helpful situations open.

Mayu, an original Indian peacock mascot, introduces the first phrase and
returns to celebrate completed practice. Completed situations and phrase
confidence are stored locally in the browser, so every lesson remains
available without an account. An optional account can be created with Google
or email and password to back up practiced phrases and saved phrases through
Supabase and restore them on another device. Signing in adds any progress
already on the device to the account instead of replacing it. The phrase path
does not require an AI service.

Practice Live is an optional Telugu voice conversation with Mayu.
Mayu keeps the spoken exchange in Telugu while the screen pairs every turn's
Telugu written in English letters and its pronunciation guide with its English
meaning. Native Telugu script and raw speech-recognition output never enter the
live display.
Completed live-session totals are stored on the current device; microphone
audio is sent directly from the browser to Google Gemini only while the learner
has an active session. Practice Live does not save that conversation audio.
Post-session coaching separates first-listen intelligibility, Telugu sound
accuracy, conversational meaning, and usable grammar/word choice/register.
Mixed replies also account for how much Telugu was actually spoken. Unreliable
audio is left unscored, and response timing is shown separately from the
language score. The result is broad AI coaching, not a phoneme-level accent
measurement.

The separate `/recordings` route is an owner-only family tool for deliberately
capturing phrase clips. Access is claimed against the private administrator
allowlist and enforced by Supabase row-level security for both recording rows
and private Storage objects. Ordinary and anonymous accounts cannot open the
recorder, upload takes, or replace existing recordings. Accepted takes and
their consent metadata are not published into learner-facing `audioSrc` fields
automatically; the export pipeline also limits its inputs to the active owner.

Google sign-in is ready for public use. Email/password confirmation and
password-reset messages use Supabase Auth; configure a custom SMTP provider
before relying on those email flows for users outside the Supabase project
team.

Google sign-in uses Google's official Identity Services popup button and sends
the returned ID token directly to Supabase. This keeps the learner on the
PracticalTelugu domain instead of routing the account chooser through the raw
Supabase project hostname. The checked-in fallback is the public OAuth web
client ID for this deployment; set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to override
it for another Google Cloud project. The same client ID must be enabled in the
Supabase Google provider, with nonce verification left on, and each deployed
site origin must be listed under the OAuth client's Authorized JavaScript
origins in Google Cloud.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

The development server prints the local URL when it starts.

## Practice Live setup

This checkout uses the Doppler project `practicaltelugu` and its `dev`
configuration. After authenticating the Doppler CLI, start the app with:

```bash
npm run dev:doppler
```

The command makes `GEMINI_API_KEY` available to the local Cloudflare runtime
through an ephemeral `.dev.vars` mount. Doppler removes the mount when the
development server exits, so the key is never copied into the repository.

Without Doppler, create a Gemini API key in
[Google AI Studio](https://aistudio.google.com/app/apikey), then add it to a
local `.env.local` file:

```bash
GEMINI_API_KEY=your_key_here
```

Restart `npm run dev` after changing the environment file. Do not prefix this
variable with `NEXT_PUBLIC_`: the permanent key is read only by the server-side
token route. The browser receives a short-lived credential for each
conversation instead.

Practice Live speaks with Gemini's prebuilt Aoede voice. The conversation is
full duplex: microphone audio keeps streaming while Mayu speaks, so the
learner can interrupt naturally and Gemini's server-side voice activity
detection handles the barge-in.

Before starting, the learner chooses the listener relationship and a fixed
one- or two-minute session. Respectful Telugu is the safe default for an elder
or anyone new; familiar Telugu is reserved for someone the learner genuinely
knows well. The server validates both choices, provisions a token only after
microphone permission succeeds, and gives that token a short expiry tied to
the selected session: enough lifetime for setup, the selected practice, and a
10-second closing margin. The token permits its one live connection plus a
single session-resumption reconnect, so a transient network drop resumes the
same conversation instead of ending it. The learner's one- or two-minute limit
begins only after the browser connects, so setup time cannot consume practice
time.

The token route includes same-origin, request-size, and per-instance rate-limit
guards (the in-memory IP trackers are capped so spoofed addresses cannot grow
them without bound). For an open public launch, add a durable platform rate
limit or require sign-in; an in-memory edge-instance limit is defense-in-depth,
not a complete abuse or spend control.

Two optional server environment variables harden Practice Live further.
`PRACTICE_LIVE_SIGNING_SECRET` (generate with `openssl rand -base64 32`)
signs the assessment capability tokens; without it the server falls back to
signing with `GEMINI_API_KEY`, which works but ties token validity to a
vendor-shared key. `TRUST_FORWARDED_IP=1` opts in to honoring
`x-forwarded-for`/`x-real-ip` for rate limiting and token IP binding; leave it
unset except behind a proxy that overwrites those headers (Cloudflare's own
`cf-connecting-ip` is always trusted). Every response also carries security
headers from `security-headers.ts`; its Content-Security-Policy ships as
Report-Only until a real browser session verifies sign-in and the live
conversation produce no violations.

The language policy and its source trail live in
`docs/research/telugu-conversation-register.md` and the adjacent provenance
ledger.

## Practical situations and family audio

Situation content lives in `app/course-data.ts`. Every phrase keeps four
separate learning layers: its English meaning, stable romanized Telugu, an
easy English-speaker pronunciation cue, and Telugu script. The pronunciation
cue is deliberately approximate and complements, rather than replaces, the
optional `audioSrc` for family-recorded pronunciation clips.

## Verification

```bash
npm run lint
npm test
```

`npm test` creates the production vinext build and checks the rendered home
experience.

With Doppler credentials available, the optional Live smoke test is:

```bash
npm run smoke:live -- family-check-in --conversation --relationship=respectful --duration=60
```

The smoke script exercises Gemini's token, tool, caption, and audio path with
text-injected learner turns. Real microphone/VAD and device playback still need
browser testing.
