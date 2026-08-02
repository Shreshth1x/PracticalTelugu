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
Telugu written in English letters and its pronunciation guide with its English meaning. Native
Telugu script and raw speech-recognition output never enter the live display.
Completed live-session totals are stored on the current device; microphone
audio is sent directly from the browser to Google Gemini only while the learner
has an active session. Practice Live does not save that conversation audio.

The separate `/recordings` route is a direct-access family tool for deliberately
capturing phrase clips. It silently creates a per-browser anonymous recording
session, so a speaker never has to make an account or see a sign-in screen.
Accepted takes and their consent metadata are stored in an owner-scoped private
Supabase Storage bucket and RLS-protected table; they are not published into
learner-facing `audioSrc` fields automatically. The same browser keeps its
recording progress through the persisted anonymous session.

Google sign-in is ready for public use. Email/password confirmation and
password-reset messages use Supabase Auth; configure a custom SMTP provider
before relying on those email flows for users outside the Supabase project
team.

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
token route. The browser receives a one-use, short-lived credential for each
conversation instead.

Practice Live currently uses Gemini's prebuilt Aoede voice. A family voice can
be connected later through a consented voice provider without changing the
conversation screen, but no cloned voice is enabled by default.

Before starting, the learner chooses the listener relationship and a fixed
one- or two-minute session. Respectful Telugu is the safe default for an elder
or anyone new; familiar Telugu is reserved for someone the learner genuinely
knows well. The server validates both choices, provisions a one-use token only
after microphone permission succeeds, and gives that token a short expiry tied
to the selected session. A token allows 60 seconds to establish its one Live
connection, then enough total lifetime for the selected practice plus a
10-second closing margin. The learner's one- or two-minute limit begins only
after the browser connects, so setup time cannot consume practice time.

The token route includes same-origin, request-size, and per-instance rate-limit
guards. For an open public launch, add a durable platform rate limit or require
sign-in; an in-memory edge-instance limit is defense-in-depth, not a complete
abuse or spend control.

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
